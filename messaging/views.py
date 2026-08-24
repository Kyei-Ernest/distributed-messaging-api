# messaging/views.py - Enhanced with ALL Real-time Features
from config import settings
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from django.db.models import Q
from django.contrib.auth import get_user_model
from django.utils import timezone

from drf_spectacular.utils import extend_schema, extend_schema_view, OpenApiParameter, inline_serializer
from drf_spectacular.types import OpenApiTypes
from rest_framework import serializers as drf_serializers
from .pagination import MessagePagination  # Import custom pagination

import redis
import json

from django_redis import get_redis_connection

from accounts.authentication import current_workspace


from .models import Group, GroupMember, Message, MessageReadReceipt, UserProfile, MessageReaction
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
    """Get a Redis client for publishing events.

    Reuses Django's configured Redis pool (``django_redis``) rather than opening a
    brand-new connection per call, falling back to a direct client from the cache URL.
    """
    try:
        return get_redis_connection("default")
    except Exception:
        # Fallback: build a client directly from the cache location.
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

    def get_queryset(self):
        qs = Group.objects.all()
        # Multi-tenant scoping: a resolved workspace limits groups to that tenant.
        workspace = current_workspace(self.request)
        if workspace is not None:
            qs = qs.filter(workspace=workspace)
        return qs

    def perform_create(self, serializer):
        group = serializer.save(
            created_by=self.request.user,
            workspace=current_workspace(self.request),
        )
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
            "Returns paginated messages (20 per page).\n\n"
            "Pagination:\n"
            "- Use `page` parameter (e.g., ?page=2)\n"
            "- Use `page_size` to adjust (max 100)\n"
            "- Check `next` field for more pages\n\n"
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

    # ✅ ADD THIS LINE - Use custom pagination
    pagination_class = MessagePagination

    def get_permissions(self):
        if self.action == 'destroy':
            return [permissions.IsAuthenticated(), IsMessageSender()]
        elif self.action == 'retrieve':
            return [permissions.IsAuthenticated(), CanAccessMessage()]
        return super().get_permissions()

    def get_queryset(self):
        """
        This method already returns the correct queryset.
        Pagination will be applied automatically by DRF.
        """
        user = self.request.user
        workspace = current_workspace(self.request)

        if workspace is not None:
            # Multi-tenant: only messages within the request's workspace, in addition
            # to the existing membership/sender/recipient check (defense in depth).
            queryset = Message.objects.filter(
                Q(message_type="group", group__workspace=workspace, group__groupmember__user=user)
                | Q(message_type="private", sender=user, sender__workspace=workspace)
                | Q(message_type="private", recipient=user, recipient__workspace=workspace)
            )
        else:
            queryset = Message.objects.filter(
                Q(message_type="group", group__groupmember__user=user)
                | Q(message_type="private", sender=user)
                | Q(message_type="private", recipient=user)
            )
        queryset = queryset.distinct().select_related("sender", "recipient", "group")

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

        # ✅ IMPORTANT: Order by newest first (latest messages first)
        # This is correct for infinite scroll from bottom to top
        return queryset.order_by("-created_at")
    

    def perform_create(self, serializer):
        """Save message and broadcast in real-time to all online recipients"""
        # Entitlement check: enforce a per-workspace daily message quota when set.
        workspace = current_workspace(self.request)
        if workspace is not None and workspace.message_quota is not None:
            from accounts.models import WorkspaceDailyUsage
            today = timezone.localdate()
            usage = WorkspaceDailyUsage.objects.filter(
                workspace=workspace, date=today
            ).values_list('message_count', flat=True).first() or 0
            if usage >= workspace.message_quota:
                raise PermissionDenied(
                    f"Workspace daily message quota ({workspace.message_quota}) exceeded."
                )

        message = serializer.save(sender=self.request.user)
        
        # Broadcast via Redis for Go WebSocket server
        if message.message_type == "group":
            # ✅ UPDATED: Include encryption fields in broadcast
            broadcast_data = {
                'message_id': str(message.id),
                'sender_id': str(message.sender.id),
                'sender_username': message.sender.username,
                'timestamp': message.created_at.isoformat(),
                'message_type': 'group',
                'group_id': str(message.group.id),
                'group_name': message.group.name
            }

            # ✅ Add parent message info if reply
            if message.parent_message:
                broadcast_data['parent_message'] = {
                    'id': str(message.parent_message.id),
                    'sender_username': message.parent_message.sender.username,
                    'content': message.parent_message.content,
                    'is_encrypted': message.parent_message.is_encrypted
                }
            
            # ✅ Add encryption fields if encrypted
            if message.is_encrypted:
                broadcast_data.update({
                    'is_encrypted': True,
                    'encrypted_content': message.encrypted_content,
                    'encrypted_keys': message.encrypted_keys,
                    'iv': message.iv
                })
            else:
                broadcast_data['content'] = message.content
            
            broadcast_to_redis('group_message', broadcast_data)
            logger.debug(f"Group message broadcast to group {message.group.name}")
            
            # Broadcast unread count updates
            for member in message.group.groupmember_set.exclude(user=self.request.user):
                updated_counts = self._get_unread_counts_for_user(member.user)
                broadcast_to_redis('unread_count_update', {
                    'user_id': str(member.user.id),
                    'total_unread': updated_counts['total_unread'],
                    'groups': updated_counts['groups'],
                    'users': updated_counts['users'],
                    'all_chats': updated_counts['all_chats']
                })
        
        elif message.message_type == "private":
            # ✅ UPDATED: Include encryption fields in broadcast
            broadcast_data = {
                'message_id': str(message.id),
                'sender_id': str(message.sender.id),
                'sender_username': message.sender.username,
                'recipient_id': str(message.recipient.id),
                'recipient_username': message.recipient.username,
                'timestamp': message.created_at.isoformat(),
                'message_type': 'private'
            }

            # ✅ Add parent message info if reply
            if message.parent_message:
                broadcast_data['parent_message'] = {
                    'id': str(message.parent_message.id),
                    'sender_username': message.parent_message.sender.username,
                    'content': message.parent_message.content,
                    'is_encrypted': message.parent_message.is_encrypted
                }
            
            # ✅ Add encryption fields if encrypted
            if message.is_encrypted:
                broadcast_data.update({
                    'is_encrypted': True,
                    'encrypted_content': message.encrypted_content,
                    'encrypted_key': message.encrypted_key,
                    'encrypted_key_self': message.encrypted_key_self,
                    'iv': message.iv
                })
            else:
                broadcast_data['content'] = message.content
            
            broadcast_to_redis('private_message_handler', broadcast_data)
            logger.debug(f"Private message broadcast from {message.sender.username} to {message.recipient.username}")
            
            # Broadcast unread count update to recipient
            updated_counts = self._get_unread_counts_for_user(message.recipient)
            broadcast_to_redis('unread_count_update', {
                'user_id': str(message.recipient.id),
                'total_unread': updated_counts['total_unread'],
                'groups': updated_counts['groups'],
                'users': updated_counts['users'],
                'all_chats': updated_counts['all_chats']
            })

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
        description="Mark a message as read. Persists read receipts to database.",
        tags=MsgTag,
        request=inline_serializer(
            name='MarkReadRequest',
            fields={'message_ids': drf_serializers.ListField(child=drf_serializers.UUIDField())}
        ),
        responses={200: inline_serializer(
            name='MarkReadResponse',
            fields={
                'marked_count': drf_serializers.IntegerField(),
                'read_messages': drf_serializers.ListField(child=drf_serializers.UUIDField())
            }
        )}
    )
    @action(detail=False, methods=["post"])
    def mark_read(self, request):
        """Mark messages as read (batch operation) with persistence and live unread count update"""
        message_ids = request.data.get('message_ids', [])
        
        if not message_ids:
            return Response({"error": "No message IDs provided"}, status=status.HTTP_400_BAD_REQUEST)
        
        # Get messages that the user has access to
        messages = self.get_queryset().filter(id__in=message_ids)
        
        marked_count = 0
        read_message_ids = []
        
        for message in messages:
            # Check if already read
            already_read = MessageReadReceipt.objects.filter(
                message=message,
                user=request.user
            ).exists()
            
            if not already_read:
                # Create read receipt
                MessageReadReceipt.objects.create(
                    message=message,
                    user=request.user
                )
                read_message_ids.append(str(message.id))
                marked_count += 1
                
                # Broadcast read receipt via Redis, routed only to conversation participants.
                msg_target = {}
                if message.message_type == 'group' and message.group_id:
                    msg_target['group_id'] = str(message.group_id)
                else:
                    # Private message: notify the conversation partner (plus echo to reader).
                    msg_target['sender_id'] = str(message.sender_id)
                    msg_target['recipient_id'] = str(message.recipient_id) if message.recipient_id else ''

                broadcast_to_redis('message_read', {
                    'message_id': str(message.id),
                    'read_by': str(request.user.id),
                    'read_by_username': request.user.username,
                    'timestamp': timezone.now().isoformat(),
                    **msg_target,
                })
        
        # CRITICAL: Broadcast updated unread counts to this user AFTER marking as read
        if marked_count > 0:
            updated_counts = self._get_unread_counts_for_user(request.user)
            broadcast_to_redis('unread_count_update', {
                'user_id': str(request.user.id),
                'total_unread': updated_counts['total_unread'],
                'groups': updated_counts['groups'],
                'users': updated_counts['users'],
                'all_chats': updated_counts['all_chats']
            })
            
            logger.info(f"📊 Unread count update sent to user {request.user.username}: {updated_counts['total_unread']} unread")
        
        logger.info(f"User {request.user.username} marked {marked_count} messages as read")
        return Response({
            "marked_count": marked_count,
            "read_messages": read_message_ids
        }, status=status.HTTP_200_OK)

    @extend_schema(
        summary="React to a message",
        description="Toggle emoji reaction on a message.",
        tags=MsgTag,
        request=inline_serializer(
            name='ReactionRequest',
            fields={'emoji': drf_serializers.CharField()}
        ),
        responses={200: inline_serializer(
            name='ReactionResponse',
            fields={'status': drf_serializers.CharField(), 'action': drf_serializers.CharField()}
        )}
    )
    @action(detail=True, methods=["post"])
    def react(self, request, pk=None):
        message = self.get_object()
        emoji = request.data.get('emoji')

        if not emoji:
            return Response({"error": "Emoji is required"}, status=status.HTTP_400_BAD_REQUEST)

        # Toggle reaction
        reaction, created = MessageReaction.objects.get_or_create(
            message=message,
            user=request.user,
            emoji=emoji
        )

        if not created:
            # If exists, remove it (toggle off)
            reaction.delete()
            action = 'removed'
        else:
            action = 'added'

        # Broadcast reaction update
        broadcast_to_redis('message_reaction', {
            'message_id': str(message.id),
            'user_id': str(request.user.id),
            'username': request.user.username,
            'emoji': emoji,
            'action': action,
            'timestamp': timezone.now().isoformat()
        })
        
        return Response({"status": "success", "action": action}, status=status.HTTP_200_OK)

    # ADD THIS HELPER METHOD (Optimized with aggregated queries)
    def _get_unread_counts_for_user(self, user):
        """Helper to calculate unread counts for a user using aggregated queries"""
        read_ids = set(
            MessageReadReceipt.objects.filter(user=user)
            .values_list('message_id', flat=True)
        )
        
        user_group_ids = list(
            Group.objects.filter(groupmember__user=user)
            .values_list('id', flat=True)
        )
        
        # Aggregate unread counts per group
        group_counts = {}
        if user_group_ids:
            counts = (
                Message.objects.filter(
                    message_type='group',
                    group_id__in=user_group_ids,
                )
                .exclude(sender=user)
                .values('group_id')
                .annotate(unread=Count('id', filter=~Q(id__in=read_ids)))
                .values('group_id', 'unread')
            )
            for c in counts:
                if c['unread'] > 0:
                    group_counts[str(c['group_id'])] = c['unread']
        
        # Aggregate unread counts per private sender
        user_counts = {}
        sender_counts = (
            Message.objects.filter(
                message_type='private',
                recipient=user,
            )
            .exclude(sender=user)
            .values('sender_id')
            .annotate(unread=Count('id', filter=~Q(id__in=read_ids)))
            .values('sender_id', 'unread')
        )
        for c in sender_counts:
            if c['unread'] > 0:
                user_counts[str(c['sender_id'])] = c['unread']
        
        total_unread = sum(group_counts.values()) + sum(user_counts.values())
        all_chats = {**group_counts, **user_counts}
        
        return {
            'total_unread': total_unread,
            'groups': group_counts,
            'users': user_counts,
            'all_chats': all_chats
        }

    @extend_schema(
        summary="Get unread messages",
        description="Get IDs of unread messages for the current user.",
        tags=MsgTag,
        responses={200: inline_serializer(
            name='UnreadMessagesResponse',
            fields={
                'unread_count': drf_serializers.IntegerField(),
                'unread_message_ids': drf_serializers.ListField(child=drf_serializers.UUIDField())
            }
        )}
    )
    @action(detail=False, methods=["get"])
    def unread(self, request):
        """Get unread message IDs for current user"""
        # Get all messages accessible to user
        all_messages = self.get_queryset()
        
        # Get messages that have been read
        read_messages = MessageReadReceipt.objects.filter(
            user=request.user,
            message__in=all_messages
        ).values_list('message_id', flat=True)
        
        # Find unread messages
        unread_messages = all_messages.exclude(id__in=read_messages)
        unread_ids = list(unread_messages.values_list('id', flat=True))
        
        return Response({
            'unread_count': len(unread_ids),
            'unread_message_ids': unread_ids
        }, status=status.HTTP_200_OK)

    # In views.py
    @extend_schema(
        summary="Get message read receipts",
        description="Get list of users who have read a specific message.",
        tags=MsgTag,
        parameters=[
            OpenApiParameter(name='message_id', type=OpenApiTypes.UUID, description='Message ID', required=True),
        ],
        responses={200: inline_serializer(
            name='ReadReceiptsResponse',
            fields={
                'message_id': drf_serializers.UUIDField(),
                'readers': drf_serializers.ListField(child=drf_serializers.DictField())
            }
        )}
    )
    @action(detail=False, methods=["get"], url_path="read-receipts")
    def read_receipts(self, request):
        """Get read receipts for a specific message"""
        message_id = request.query_params.get('message_id')
        
        if not message_id:
            return Response({"error": "message_id parameter is required"}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            message = Message.objects.get(id=message_id)
            
            # Check permission
            if not self.has_permission_to_view_message(request.user, message):
                return Response({"error": "You don't have permission to view this message"}, 
                            status=status.HTTP_403_FORBIDDEN)
            
            # Get read receipts
            receipts = MessageReadReceipt.objects.filter(message=message).select_related('user')
            
            readers = [{
                'user_id': str(receipt.user.id),
                'username': receipt.user.username,
                'read_at': receipt.read_at.isoformat()
            } for receipt in receipts]
            
            return Response({
                'message_id': str(message_id),
                'readers': readers
            })
            
        except Message.DoesNotExist:
            return Response({"error": "Message not found"}, status=status.HTTP_404_NOT_FOUND)
        
    def has_permission_to_view_message(self, user, message):
        """Check if user can view this message"""
        if message.message_type == 'group':
            return GroupMember.objects.filter(user=user, group=message.group).exists()
        else:
            return user == message.sender or user == message.recipient

    @extend_schema(
        summary="Get unread message counts",
        description="Get unread message counts for all chats (groups and users)",
        tags=MsgTag,
        responses={200: inline_serializer(
            name='UnreadCountsResponse',
            fields={
                'total_unread': drf_serializers.IntegerField(),
                'groups': drf_serializers.DictField(),
                'users': drf_serializers.DictField(),
                'all_chats': drf_serializers.DictField()
            }
        )}
    )
    @action(detail=False, methods=["get"], url_path="unread_counts")
    def unread_counts(self, request):
        """Get unread message counts for all chats (optimized)"""
        counts = self._get_unread_counts_for_user(request.user)
        return Response(counts, status=status.HTTP_200_OK)

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
    

from django.db.models import Q, Max, Count, OuterRef, Subquery, F, Case, When, Window, UUIDField
from django.db.models.functions import RowNumber
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

@extend_schema(
    summary="Get user's chat list",
    description=(
        "Returns all conversations (groups + private chats) where the user has ≥1 message.\n\n"
        "Features:\n"
        "- Includes last message preview\n"
        "- Ordered by most recent message first\n"
        "- Shows unread counts per chat\n"
        "- Supports both group and private chats"
    ),
    tags=["Chats"],
    responses={200: inline_serializer(
        name='ChatListResponse',
        fields={
            'chats': drf_serializers.ListField(),
            'count': drf_serializers.IntegerField()
        }
    )}
)
@api_view(['GET'])
def get_chat_list(request):
    """
    Get comprehensive chat list for authenticated user.
    Combines group chats and private conversations with last message metadata.
    """
    user = request.user
    chats = []
    
    # Batch fetch all read message IDs for this user (shared across groups and private)
    all_read_ids = set(
        MessageReadReceipt.objects.filter(user=user).values_list('message_id', flat=True)
    )
    
    # ===================================================================
    # PART 1: GROUP CHATS
    # ===================================================================
    
    user_group_ids = Group.objects.filter(groupmember__user=user).values_list('id', flat=True)
    
    member_counts = dict(
        GroupMember.objects.filter(group_id__in=user_group_ids)
        .values('group_id')
        .annotate(count=Count('id'))
        .values_list('group_id', 'count')
    )
    
    admin_group_ids = set(
        GroupMember.objects.filter(
            group_id__in=user_group_ids, user=user, is_admin=True
        ).values_list('group_id', flat=True)
    )
    
    # Get groups user is member of with last message
    last_group_message = Message.objects.filter(
        message_type='group',
        group=OuterRef('pk')
    ).order_by('-created_at')
    
    groups_with_messages = Group.objects.filter(
        id__in=user_group_ids
    ).annotate(
        last_message_id=Subquery(last_group_message.values('id')[:1]),
        last_message_content=Subquery(last_group_message.values('content')[:1]),
        last_message_time=Subquery(last_group_message.values('created_at')[:1]),
        last_message_sender=Subquery(last_group_message.values('sender__username')[:1])
    ).filter(
        last_message_time__isnull=False
    ).select_related('created_by')
    
    # Batch fetch unread counts per group
    all_group_messages = Message.objects.filter(
        message_type='group',
        group_id__in=user_group_ids
    ).exclude(sender=user)
    
    unread_group_counts = {}
    for gm in all_group_messages.values('group_id').annotate(
        total=Count('id'),
        unread=Count('id', filter=~Q(id__in=all_read_ids))
    ):
        if gm['unread'] > 0:
            unread_group_counts[str(gm['group_id'])] = gm['unread']
    
    for group in groups_with_messages:
        unread_count = unread_group_counts.get(str(group.id), 0)
        
        chats.append({
            'id': str(group.id),
            'type': 'group',
            'name': group.name,
            'last_message': group.last_message_content,
            'last_message_time': group.last_message_time.isoformat() if group.last_message_time else None,
            'last_message_sender': group.last_message_sender,
            'unread_count': unread_count,
            'member_count': member_counts.get(group.id, 0),
            'is_admin': group.id in admin_group_ids,
            'avatar_color': generate_avatar_color(group.name)
        })
    
    # ===================================================================
    # PART 2: PRIVATE CHATS (Optimized with bulk queries)
    # ===================================================================
    
    latest_partner_messages = (
        Message.objects.filter(
            Q(message_type='private', sender=user) |
            Q(message_type='private', recipient=user)
        )
        .annotate(
            partner_id=Case(
                When(sender_id=user.pk, then=F('recipient_id')),
                default=F('sender_id'),
                output_field=UUIDField(),
            ),
            rn=Window(
                expression=RowNumber(),
                partition_by=[F('partner_id')],
                order_by=[F('created_at').desc(), F('id').desc()],
            ),
        )
        .filter(rn=1)
        .select_related('sender', 'recipient')
    )
    
    # Build conversation partner IDs and last message per partner in bulk
    partner_last_msg = {}  # partner_id -> last message
    partner_unread = {}    # partner_id -> unread count
    
    for msg in latest_partner_messages:
        partner_last_msg[str(msg.partner_id)] = msg
    
    if partner_last_msg:
        partner_ids = list(partner_last_msg.keys())
        partners = {str(u.id): u for u in User.objects.filter(id__in=partner_ids).only('id', 'username', 'email')}
        
        # Batch fetch unread counts per partner
        incoming = Message.objects.filter(
            message_type='private', recipient=user, sender_id__in=partner_ids
        ).exclude(sender=user)
        
        counts = incoming.values('sender_id').annotate(
            total=Count('id'),
            unread=Count('id', filter=~Q(id__in=all_read_ids))
        )
        for c in counts:
            if c['unread'] > 0:
                partner_unread[str(c['sender_id'])] = c['unread']
    
        for partner_id_str, last_msg in partner_last_msg.items():
            partner = partners.get(partner_id_str)
            if not partner:
                continue
            
            chats.append({
                'id': partner_id_str,
                'type': 'private',
                'name': partner.username,
                'last_message': last_msg.content,
                'last_message_time': last_msg.created_at.isoformat(),
                'last_message_sender': last_msg.sender.username,
                'unread_count': partner_unread.get(partner_id_str, 0),
                'email': partner.email,
                'is_online': is_user_online(partner_id_str),
                'avatar_color': generate_avatar_color(partner.username)
            })
    
    # ===================================================================
    # SORT BY MOST RECENT
    # ===================================================================
    chats.sort(key=lambda x: x['last_message_time'] or '', reverse=True)
    
    return Response({
        'chats': chats,
        'count': len(chats)
    }, status=status.HTTP_200_OK)


# Helper functions
def generate_avatar_color(name):
    """Generate consistent color for avatar based on name hash"""
    colors = [
        '#4f46e5', '#7c3aed', '#db2777', '#dc2626',
        '#ea580c', '#d97706', '#65a30d', '#16a34a',
        '#059669', '#0891b2', '#0284c7', '#2563eb'
    ]
    hash_value = sum(ord(c) for c in name)
    return colors[hash_value % len(colors)]


def is_user_online(user_id):
    """Check if user is online via the Redis tracking set maintained by the WebSocket server."""
    try:
        redis_client = get_redis_connection("default")
        return bool(redis_client.sismember('online_users', str(user_id)))
    except Exception as e:
        logger.warning(f"Failed to check online status for user {user_id}: {e}")
        return False
    
from rest_framework.viewsets import GenericViewSet

@extend_schema_view(
    upload_public_key=extend_schema(
        summary="Upload public key",
        description="Upload your public key for E2E encryption",
        tags=["Encryption"]
    ),
    get_public_key=extend_schema(
        summary="Get user's public key",
        description="Fetch a user's public key for encryption",
        tags=["Encryption"]
    ),
)
class UserPublicKeyViewSet(GenericViewSet):
    """
    ViewSet for managing user public encryption keys.
    
    Endpoints:
    - POST /user-keys/me/public-key/ - Upload your public key
    - GET /user-keys/{user_id}/public-key/ - Get another user's public key
    """
    queryset = User.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = User.objects.all()
        # Multi-tenant scoping: only expose users within the request's workspace.
        workspace = current_workspace(self.request)
        if workspace is not None:
            qs = qs.filter(workspace=workspace)
        return qs
    
    @action(detail=False, methods=['post'], url_path='me/public-key')
    def upload_public_key(self, request):
        """Upload current user's public encryption key"""
        public_key = request.data.get('public_key')
        
        if not public_key:
            return Response(
                {'error': 'public_key field is required'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        request.user.public_key = public_key
        request.user.save()
        
        logger.info(f"✅ Public key uploaded for user {request.user.username}")
        
        return Response({
            'status': 'success',
            'message': 'Public key uploaded successfully'
        }, status=status.HTTP_200_OK)
    
    @action(detail=True, methods=['get'], url_path='public-key')
    def get_public_key(self, request, pk=None):
        """Get a specific user's public encryption key"""
        user = self.get_object()
        
        if not user.public_key:
            return Response(
                {'error': 'User has not enabled encryption'}, 
                status=status.HTTP_404_NOT_FOUND
            )
        
        logger.info(f"📤 Public key requested for user {user.username}")
        
        return Response({
            'public_key': user.public_key,
            'user_id': str(user.id),
            'username': user.username
        }, status=status.HTTP_200_OK)
    

# ✅ NEW: Add endpoint to get public keys in bulk (for group encryption)
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

@extend_schema(
    summary="Get public keys for multiple users",
    description="Fetch public keys for a list of user IDs (for group message encryption)",
    tags=["Encryption"],
    request=inline_serializer(
        name='BulkPublicKeysRequest',
        fields={'user_ids': drf_serializers.ListField(child=drf_serializers.UUIDField())}
    ),
    responses={200: inline_serializer(
        name='BulkPublicKeysResponse',
        fields={'public_keys': drf_serializers.DictField()}
    )}
)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def get_bulk_public_keys(request):
    """Get public keys for multiple users at once"""
    user_ids = request.data.get('user_ids', [])
    
    if not user_ids:
        return Response({'error': 'user_ids required'}, status=status.HTTP_400_BAD_REQUEST)
    
    users = User.objects.filter(id__in=user_ids, public_key__isnull=False)
    # Multi-tenant scoping: only return keys for users within the request's workspace.
    workspace = current_workspace(request)
    if workspace is not None:
        users = users.filter(workspace=workspace)
    
    public_keys = {
        str(user.id): user.public_key
        for user in users
    }
    
    return Response({'public_keys': public_keys}, status=status.HTTP_200_OK)