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

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["group", "created_at"]),
            models.Index(fields=["recipient", "created_at"]),
        ]




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
