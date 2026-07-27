from django.urls import path, include
from rest_framework.routers import SimpleRouter
from .views import UserViewSet, LoginView, LogoutView, TokenRefreshView

router = SimpleRouter()
router.register(r"users", UserViewSet, basename="user")

urlpatterns = [
    # Auth
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),

    
    path("", include(router.urls)),
]
