"""Multi-tenant authentication for workspace / API-key access.

End-users authenticate with their normal JWT (their ``User.workspace`` provides the
tenant). Embedding applications authenticate server-to-server with an API key via
``X-Workspace-ID`` + ``X-Workspace-Key`` headers.
"""

import secrets

from django.contrib.auth import get_user_model

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission

from .models import Workspace


class WorkspacePrincipal:
    """Lightweight principal returned when a request authenticates via an API key."""

    is_authenticated = True
    is_active = True
    is_staff = False

    def __init__(self, workspace: Workspace):
        self.workspace = workspace

    @property
    def pk(self):
        # Stable identity for DRF throttling caches (UserRateThrottle).
        return str(self.workspace.id)

    @property
    def is_anonymous(self):
        return False


class WorkspaceAPIAuthentication(BaseAuthentication):
    """Authenticates a server-to-server request using an API key.

    Requires ``X-Workspace-ID`` and ``X-Workspace-Key`` headers. When a valid key is
    presented, ``request.workspace`` is set and the authenticated user becomes a
    :class:`WorkspacePrincipal`. When no API key is present, authentication is
    skipped (so the normal JWT flow continues).
    """

    def authenticate(self, request):
        key = request.headers.get('X-Workspace-Key')
        workspace_id = request.headers.get('X-Workspace-ID')
        if not key or not workspace_id:
            return None

        try:
            workspace = Workspace.objects.get(pk=workspace_id)
        except (Workspace.DoesNotExist, ValueError):
            raise AuthenticationFailed('Invalid workspace.')

        if not workspace.verify_api_key(key):
            raise AuthenticationFailed('Invalid API key.')

        # Attach the resolved workspace to the request for queryset scoping.
        request.workspace = workspace
        return (WorkspacePrincipal(workspace), None)

    def authenticate_header(self, request):
        return 'ApiKey'


def generate_api_key() -> str:
    """Generate a raw API key (called once; only the hash is persisted)."""
    return secrets.token_urlsafe(32)


def current_workspace(request):
    """Return the effective workspace for a request, or None.

    For API-key requests the workspace came from the ``X-Workspace-ID`` header; for
    end-user requests it comes from ``user.workspace``. Returns None in legacy /
    single-tenant mode, where behavior is unchanged.
    """
    if getattr(request, 'workspace', None) is not None:
        return request.workspace

    user = getattr(request, 'user', None)
    if user is not None and getattr(user, 'workspace_id', None):
        try:
            if getattr(user, 'is_authenticated', False) or getattr(user, 'is_anonymous', True) is False:
                return user.workspace
        except Exception:
            return None
    return None


class IsWorkspaceAPIKey(BasePermission):
    """Allow access only to requests authenticated via a workspace API key."""

    message = 'A valid workspace API key (X-Workspace-ID + X-Workspace-Key) is required.'

    def has_permission(self, request, view):
        return isinstance(getattr(request, 'user', None), WorkspacePrincipal)