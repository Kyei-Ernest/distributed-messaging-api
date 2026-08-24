from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone
from django.db.models import F
from django.contrib.auth import get_user_model

import logging

logger = logging.getLogger(__name__)


@receiver(post_save, sender='messaging.Message')
def _bump_workspace_usage(sender, instance, created, **kwargs):
    """Increment the sender's workspace daily message count (for metering).

    Only counters messages that belong to a workspace; single-tenant users with no
    workspace are ignored (legacy behavior is unchanged).
    """
    if not created:
        return

    workspace_id = None
    if instance.message_type == 'group':
        workspace_id = (
            sender._meta.get_field('group').remote_field.model
            .objects.filter(pk=instance.group_id)
            .values_list('workspace_id', flat=True)
            .first()
        )
    else:
        workspace_id = (
            get_user_model().objects.filter(pk=instance.sender_id)
            .values_list('workspace_id', flat=True)
            .first()
        )

    if not workspace_id:
        return

    try:
        import accounts.models as accounts_models
        usage, _ = accounts_models.WorkspaceDailyUsage.objects.get_or_create(
            workspace_id=workspace_id,
            date=timezone.localdate(),
        )
        usage.message_count = F('message_count') + 1
        usage.save(update_fields=['message_count'])
    except Exception as e:  # pragma: no cover - metering must never break messaging
        logger.error("Failed to record workspace usage: %s", e)

    _emit_workspace_webhook(instance, workspace_id)


def _emit_workspace_webhook(message, workspace_id) -> None:
    """Best-effort webhook fan-out for workspace message events.

    Wrapped in try/except like metering above — integrations must never be
    able to break the messaging hot path.
    """
    try:
        from accounts.webhooks import emit_workspace_event
        from accounts.models import Workspace

        sender_username = (
            get_user_model().objects.filter(pk=message.sender_id)
            .values_list('username', flat=True).first()
        )
        data = {
            'message_id': str(message.id),
            'message_type': message.message_type,
            'group_id': str(message.group_id) if message.group_id else None,
            'recipient_id': str(message.recipient_id) if message.recipient_id else None,
            'sender_id': str(message.sender_id),
            'sender_username': sender_username,
            'created_at': message.created_at.isoformat() if message.created_at else None,
            # Never ship ciphertext or key material to third parties.
            'content': None if message.is_encrypted else message.content,
            'is_encrypted': bool(message.is_encrypted),
        }
        workspace = Workspace.objects.filter(pk=workspace_id).first()
        if workspace is not None:
            emit_workspace_event(workspace, 'message_created', data)
    except Exception as e:  # pragma: no cover
        logger.error("Failed to dispatch workspace webhook: %s", e)