import uuid
from django.db import models
from django.core.exceptions import ValidationError
from django.apps import apps

from django.conf import settings

User = settings.AUTH_USER_MODEL


class Group(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="created_groups"
    )
    members = models.ManyToManyField( User, through="GroupMember", related_name="member_groups")

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
    

class GroupMember(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    group = models.ForeignKey(Group, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)
    is_admin = models.BooleanField(default=False)

    class Meta:
        unique_together = ("user", "group")
        

class Message(models.Model):
    MESSAGE_TYPES = (
        ("group", "Group"),
        ("private", "Private"),
    )
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False
    )

    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPES)

    group = models.ForeignKey(
        Group,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="messages"
    )

    sender = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="sent_messages"
    )

    recipient = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="received_messages"
    )

    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    # Encryption fields
    is_encrypted = models.BooleanField(default=False)
    encrypted_content = models.TextField(null=True, blank=True)
    encrypted_key = models.TextField(null=True, blank=True)  # For recipient
    encrypted_key_self = models.TextField(null=True, blank=True)  # For sender
    encrypted_keys = models.JSONField(null=True, blank=True)  # For group messages
    iv = models.CharField(max_length=255, null=True, blank=True)
    
    # ✅ NEW: Reply functionality
    parent_message = models.ForeignKey(
        'self', 
        null=True, 
        blank=True, 
        on_delete=models.SET_NULL, 
        related_name='replies'
    )


    class Meta:
        indexes = [
            # Critical for chat list queries
            models.Index(fields=['message_type', 'group', '-created_at']),
            models.Index(fields=['message_type', 'sender', 'recipient', '-created_at']),
            
            # For filtering user's accessible messages
            models.Index(fields=['sender', '-created_at']),
            models.Index(fields=['recipient', '-created_at']),
        ]
        ordering = ['-created_at']  # Default ordering
    
    def __str__(self):
        return f"{self.sender.username}: {self.content[:50]}"



    def clean(self):
        super().clean()

        if self.message_type == "group":
            if not self.group:
                raise ValidationError("Group message must belong to a group.")

            GroupMember = apps.get_model(self._meta.app_label, "GroupMember")
            if not GroupMember.objects.filter(
                user=self.sender, group=self.group
            ).exists():
                raise ValidationError("Sender must be a member of the group.")

        if self.message_type == "private" and not self.recipient:
            raise ValidationError("Private message must have a recipient.")

        if self.message_type == "private" and self.group:
            raise ValidationError("Private message cannot belong to a group.")

        if self.message_type == "private" and self.sender == self.recipient:
            raise ValidationError("Cannot send message to yourself.")
        
# Add to models.py, after Message model
class MessageReadReceipt(models.Model):
    """Track which users have read which messages"""
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False
    )
    message = models.ForeignKey(
        Message, 
        on_delete=models.CASCADE, 
        related_name="read_receipts"
    )
    user = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        related_name="message_reads"
    )
    read_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ("message", "user")
        indexes = [
            models.Index(fields=["message", "user"]),
            models.Index(fields=["user", "read_at"]),
        ]

    def __str__(self):
        return f"{self.user.username} read message {self.message.id}"
    
# Add public key storage to User model
class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    public_key = models.TextField(null=True, blank=True)


class MessageReaction(models.Model):
    """Store emoji reactions to messages"""
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False
    )
    message = models.ForeignKey(
        Message, 
        on_delete=models.CASCADE, 
        related_name="reactions"
    )
    user = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        related_name="message_reactions"
    )
    emoji = models.CharField(max_length=10)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("message", "user", "emoji")
        indexes = [
            models.Index(fields=["message", "emoji"]),
        ]


