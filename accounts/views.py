from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta

from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError

from drf_spectacular.utils import (
    extend_schema,
    OpenApiResponse,
    OpenApiExample,
    extend_schema_view
)

from .authentication import generate_api_key, current_workspace, IsWorkspaceAPIKey
from .models import Workspace, WorkspaceWebhook
from .webhooks import emit_workspace_event
from .permissions import IsSelfOrAdmin
from .serializers import (
    UserSerializer,
    UserCreateSerializer,
    LoginSerializer,
    TokenRefreshCustomSerializer,
    WorkspaceSerializer,
    WorkspaceWebhookSerializer,
)

User = get_user_model()

Authtag = ["Authentication"]
UserTag = ["Users"]



# =====================================================
# User Management
# =====================================================

@extend_schema_view(
    list=extend_schema(
        summary="List users",
        description="Retrieve a list of all users.",
        responses={200: UserSerializer(many=True)},
        tags=UserTag
    ),
    create=extend_schema(
        summary="Create user",
        description="Create a new user account.",
        request=UserCreateSerializer,
        responses={201: UserSerializer},
        tags=UserTag
    ),
    retrieve=extend_schema(
        summary="Retrieve user",
        description="Retrieve a user by ID.",
        responses={200: UserSerializer},
        tags=UserTag
    ),
    update=extend_schema(
        summary="Update user",
        description="Update a user completely.",
        tags=UserTag
    ),
    partial_update=extend_schema(
        summary="Partially update user",
        description="Update one or more user fields.",
        tags=UserTag
    ),
    destroy=extend_schema(
        summary="Delete user",
        description="Delete a user account.",
        tags=UserTag
    ),
)
class UserViewSet(viewsets.ModelViewSet):
    """
    User management endpoints.
    """

    queryset = User.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        return UserSerializer

    def get_permissions(self):
        if self.action == "create":
            return [permissions.AllowAny()]
        # Object-modifying actions must be performed by the owning user (or an admin).
        if self.action in ("update", "partial_update", "destroy"):
            return [permissions.IsAuthenticated(), IsSelfOrAdmin()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        qs = User.objects.all()
        # Multi-tenant scoping: when a workspace is resolved for the request, only
        # users within that workspace are visible.
        workspace = current_workspace(self.request)
        if workspace is not None:
            qs = qs.filter(workspace=workspace)
        return qs

    @extend_schema(
        summary="Get current user",
        description="Retrieve the authenticated user's profile details.",
        responses={200: UserSerializer},
        tags=UserTag
    )
    @action(detail=False, methods=["get"], url_path="me")
    def me(self, request):
        serializer = UserSerializer(request.user)
        return Response(serializer.data, status=status.HTTP_200_OK)


# =====================================================
# Workspace (multi-tenant) provisioning
# =====================================================

class WorkspaceViewSet(viewsets.ModelViewSet):
    """
    Manage tenant Workspaces. Creating a workspace issues an API key that the
    embedding application uses for server-to-server calls. The raw key is returned
    only once at creation/regeneration (only its hash is stored).
    """

    queryset = Workspace.objects.all().order_by('-created_at')
    serializer_class = WorkspaceSerializer
    permission_classes = [permissions.IsAdminUser]

    @extend_schema(
        summary='List workspaces', tags=['Workspaces'],
        responses=WorkspaceSerializer,
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(
        summary='Create workspace (returns the API key once)', tags=['Workspaces'],
        request=WorkspaceSerializer, responses=WorkspaceSerializer,
    )
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        workspace = serializer.save()

        raw_key = generate_api_key()
        workspace.issue_api_key(raw_key)

        data = WorkspaceSerializer(workspace).data
        data['api_key'] = raw_key  # shown only once
        return Response(data, status=status.HTTP_201_CREATED)

    @extend_schema(summary='Fetch a workspace', tags=['Workspaces'])
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @extend_schema(summary='Update a workspace', tags=['Workspaces'])
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

    @extend_schema(summary='Partially update a workspace', tags=['Workspaces'])
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)

    @extend_schema(summary='Delete a workspace', tags=['Workspaces'])
    def destroy(self, request, *args, **kwargs):
        return super().destroy(request, *args, **kwargs)

    @extend_schema(
        summary='Regenerate workspace API key',
        description='Invalidates the old key and issues a new one (returned once).',
        tags=['Workspaces']
    )
    @action(detail=True, methods=['post'], url_path='regenerate-key')
    def regenerate_key(self, request, pk=None):
        workspace = self.get_object()
        raw_key = generate_api_key()
        workspace.issue_api_key(raw_key)
        return Response({'id': str(workspace.id), 'api_key': raw_key})

    @extend_schema(
        summary='Workspace usage',
        description='Rolling 7-day message usage vs. the configured daily quota.',
        tags=['Workspaces']
    )
    @action(detail=True, methods=['get'], url_path='usage')
    def usage(self, request, pk=None):
        workspace = self.get_object()
        today = timezone.localdate()
        rows = workspace.daily_usage.filter(date__gte=today - timedelta(days=6))
        daily = {row.date.isoformat(): row.message_count for row in rows}
        total = sum(daily.values())
        quota = workspace.message_quota
        return Response({
            'workspace_id': str(workspace.id),
            'total_messages_7d': total,
            'quota': quota,
            'exceeded': bool(quota is not None and total >= quota),
            'daily': daily,
        })

    @extend_schema(
        summary='Workspace allowed origins',
        description='Browser origins allowed to embed this workspace (per-tenant CORS).',
        request={'application/json': {'type': 'object', 'properties': {
            'allowed_origins': {'type': 'array', 'items': {'type': 'string'}}}}},
        tags=['Workspaces']
    )
    @action(detail=True, methods=['get', 'put'], url_path='origins')
    def origins(self, request, pk=None):
        workspace = self.get_object()
        if request.method == 'PUT':
            origins = request.data.get('allowed_origins')
            if not isinstance(origins, list) or not all(isinstance(o, str) for o in origins):
                return Response(
                    {'detail': 'allowed_origins must be a list of origin strings.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            workspace.allowed_origins = origins
            workspace.save(update_fields=['allowed_origins'])
        return Response({
            'workspace_id': str(workspace.id),
            'allowed_origins': workspace.allowed_origins,
        })


# =====================================================
# Workspace webhooks (plug-and-play event subscriptions)
# =====================================================

class WorkspaceWebhookViewSet(viewsets.ModelViewSet):
    """
    Manage outbound webhook subscriptions for the authenticating workspace
    (API-key auth). Deliveries are HMAC-SHA256 signed — see accounts/webhooks.py.
    """

    serializer_class = WorkspaceWebhookSerializer
    permission_classes = [IsWorkspaceAPIKey]

    @extend_schema(summary='List webhook subscriptions', tags=['Webhooks'])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(
        summary='Create subscription (signing secret returned once)',
        tags=['Webhooks'],
    )
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    @extend_schema(summary='Fetch a webhook subscription', tags=['Webhooks'])
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @extend_schema(summary='Update a webhook subscription', tags=['Webhooks'])
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

    @extend_schema(summary='Partially update a webhook subscription', tags=['Webhooks'])
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)

    @extend_schema(summary='Delete a webhook subscription', tags=['Webhooks'])
    def destroy(self, request, *args, **kwargs):
        return super().destroy(request, *args, **kwargs)

    def get_queryset(self):
        workspace = current_workspace(self.request)
        if workspace is None:
            return WorkspaceWebhook.objects.none()
        return workspace.webhooks.all()

    def perform_create(self, serializer):
        import secrets as secrets_lib
        webhook = serializer.save(
            workspace=current_workspace(self.request),
            secret=secrets_lib.token_urlsafe(32),
        )
        # Surface the signing secret exactly once.
        self._created_secret = webhook.secret

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        secret = getattr(self, '_created_secret', None)
        if secret is not None:
            response.data['secret'] = secret  # shown once; never returned again
        return response

    @extend_schema(
        summary='Send a test event',
        description='Fires a signed "webhook.test" delivery to this subscription URL.',
        tags=['Webhooks']
    )
    @action(detail=True, methods=['post'], url_path='test')
    def test_fire(self, request, pk=None):
        webhook = self.get_object()
        emit_workspace_event(
            webhook.workspace,
            'webhook.test',
            {'webhook_id': str(webhook.id), 'message': 'It works!'},
        )
        return Response({'detail': f'Test event queued for {webhook.url}'})


# =====================================================
# Server-to-server provisioning (workspace API key)
# =====================================================

class ProvisionUserView(APIView):
    """
    Create an end-user inside the authenticating workspace. Authenticated with a
    workspace API key (``X-Workspace-ID`` + ``X-Workspace-Key``). The created user
    is scoped to that workspace, so all their data is tenant-isolated.
    """

    permission_classes = [IsWorkspaceAPIKey]

    @extend_schema(
        summary='Provision a workspace user',
        description='Create a user belonging to the authenticating workspace (server-to-server).',
        request=UserCreateSerializer,
        responses={201: UserSerializer},
        tags=['Provisioning']
    )
    def post(self, request):
        serializer = UserCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        user.workspace = request.workspace
        user.save(update_fields=['workspace'])
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class ProvisionGroupView(APIView):
    """
    Create a group (channel) inside the authenticating workspace. The owner must be
    an existing user of the same workspace; they become the group admin.
    """

    permission_classes = [IsWorkspaceAPIKey]

    @extend_schema(
        summary='Provision a workspace group',
        description='Create a group owned by a workspace user (server-to-server). Owner must be a user of the authenticating workspace and becomes its admin.',
        request={'application/json': {'type': 'object', 'required': ['name', 'owner_id'],
                                      'properties': {'name': {'type': 'string'},
                                                     'owner_id': {'type': 'string', 'format': 'uuid'},
                                                     'description': {'type': 'string'}}}},
        responses={'201': {'type': 'object', 'properties': {
            'id': {'type': 'string', 'format': 'uuid'}, 'name': {'type': 'string'}}}},
        tags=['Provisioning']
    )
    def post(self, request):
        workspace = request.workspace
        name = request.data.get('name')
        owner_id = request.data.get('owner_id')
        description = request.data.get('description', '')

        if not name or not owner_id:
            return Response(
                {'detail': 'name and owner_id are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Lazy import avoids an import cycle with the messaging app.
        from messaging.models import Group, GroupMember

        owner = User.objects.filter(pk=owner_id, workspace=workspace).first()
        if not owner:
            return Response(
                {'detail': 'owner_id must be a user in this workspace.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        group = Group.objects.create(
            name=name, description=description, created_by=owner, workspace=workspace
        )
        GroupMember.objects.create(user=owner, group=group, is_admin=True)
        return Response({'id': str(group.id), 'name': group.name}, status=status.HTTP_201_CREATED)


# =====================================================
# Authentication
# =====================================================

class LoginView(APIView):
    """
    User login endpoint.
    """

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AnonRateThrottle]
    throttle_scope = 'login'

    @extend_schema(
    tags=Authtag,
    summary="User login",
    description="Authenticate user and return JWT tokens.",
    request=LoginSerializer,
    responses={
        200: OpenApiResponse(
            response={
                "type": "object",
                "properties": {
                    "message": {"type": "string"},
                    "user": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            #"phone_number": {"type": ["string", "null"]},
                            "email": {"type": "string"},
                        },
                    },
                    "tokens": {
                        "type": "object",
                        "properties": {
                            "refresh": {"type": "string"},
                            "access": {"type": "string"},
                        },
                    },
                },
            },
            description="Login successful",
        ),
        400: OpenApiResponse(description="Invalid credentials"),
        403: OpenApiResponse(description="Account inactive"),
    },  
)
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = serializer.validated_data["user"]

        if not user.is_active:
            return Response(
                {"detail": "Account is inactive."},
                status=status.HTTP_403_FORBIDDEN,
            )

        refresh = RefreshToken.for_user(user)

        return Response(
            {
                "message": "Login successful",
                "user": {
                    "id": str(user.id),
                    "username": getattr(user, "username", None),
                    "email": user.email,
                },
                "tokens": {
                    "refresh": str(refresh),
                    "access": str(refresh.access_token),
                },
            },
            status=status.HTTP_200_OK,
        )


class TokenRefreshView(APIView):
    """
    JWT token refresh endpoint.
    """

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AnonRateThrottle]

    @extend_schema(
    tags=Authtag,
    summary="Refresh access token",
    request=TokenRefreshCustomSerializer,
    responses={
        200: OpenApiResponse(
            response={
                "type": "object",
                "properties": {
                    "access": {"type": "string"},
                },
            },
            description="New access token issued",
        ),
        400: OpenApiResponse(description="Invalid refresh token"),
    },
)
    def post(self, request):
        serializer = TokenRefreshCustomSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.validated_data, status=status.HTTP_200_OK)


class LogoutView(APIView):
    """
    User logout endpoint.
    """

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
    tags=Authtag,
    summary="User logout",
    description="Invalidate refresh token.",
    request={
        "application/json": {
            "type": "object",
            "properties": {
                "refresh": {"type": "string"},
            },
            "required": ["refresh"],
        }
    },
    responses={
        200: OpenApiResponse(
            response={
                "type": "object",
                "properties": {
                    "message": {"type": "string"},
                },
            },
            description="Logout successful",
        ),
        400: OpenApiResponse(description="Invalid or missing refresh token"),
    },
)
    def post(self, request):
        refresh_token = request.data.get("refresh")

        if not refresh_token:
            return Response(
                {"error": "Refresh token is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            token = RefreshToken(refresh_token)
            token.blacklist()
        except TokenError:
            return Response(
                {"error": "Invalid or already blacklisted refresh token."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {"message": "Logout successful. Refresh token invalidated."},
            status=status.HTTP_200_OK,
        )
