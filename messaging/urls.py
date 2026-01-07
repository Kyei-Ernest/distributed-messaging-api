from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import GroupViewSet,MessageViewSet,UserPublicKeyViewSet, get_bulk_public_keys, get_chat_list

router = DefaultRouter()
router.register(r"groups", GroupViewSet, basename="group")
router.register(r"messages", MessageViewSet, basename="message")
router.register(r"user-keys", UserPublicKeyViewSet, basename="user-public-key")

urlpatterns = [
    path("", include(router.urls)),
    path("chats/", get_chat_list, name="chat-list"),
    path('bulk-public-keys/',get_bulk_public_keys, name='bulk-public-keys'),

]
