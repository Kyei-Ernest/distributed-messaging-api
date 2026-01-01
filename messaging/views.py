# messaging/views.py - Enhanced with ALL Real-time Features
from config import settings
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q
from django.contrib.auth import get_user_model
from django.utils import timezone

from drf_spectacular.utils import extend_schema, extend_schema_view, OpenApiParameter, inline_serializer
from drf_spectacular.types import OpenApiTypes
from rest_framework import serializers as drf_serializers

import redis
import json
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

from .models import Group, GroupMember, Message
from .serializers import GroupSerializer, GroupMemberSerializer, MessageSerializer
from .permissions import IsGroupMember, IsGroupAdmin, IsGroupCreator, IsMessageSender, CanAccessMessage
import logging

logger = logging.getLogger(__name__)
User = get_user_model()

MsgTag = ["Messages"]
GroupTag = ["Groups"]
GroupMembershipTag = ["GroupMembership"]


# ============================================================================
# Helper Functions for Real-time Broadcasting
# ============================================================================

def get_redis_client():
    """Get Redis client for publishing events"""
    return redis.from_url(settings.CACHES['default']['LOCATION'])


def broadcast_to_redis(event_type, data):
    """Broadcast event to Redis for Go WebSocket server"""
    try:
        redis_client = get_redis_client()
        redis_client.publish('messaging_events', json.dumps({
            'type': event_type,
            'data': data
        }))
        logger.debug(f"Broadcasted {event_type} to Redis")
    except Exception as e:
        logger.error(f"Failed to broadcast to Redis: {e}")


def broadcast_user_joined(group, user):
    """Broadcast user joined event"""
    broadcast_to_redis('user_joined', {
        'user_id': str(user.id),
        'username': user.username,
        'group_id': str(group.id),
        'group_name': group.name,
        'is_admin': False,
        'timestamp': timezone.now().isoformat()
    })


def broadcast_user_left(group, user):
    """Broadcast user left event"""
    broadcast_to_redis('user_left', {
        'user_id': str(user.id),
        'username': user.username,
        'group_id': str(group.id),
        'group_name': group.name,
        'timestamp': timezone.now().isoformat()
    })


def broadcast_user_removed(group, user, removed_by):
    """Broadcast user removed event"""
    broadcast_to_redis('user_removed', {
        'user_id': str(user.id),
        'username': user.username,
        'group_id': str(group.id),
        'group_name': group.name,
        'removed_by': str(removed_by.id),
        'removed_by_username': removed_by.username,
        'timestamp': timezone.now().isoformat()
    })


def broadcast_message_deleted(message, deleted_by):
    """Broadcast message deleted event"""
    if message.message_type == "group":
        broadcast_to_redis('message_deleted', {
            'message_id': str(message.id),
            'group_id': str(message.group.id),
            'deleted_by': str(deleted_by.id),
            'message_type': 'group',
            'timestamp': timezone.now().isoformat()
        })
    elif message.message_type == "private":
        broadcast_to_redis('message_deleted', {
            'message_id': str(message.id),
            'sender_id': str(message.sender.id),
            'recipient_id': str(message.recipient.id),
            'deleted_by': str(deleted_by.id),
            'message_type': 'private',
            'timestamp': timezone.now().isoformat()
        })


# ============================================================================
# Group Management ViewSet
# ============================================================================

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
        description="Join the specified group. New members are not admins by default. Real-time notification sent to all group members.",
        tags=GroupMembershipTag
    )
    @action(detail=True, methods=["post"])
    def join(self, request, pk=None):
        group = self.get_object()
        user = request.user

        member, created = GroupMember.objects.get_or_create(
            user=user, group=group, defaults={"is_admin": False}
        )

        if created:
            # Broadcast join event in real-time
            broadcast_user_joined(group, user)
            logger.info(f"User {user.username} joined group {group.name}")

        status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        message = "Successfully joined the group" if created else "You are already a member"

        return Response(
            {"message": message, "member": GroupMemberSerializer(member).data},
            status=status_code,
        )

    @extend_schema(
        summary="Leave a group",
        description="Remove yourself from the group. Group creator cannot leave. Real-time notification sent to remaining members.",
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
            # Broadcast leave event in real-time
            broadcast_user_left(group, user)
            logger.info(f"User {user.username} left group {group.name}")
            return Response({"message": "Successfully left the group", "left": True})
        else:
            return Response(
                {"error": "You are not a member of this group"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @extend_schema(
        summary="List group members",
        description="Returns all members of the group with their online status. Only accessible to group members.",
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
        
        # Broadcast promotion event
        broadcast_to_redis('member_promoted', {
            'user_id': str(membership.user.id),
            'username': membership.user.username,
            'group_id': str(group.id),
            'group_name': group.name,
            'promoted_by': str(request.user.id),
            'timestamp': timezone.now().isoformat()
        })
        
        logger.info(f"User {membership.user.username} promoted to admin in group {group.name}")
        return Response({"message": "User promoted to admin successfully"}, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Remove member from group",
        description="Remove a member from the group. Only admins can do this. Real-time notification sent to all members.",
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
        
        removed_user = membership.user
        membership.delete()
        
        # Broadcast removal event in real-time
        broadcast_user_removed(group, removed_user, request.user)
        
        logger.info(f"User {removed_user.username} removed from group {group.name} by {request.user.username}")
        return Response({"message": "Member removed successfully"}, status=status.HTTP_200_OK)


# ============================================================================
# Message Management ViewSet
# ============================================================================

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
            OpenApiParameter(name="group", type=OpenApiTypes.UUID, description="Filter messages by group ID."),
            OpenApiParameter(name="message_type", type=OpenApiTypes.STR, enum=["group", "private"], description="Filter messages by type."),
            OpenApiParameter(name="recipient", type=OpenApiTypes.UUID, description="User ID for private chat filtering."),
            OpenApiParameter(name="since", type=OpenApiTypes.DATETIME, description="Get messages since this timestamp (for syncing)."),
        ],
    ),
    create=extend_schema(
        summary="Send a message", 
        description="Send a group or private message. Messages are delivered in real-time to all online recipients via WebSocket.", 
        tags=MsgTag
    ),
    retrieve=extend_schema(summary="Retrieve a single message", tags=MsgTag),
    destroy=extend_schema(
        summary="Delete a message", 
        description="Delete your own message. Only the sender can delete their messages. Real-time notification sent to recipients.", 
        tags=MsgTag
    ),
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

        # Filter by group
        group_id = self.request.query_params.get("group")
        if group_id:
            queryset = queryset.filter(group_id=group_id)

        # Filter by message type
        message_type = self.request.query_params.get("message_type")
        if message_type in ["group", "private"]:
            queryset = queryset.filter(message_type=message_type)

        # Filter private conversation
        recipient_id = self.request.query_params.get("recipient")
        if recipient_id and message_type == "private":
            queryset = queryset.filter(
                Q(recipient_id=recipient_id, sender=user)
                | Q(sender_id=recipient_id, recipient=user)
            )

        # Filter by timestamp (for syncing)
        since = self.request.query_params.get("since")
        if since:
            queryset = queryset.filter(created_at__gte=since)

        return queryset.order_by("-created_at")

    def perform_create(self, serializer):
        """Save message and broadcast in real-time to all online recipients"""
        message = serializer.save(sender=self.request.user)
        
        # Broadcast via Redis for Go WebSocket server
        if message.message_type == "group":
            broadcast_to_redis('group_message', {
                'message_id': str(message.id),
                'sender_id': str(message.sender.id),
                'sender_username': message.sender.username,
                'content': message.content,
                'timestamp': message.created_at.isoformat(),
                'message_type': 'group',
                'group_id': str(message.group.id),
                'group_name': message.group.name
            })
            logger.debug(f"Group message broadcast to group {message.group.name}")
        
        elif message.message_type == "private":
            broadcast_to_redis('private_message_handler', {
                'message_id': str(message.id),
                'sender_id': str(message.sender.id),
                'sender_username': message.sender.username,
                'recipient_id': str(message.recipient.id),
                'recipient_username': message.recipient.username,
                'content': message.content,
                'timestamp': message.created_at.isoformat(),
                'message_type': 'private'
            })
            logger.debug(f"Private message broadcast from {message.sender.username} to {message.recipient.username}")

    def destroy(self, request, *args, **kwargs):
        """Delete message and broadcast deletion event in real-time"""
        message = self.get_object()
        
        # Broadcast deletion event before deleting
        broadcast_message_deleted(message, request.user)
        
        # Delete the message
        message_id = message.id
        response = super().destroy(request, *args, **kwargs)
        
        logger.info(f"Message {message_id} deleted by {request.user.username}")
        return response

    @extend_schema(
        summary="Mark message as read",
        description="Mark a message as read. Triggers read receipt to sender.",
        tags=MsgTag,
        request=inline_serializer(
            name='MarkReadRequest',
            fields={'message_ids': drf_serializers.ListField(child=drf_serializers.UUIDField())}
        ),
        responses={200: inline_serializer(
            name='MarkReadResponse',
            fields={'marked_count': drf_serializers.IntegerField()}
        )}
    )
    @action(detail=False, methods=["post"])
    def mark_read(self, request):
        """Mark messages as read (batch operation)"""
        message_ids = request.data.get('message_ids', [])
        
        # Get messages that the user has access to
        messages = self.get_queryset().filter(id__in=message_ids)
        
        marked_count = 0
        for message in messages:
            # Broadcast read receipt
            broadcast_to_redis('message_read', {
                'message_id': str(message.id),
                'read_by': str(request.user.id),
                'read_by_username': request.user.username,
                'timestamp': timezone.now().isoformat()
            })
            marked_count += 1
        
        logger.debug(f"User {request.user.username} marked {marked_count} messages as read")
        return Response({"marked_count": marked_count}, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Get unread message count",
        description="Get count of unread messages for the current user.",
        tags=MsgTag,
        responses={200: inline_serializer(
            name='UnreadCountResponse',
            fields={'unread_count': drf_serializers.IntegerField()}
        )}
    )
    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        """Get unread message count for current user"""
        # This is a simple implementation
        # For production, you'd track read status in a separate table
        unread_count = self.get_queryset().filter(
            Q(message_type="private", recipient=request.user) |
            Q(message_type="group")
        ).count()
        
        return Response({"unread_count": unread_count}, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Send typing indicator",
        description="Send typing indicator to group or private chat. Real-time notification to other participants.",
        tags=MsgTag,
        request=inline_serializer(
            name='TypingRequest',
            fields={
                'group_id': drf_serializers.UUIDField(required=False),
                'recipient_id': drf_serializers.UUIDField(required=False),
                'is_typing': drf_serializers.BooleanField()
            }
        ),
        responses={200: inline_serializer(
            name='TypingResponse',
            fields={'status': drf_serializers.CharField()}
        )}
    )
    @action(detail=False, methods=["post"])
    def typing(self, request):
        """Send typing indicator"""
        group_id = request.data.get('group_id')
        recipient_id = request.data.get('recipient_id')
        is_typing = request.data.get('is_typing', True)
        
        if group_id:
            # Group typing indicator
            broadcast_to_redis('typing_indicator', {
                'user_id': str(request.user.id),
                'username': request.user.username,
                'group_id': str(group_id),
                'is_typing': is_typing,
                'timestamp': timezone.now().isoformat()
            })
        elif recipient_id:
            # Private typing indicator
            broadcast_to_redis('typing_indicator', {
                'user_id': str(request.user.id),
                'username': request.user.username,
                'recipient_id': str(recipient_id),
                'is_typing': is_typing,
                'timestamp': timezone.now().isoformat()
            })
        
        return Response({"status": "typing indicator sent"}, status=status.HTTP_200_OK)