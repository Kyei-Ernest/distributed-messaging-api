from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action

from django.contrib.auth import get_user_model

from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError

from drf_spectacular.utils import (
    extend_schema,
    OpenApiResponse,
    OpenApiExample,
    extend_schema_view
)

from .serializers import (
    UserSerializer,
    UserCreateSerializer,
    LoginSerializer,
    TokenRefreshCustomSerializer,
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
    #permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        return UserSerializer

    def get_queryset(self):
        """
        Returns users.
        NOTE: Can be scoped later (e.g., self / organization).
        """
        return User.objects.all()

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
# Authentication
# =====================================================

class LoginView(APIView):
    """
    User login endpoint.
    """

    authentication_classes = []
    permission_classes = [permissions.AllowAny]

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
