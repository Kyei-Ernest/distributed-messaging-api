from django.urls import path, include
from rest_framework.routers import SimpleRouter
from .views import (
    UserViewSet,
    LoginView,
    LogoutView,
    TokenRefreshView,
    WorkspaceViewSet,
    WorkspaceWebhookViewSet,
    ProvisionUserView,
    ProvisionGroupView,
)

router = SimpleRouter()
router.register(r"users", UserViewSet, basename="user")
router.register(r"workspaces", WorkspaceViewSet, basename="workspace")
router.register(r"webhooks", WorkspaceWebhookViewSet, basename="webhook")

urlpatterns = [
    # Auth
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),

    # Server-to-server provisioning (workspace API key)
    path("provision/users/", ProvisionUserView.as_view(), name="provision-users"),
    path("provision/groups/", ProvisionGroupView.as_view(), name="provision-groups"),

    path("", include(router.urls)),
]
