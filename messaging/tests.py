from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from django.urls import reverse
from unittest.mock import patch

User = get_user_model()
from django.utils import timezone
from .models import Message, Group
from accounts.models import Workspace, WorkspaceDailyUsage


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

    def test_groups_are_isolated_by_workspace(self):
        ws_a = Workspace.objects.create(name="Tenant-A")
        ws_b = Workspace.objects.create(name="Tenant-B")
        self.user1.workspace = ws_a
        self.user1.save()
        self.user2.workspace = ws_b
        self.user2.save()

        # user1 (Tenant-A) creates a group -> scoped to Tenant-A.
        self.client.force_authenticate(user=self.user1)
        create = self.client.post(
            reverse("group-list"), {"name": "TeamA", "description": ""}, format="json"
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED)
        group_id = create.data["id"]
        group = Group.objects.get(pk=group_id)
        self.assertEqual(str(group.workspace_id), str(ws_a.id))

        # user2 (Tenant-B) must not see or retrieve Tenant-A's group.
        self.client.force_authenticate(user=self.user2)
        list_resp = self.client.get(reverse("group-list"))
        ids = [g["id"] for g in list_resp.data["results"]]
        self.assertNotIn(str(group_id), ids)

        detail = self.client.get(reverse("group-detail", args=[group_id]))
        self.assertEqual(detail.status_code, status.HTTP_404_NOT_FOUND)

    def test_group_name_unique_per_workspace(self):
        ws_a = Workspace.objects.create(name="Unique-A")
        ws_b = Workspace.objects.create(name="Unique-B")
        self.user1.workspace = ws_a
        self.user1.save()
        self.user2.workspace = ws_b
        self.user2.save()

        # Create "Same" in Tenant-A.
        self.client.force_authenticate(user=self.user1)
        first = self.client.post(
            reverse("group-list"), {"name": "Same", "description": ""}, format="json"
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        # Duplicate "Same" in the same tenant is rejected.
        duplicate = self.client.post(
            reverse("group-list"), {"name": "Same", "description": ""}, format="json"
        )
        self.assertEqual(duplicate.status_code, status.HTTP_400_BAD_REQUEST)

        # Same name in a different tenant is allowed.
        self.client.force_authenticate(user=self.user2)
        other = self.client.post(
            reverse("group-list"), {"name": "Same", "description": ""}, format="json"
        )
        self.assertEqual(other.status_code, status.HTTP_201_CREATED)


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

    def test_get_chat_list_latest_message_per_private_partner(self):
        """get_chat_list must return the most recent message for each private partner."""
        user3 = User.objects.create_user(username="carol", password="Password123!")
        self.client.force_authenticate(user=self.user1)

        # user1 -> user2 (then a reply), and user3 -> user1; deterministic recency
        # is ensured by both created_at and id ordering in the windowed query.
        Message.objects.create(
            message_type="private", sender=self.user1, recipient=self.user2,
            content="hello bob",
        )
        Message.objects.create(
            message_type="private", sender=self.user2, recipient=self.user1,
            content="reply from bob",
        )
        Message.objects.create(
            message_type="private", sender=user3, recipient=self.user1,
            content="hi from carol",
        )

        response = self.client.get(reverse("chat-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        private = {c["id"]: c for c in response.data["chats"] if c["type"] == "private"}
        self.assertIn(str(self.user2.id), private)
        self.assertIn(str(user3.id), private)

        # Latest message per partner wins.
        self.assertEqual(private[str(self.user2.id)]["last_message"], "reply from bob")
        self.assertEqual(private[str(user3.id)]["last_message"], "hi from carol")

    def test_private_message_not_retrievable_across_workspaces(self):
        ws_a = Workspace.objects.create(name="Msg-A")
        ws_b = Workspace.objects.create(name="Msg-B")
        self.user1.workspace = ws_a
        self.user1.save()
        self.user2.workspace = ws_b
        self.user2.save()
        carol = User.objects.create_user(username="carol", password="Password123!")
        carol.workspace = ws_a
        carol.save()

        msg = Message.objects.create(
            message_type="private", sender=self.user1, recipient=carol, content="secret"
        )

        # user1 (same workspace) can access the message.
        self.client.force_authenticate(user=self.user1)
        ok = self.client.get(reverse("message-detail", args=[msg.id]))
        self.assertEqual(ok.status_code, status.HTTP_200_OK)

        # user2 (other workspace) must not see the message.
        self.client.force_authenticate(user=self.user2)
        denied = self.client.get(reverse("message-detail", args=[msg.id]))
        self.assertEqual(denied.status_code, status.HTTP_404_NOT_FOUND)

    def test_message_increments_workspace_usage(self):
        """Sending a message bumps the sender's workspace daily metering count."""
        ws = Workspace.objects.create(name="Meter-A")
        self.user1.workspace = ws
        self.user1.save()
        self.user2.workspace = ws
        self.user2.save()

        Message.objects.create(
            message_type="private", sender=self.user1, recipient=self.user2, content="one"
        )
        Message.objects.create(
            message_type="private", sender=self.user1, recipient=self.user2, content="two"
        )

        usage = WorkspaceDailyUsage.objects.get(workspace=ws, date=timezone.localdate())
        self.assertEqual(usage.message_count, 2)
