from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from django.urls import reverse
from unittest.mock import patch

User = get_user_model()


class HealthCheckTests(APITestCase):

    def test_health_check_endpoint(self):
        url = reverse("health_check")
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "healthy")
        self.assertIn("database", response.data["services"])


class GroupTests(APITestCase):

    def setUp(self):
        self.user1 = User.objects.create_user(username="alice", password="Password123!")
        self.user2 = User.objects.create_user(username="bob", password="Password123!")
        self.client.force_authenticate(user=self.user1)

    def test_create_group(self):
        url = reverse("group-list")
        data = {
            "name": "Dev Team",
            "description": "Developer discussion channel"
        }
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "Dev Team")

    def test_list_groups(self):
        url = reverse("group-list")
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class MessageTests(APITestCase):

    def setUp(self):
        self.user1 = User.objects.create_user(username="alice", password="Password123!")
        self.user2 = User.objects.create_user(username="bob", password="Password123!")
        self.client.force_authenticate(user=self.user1)

    @patch("messaging.views.broadcast_to_redis")
    def test_send_private_message(self, mock_broadcast):
        url = reverse("message-list")
        data = {
            "message_type": "private",
            "recipient_id": str(self.user2.id),
            "content": "Hello Bob!"
        }
        response = self.client.post(url, data, format="json")
        self.assertIn(response.status_code, [status.HTTP_200_OK, status.HTTP_201_CREATED])

    def test_get_chat_list(self):
        url = reverse("chat-list")
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
