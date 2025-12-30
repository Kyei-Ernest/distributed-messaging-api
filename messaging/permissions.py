"""
Custom permission classes for the messaging app.
These enforce fine-grained access control for groups and messages.
"""

from rest_framework import permissions
from .models import GroupMember, Message


class IsGroupMember(permissions.BasePermission):
    """
    Permission to check if user is a member of the group.
    Used for viewing group details, messages, etc.
    """
    message = "You must be a member of this group to perform this action."

    def has_object_permission(self, request, view, obj):
        # obj should be a Group instance
        return GroupMember.objects.filter(
            user=request.user,
            group=obj
        ).exists()


class IsGroupAdmin(permissions.BasePermission):
    """
    Permission to check if user is an admin of the group.
    Used for updating group details, managing members, etc.
    """
    message = "You must be an admin of this group to perform this action."

    def has_object_permission(self, request, view, obj):
        # obj should be a Group instance
        membership = GroupMember.objects.filter(
            user=request.user,
            group=obj
        ).first()
        
        return membership and membership.is_admin


class IsGroupCreator(permissions.BasePermission):
    """
    Permission to check if user is the creator of the group.
    Used for deleting groups.
    """
    message = "Only the group creator can perform this action."

    def has_object_permission(self, request, view, obj):
        # obj should be a Group instance
        return obj.created_by == request.user


class IsMessageSender(permissions.BasePermission):
    """
    Permission to check if user is the sender of the message.
    Used for editing or deleting messages.
    """
    message = "You can only modify your own messages."

    def has_object_permission(self, request, view, obj):
        # obj should be a Message instance
        return obj.sender == request.user


class CanAccessMessage(permissions.BasePermission):
    """
    Permission to check if user can access a message.
    - For group messages: user must be a member of the group
    - For private messages: user must be sender or recipient
    """
    message = "You do not have permission to access this message."

    def has_object_permission(self, request, view, obj):
        # obj should be a Message instance
        user = request.user

        if obj.message_type == "group":
            # Check if user is member of the group
            return GroupMember.objects.filter(
                user=user,
                group=obj.group
            ).exists()
        
        elif obj.message_type == "private":
            # Check if user is sender or recipient
            return user == obj.sender or user == obj.recipient
        
        return False


class IsGroupMemberOrReadOnly(permissions.BasePermission):
    """
    Permission for read-only access to groups.
    - Anyone can list and view groups
    - Only members can perform write operations
    """
    def has_permission(self, request, view):
        # Allow read permissions for any request
        if request.method in permissions.SAFE_METHODS:
            return True
        
        # Write permissions require authentication
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        # Read permissions for anyone
        if request.method in permissions.SAFE_METHODS:
            return True
        
        # Write permissions only for group members
        return GroupMember.objects.filter(
            user=request.user,
            group=obj
        ).exists()


