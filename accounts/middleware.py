"""Per-workspace CORS for embedded integrations.

Global CORS stays configured via ``CORS_ALLOWED_ORIGINS`` (django-cors-headers).
This middleware additionally honors each tenant's ``Workspace.allowed_origins``
so embedding applications can plug in without a platform redeploy:

    Origin: https://customer-app.example
      -> any workspace listing that origin gets API access from its pages.

Runs after django-cors-headers; it only ever ADDS headers when none were set.
Token-based auth means credentials (cookies) are never required, so the header
set is intentionally minimal.
"""

from .models import Workspace

API_PATH_PREFIXES = ('/api/',)


class WorkspaceOriginMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        origin = request.headers.get('Origin')
        if not origin or not request.path.startswith(API_PATH_PREFIXES):
            return response
        if response.headers.get('Access-Control-Allow-Origin'):
            return response  # global CORS already handled it

        # JSONField __contains__ is not portable across backends (SQLite), so
        # match in Python — tenant counts are small and this path only runs
        # for cross-origin API requests.
        allowed = set()
        for values in Workspace.objects.exclude(allowed_origins=[]) \
                .values_list('allowed_origins', flat=True):
            allowed.update(values or [])
        if origin in allowed:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Methods'] = \
                'GET, POST, PUT, PATCH, DELETE, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = \
                'Authorization, Content-Type, X-Workspace-ID, X-Workspace-Key'
            response.headers['Vary'] = 'Origin'

        return response
