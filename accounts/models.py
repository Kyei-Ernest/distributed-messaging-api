import uuid
from django.db import models
from django.contrib.auth.models import AbstractUser
from django.contrib.auth import hashers as auth_hashers


class Workspace(models.Model):
    """
    A tenant / client application. Every end-user and group belongs to exactly one
    Workspace, which is what isolates one embedding application's data from another.

    The embedding app authenticates as a workspace via an API key (only the hash is
    stored; the raw key is shown once at issuance).
    """
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False
    )
    name = models.CharField(max_length=100, unique=True)
    api_key_hash = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Optional daily message entitlement (None = unlimited). Used by the usage
    # endpoint for plan/entitlement billing.
    message_quota = models.BigIntegerField(null=True, blank=True)

    def __str__(self):
        return self.name

    def issue_api_key(self, raw_key: str) -> None:
        """Persist a hash of the raw API key (never store the key itself)."""
        self.api_key_hash = auth_hashers.make_password(raw_key)
        self.save(update_fields=['api_key_hash'])

    def verify_api_key(self, raw_key: str) -> bool:
        """Safely verify a raw API key against the stored hash."""
        if not self.api_key_hash or not raw_key:
            return False
        return auth_hashers.check_password(raw_key, self.api_key_hash)


class WorkspaceDailyUsage(models.Model):
    """Daily per-workspace message count for metering/entitlements.

    Incremented via a ``post_save`` signal on ``messaging.Message``. Storing a
    daily aggregate (rather than an unbounded event log) keeps quota checks cheap.
    """
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name='daily_usage'
    )
    date = models.DateField()
    message_count = models.BigIntegerField(default=0)

    class Meta:
        ordering = ['-date']
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'date'], name='uniq_workspace_daily_usage')
        ]

    def __str__(self):
        return f"{self.workspace_id} {self.date}: {self.message_count}"


class User(AbstractUser):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False
    )

    public_key = models.TextField(null=True, blank=True)

    # Multi-tenant scoping: a user belongs to at most one workspace. End-users
    # created outside any workspace (default/single-tenant deploys) have this NULL,
    # preserving existing behavior.
    workspace = models.ForeignKey(
        'accounts.Workspace',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='users'
    )

    def __str__(self):
        return self.username
