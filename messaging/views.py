from config import settings
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q
from django.contrib.auth import get_user_model

from drf_spectacular.utils import extend_schema, extend_schema_view, OpenApiParameter
from drf_spectacular.types import OpenApiTypes

import redis
import json
from channels.layers import get_channel_layer

from .models import Group, GroupMember, Message
from .serializers import GroupSerializer, GroupMemberSerializer, MessageSerializer
from .permissions import IsGroupMember, IsGroupAdmin, IsGroupCreator, IsMessageSender, CanAccessMessage
import logging

logger = logging.getLogger(__name__)
User = get_user_model()

MsgTag = ["Messages"]
GroupTag = ["Groups"]
GroupMembershipTag = ["GroupMembership"]


@extend_schema_view(
    list=extend_schema(
        summary="List all groups",
        description="Returns a list of all existing groups with membership information.",
        tags=GroupTag
    ),
    create=extend_schema(
        summary="Create a new group",
        description="Creates a new chat group. Creator automatically becomes an admin member.",
        tags=GroupTag
    ),
    retrieve=extend_schema(
        summary="Retrieve a group",
        description="Get detailed information about a specific group.",
        tags=GroupTag
    ),
    update=extend_schema(
        summary="Update Group",
        description="Update a group details completely.",
        tags=GroupTag
    ),
    partial_update=extend_schema(
        summary="Update a group (partial)",
        description="Update group details. Only admins can perform this action.",
        tags=GroupTag
    ),
    destroy=extend_schema(
        summary="Delete a group",
        description="Permanently delete the group. Only the creator can delete.",
        tags=GroupTag
    ),
)
class GroupViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing chat groups.

    Permissions:
    - List/Retrieve: Authenticated users
    - Create: Authenticated users
    - Update: Group admins only
    - Delete: Group creator only
    """
    queryset = Group.objects.all()
    serializer_class = GroupSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action in ['update', 'partial_update']:
            return [permissions.IsAuthenticated(), IsGroupAdmin()]
        elif self.action == 'destroy':
            return [permissions.IsAuthenticated(), IsGroupCreator()]
        elif self.action == 'members':
            return [permissions.IsAuthenticated(), IsGroupMember()]
        return super().get_permissions()

    def perform_create(self, serializer):
        group = serializer.save(created_by=self.request.user)
        logger.info(f"Group '{group.name}' created by {self.request.user.username}")

    @extend_schema(
        summary="Join a group",
        description="Join the specified group. New members are not admins by default.",
        tags=GroupMembershipTag
    )
    @action(detail=True, methods=["post"])
    def join(self, request, pk=None):
        group = self.get_object()
        user = request.user

        member, created = GroupMember.objects.get_or_create(
            user=user, group=group, defaults={"is_admin": False}
        )

        status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        message = "Successfully joined the group" if created else "You are already a member"

        return Response(
            {"message": message, "member": GroupMemberSerializer(member).data},
            status=status_code,
        )

    @extend_schema(
        summary="Leave a group",
        description="Remove yourself from the group. Group creator cannot leave.",
        tags=GroupMembershipTag
    )
    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated, IsGroupMember])
    def leave(self, request, pk=None):
        group = self.get_object()
        user = request.user

        if group.created_by == user:
            return Response(
                {"error": "Group creator cannot leave. Delete the group instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        deleted_count, _ = GroupMember.objects.filter(user=user, group=group).delete()
        
        if deleted_count > 0:
            return Response({"message": "Successfully left the group", "left": True})
        else:
            return Response(
                {"error": "You are not a member of this group"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @extend_schema(
        summary="List group members",
        description="Returns all members of the group. Only accessible to group members.",
        parameters=[
            OpenApiParameter(name="username", description="Filter by username"),
            OpenApiParameter(name="is_admin", description="Filter by admin status", type=bool),
        ],
        tags=GroupMembershipTag
    )
    @action(detail=True, methods=["get"])
    def members(self, request, pk=None):
        group = self.get_object()
        members = GroupMember.objects.filter(group=group).select_related("user")

        username = request.query_params.get("username")
        is_admin = request.query_params.get("is_admin")

        if username:
            members = members.filter(user__username__icontains=username)
        if is_admin is not None:
            members = members.filter(is_admin=is_admin.lower() == "true")

        serializer = GroupMemberSerializer(members, many=True)
        return Response({"count": members.count(), "members": serializer.data})

    @extend_schema(
        summary="Promote member to admin",
        description="Make a group member an admin. Only group admins can do this.",
        tags=GroupMembershipTag
    )
    @action(
        detail=True, 
        methods=["post"], 
        url_path="members/(?P<user_id>[^/.]+)/promote",
        permission_classes=[permissions.IsAuthenticated, IsGroupAdmin]
    )
    def promote_member(self, request, pk=None, user_id=None):
        group = self.get_object()
        
        try:
            membership = GroupMember.objects.get(user_id=user_id, group=group)
        except GroupMember.DoesNotExist:
            return Response({"error": "User is not a member of this group"}, status=status.HTTP_404_NOT_FOUND)
        
        if membership.is_admin:
            return Response({"message": "User is already an admin"}, status=status.HTTP_200_OK)
        
        membership.is_admin = True
        membership.save()
        logger.info(f"User {membership.user.username} promoted to admin in group {group.name}")
        return Response({"message": "User promoted to admin successfully"}, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Remove member from group",
        description="Remove a member from the group. Only admins can do this.",
        tags=GroupMembershipTag
    )
    @action(
        detail=True,
        methods=["delete"],
        url_path="members/(?P<user_id>[^/.]+)",
        permission_classes=[permissions.IsAuthenticated, IsGroupAdmin]
    )
    def remove_member(self, request, pk=None, user_id=None):
        group = self.get_object()
        if str(group.created_by.id) == str(user_id):
            return Response({"error": "Cannot remove the group creator"}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            membership = GroupMember.objects.get(user_id=user_id, group=group)
        except GroupMember.DoesNotExist:
            return Response({"error": "User is not a member of this group"}, status=status.HTTP_404_NOT_FOUND)
        
        membership.delete()
        logger.info(f"User {membership.user.username} removed from group {group.name} by {request.user.username}")
        return Response({"message": "Member removed successfully"}, status=status.HTTP_200_OK)


@extend_schema_view(
    list=extend_schema(
        summary="List messages",
        description=(
            "Returns messages the authenticated user is allowed to access.\n\n"
            "Access rules:\n"
            "- Group messages from groups where the user is a member\n"
            "- Private messages where the user is either the sender or recipient\n\n"
            "Filtering behavior:\n"
            "- `group`: Filters group messages by group ID (only groups the user belongs to)\n"
            "- `message_type`: Filters messages by type (`group` or `private`)\n"
            "- `recipient`: When `message_type=private`, returns the full private conversation "
            "between the authenticated user and the specified user (bidirectional)\n\n"
            "Notes:\n"
            "- The `recipient` parameter is ignored unless `message_type=private`\n"
            "- Results are ordered by newest messages first"
        ),
        tags=MsgTag,
        parameters=[
            OpenApiParameter(name="group", type=OpenApiTypes.UUID, description="Filter messages by group ID. Only messages from groups the authenticated user belongs to are returned."),
            OpenApiParameter(name="message_type", type=OpenApiTypes.STR, enum=["group", "private"], description="Filter messages by type."),
            OpenApiParameter(name="recipient", type=OpenApiTypes.UUID, description="User ID for private chat filtering."),
        ],
    ),
    create=extend_schema(summary="Send a message", description="Send a group or private message.", tags=MsgTag),
    retrieve=extend_schema(summary="Retrieve a single message", tags=MsgTag),
    destroy=extend_schema(summary="Delete a message", description="Delete your own message. Only the sender can delete their messages.", tags=MsgTag),
)
class MessageViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing messages.

    Permissions:
    - List/Retrieve: User can only see messages they have access to
    - Create: Authenticated users (with group membership check)
    - Delete: Only message sender
    - Update: Not allowed
    """
    serializer_class = MessageSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_permissions(self):
        if self.action == 'destroy':
            return [permissions.IsAuthenticated(), IsMessageSender()]
        elif self.action == 'retrieve':
            return [permissions.IsAuthenticated(), CanAccessMessage()]
        return super().get_permissions()

    def get_queryset(self):
        user = self.request.user
        queryset = Message.objects.filter(
            Q(message_type="group", group__groupmember__user=user)
            | Q(message_type="private", sender=user)
            | Q(message_type="private", recipient=user)
        ).distinct().select_related("sender", "recipient", "group")

        group_id = self.request.query_params.get("group")
        if group_id:
            queryset = queryset.filter(group_id=group_id)

        message_type = self.request.query_params.get("message_type")
        if message_type in ["group", "private"]:
            queryset = queryset.filter(message_type=message_type)

        recipient_id = self.request.query_params.get("recipient")
        if recipient_id and message_type == "private":
            queryset = queryset.filter(
                Q(recipient_id=recipient_id, sender=user)
                | Q(sender_id=recipient_id, recipient=user)
            )

        return queryset.order_by("-created_at")

    def perform_create(self, serializer):
        message = serializer.save(sender=self.request.user)

        # EXISTING CODE: Broadcast via Channels
        
        channel_layer = get_channel_layer()
        
        # NEW CODE: Also publish to Redis for Go WebSocket server
        
        
        redis_client = redis.from_url(settings.CACHES['default']['LOCATION'])
        
        if message.message_type == "group":
            redis_client.publish('messaging_events', json.dumps({
                'type': 'group_message',
                'data': {
                    'message_id': str(message.id),
                    'sender_id': str(message.sender.id),
                    'sender_username': message.sender.username,
                    'content': message.content,
                    'timestamp': message.created_at.isoformat(),
                    'message_type': 'group',
                    'group_id': str(message.group.id),
                    'group_name': message.group.name
                }
            }))
        
        elif message.message_type == "private":
            redis_client.publish('messaging_events', json.dumps({
                'type': 'private_message_handler',
                'data': {
                    'message_id': str(message.id),
                    'sender_id': str(message.sender.id),
                    'sender_username': message.sender.username,
                    'recipient_id': str(message.recipient.id),
                    'recipient_username': message.recipient.username,
                    'content': message.content,
                    'timestamp': message.created_at.isoformat(),
                    'message_type': 'private'
                }
            }))
