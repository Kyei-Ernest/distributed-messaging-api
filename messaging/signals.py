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