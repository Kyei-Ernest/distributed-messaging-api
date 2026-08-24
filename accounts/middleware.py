"""Per-workspace CORS for embedded integrations.

Global CORS stays configured via ``CORS_ALLOWED_ORIGINS`` (django-cors-headers).
This middleware additionally honors each tenant's ``Workspace.allowed_origins``
so embedding applications can plug in without a platform redeploy:

    Origin: https://customer-app.example
      -> any workspace listing that origin gets API access from its pages.

Position: FIRST in MIDDLEWARE (before django-cors-headers) so it can answer
CORS preflights for tenant origins — corsheaders short-circuits unknown
origins and inner middlewares never see those requests. For non-preflight
requests it decorates the normal response only when global CORS did not.

Token-based auth means credentials (cookies) are never required.
"""

from time import time

from django.http import HttpResponse

from .models import Workspace

API_PATH_PREFIXES = ('/api/',)
_CACHE_TTL_SECONDS = 60


class WorkspaceOriginMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self._allowed_cache = set()
        self._cache_expires_at = 0

    def _origin_allowed(self, origin: str) -> bool:
        now = time()
        if now >= self._cache_expires_at:
            allowed = set()
            for values in Workspace.objects.exclude(allowed_origins=[]) \
                    .values_list('allowed_origins', flat=True):
                allowed.update(values or [])
            # JSONField __contains__ is not portable across backends (SQLite),
            # hence the Python-side match against a small cached universe.
            self._allowed_cache = allowed
            self._cache_expires_at = now + _CACHE_TTL_SECONDS
        return origin in self._allowed_cache

    @staticmethod
    def _decorate(response, origin: str) -> None:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = \
            'GET, POST, PUT, PATCH, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = \
            'Authorization, Content-Type, X-Workspace-ID, X-Workspace-Key'
        response.headers.setdefault('Vary', 'Origin')
        response.headers['Access-Control-Max-Age'] = '86400'

    def __call__(self, request):
        origin = request.headers.get('Origin')
        if not origin or not request.path.startswith(API_PATH_PREFIXES):
            return self.get_response(request)

        if not self._origin_allowed(origin):
            return self.get_response(request)

        # CORS preflight: answer directly with permissive headers.
        if request.method == 'OPTIONS' and 'access-control-request-method' in \
                {k.lower() for k in request.headers}:
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)

        if not response.headers.get('Access-Control-Allow-Origin'):
            self._decorate(response, origin)
        return response
