from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from django.urls import reverse

from .models import Workspace, WorkspaceDailyUsage
from django.utils import timezone

User = get_user_model()


class AccountsAuthenticationTests(APITestCase):

    def setUp(self):
        self.username = "testuser"
        self.email = "testuser@example.com"
        self.password = "SecurePassword123!"
        self.user = User.objects.create_user(
            username=self.username,
            email=self.email,
            password=self.password
        )

    def test_user_registration(self):
        url = reverse("user-list")
        data = {
            "username": "newuser",
            "email": "newuser@example.com",
            "password": "NewSecurePassword123!"
        }
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(username="newuser").exists())

    def test_user_login_success(self):
        """Login uses 'identifier' field (username or email) instead of 'username'."""
        url = reverse("login")
        data = {
            "identifier": self.username,
            "password": self.password
        }
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("tokens", response.data)
        self.assertIn("access", response.data["tokens"])
        self.assertIn("refresh", response.data["tokens"])

    def test_user_login_failure_invalid_credentials(self):
        url = reverse("login")
        data = {
            "identifier": self.username,
            "password": "WrongPassword123!"
        }
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_get_current_user_profile(self):
        # Login to get token
        login_url = reverse("login")
        login_resp = self.client.post(
            login_url,
            {"identifier": self.username, "password": self.password},
            format="json"
        )
        self.assertEqual(login_resp.status_code, status.HTTP_200_OK)
        token = login_resp.data["tokens"]["access"]

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me_url = reverse("user-me")
        response = self.client.get(me_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["username"], self.username)

    def test_user_login_with_email(self):
        """Verify login also works with email as identifier."""
        url = reverse("login")
        data = {
            "identifier": self.email,
            "password": self.password
        }
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("tokens", response.data)

    def test_user_cannot_modify_or_delete_another_user(self):
        """A logged-in user must not be able to update or delete another account."""
        other = User.objects.create_user(
            username="someone_else",
            email="someone_else@example.com",
            password="Password123!",
            first_name="Original",
        )
        self.client.force_authenticate(user=self.user)

        patch_resp = self.client.patch(
            reverse("user-detail", args=[other.id]),
            {"first_name": "Hacked"},
            format="json",
        )
        self.assertEqual(patch_resp.status_code, status.HTTP_403_FORBIDDEN)

        delete_resp = self.client.delete(reverse("user-detail", args=[other.id]))
        self.assertEqual(delete_resp.status_code, status.HTTP_403_FORBIDDEN)

        # The target account must still exist and be unchanged.
        other.refresh_from_db()
        self.assertEqual(other.first_name, "Original")

    def test_user_can_update_own_profile(self):
        """A user can still update their own profile."""
        self.client.force_authenticate(user=self.user)
        resp = self.client.patch(
            reverse("user-detail", args=[self.user.id]),
            {"first_name": "Renamed"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Renamed")

    def test_refresh_token_is_rotated(self):
        """Refresh must return a new refresh token and invalidate the old one."""
        login_resp = self.client.post(
            reverse("login"),
            {"identifier": self.username, "password": self.password},
            format="json",
        )
        self.assertEqual(login_resp.status_code, status.HTTP_200_OK)
        old_refresh = login_resp.data["tokens"]["refresh"]

        refresh_resp = self.client.post(
            reverse("token-refresh"),
            {"refresh": old_refresh},
            format="json",
        )
        self.assertEqual(refresh_resp.status_code, status.HTTP_200_OK)
        self.assertIn("access", refresh_resp.data)
        self.assertIn("refresh", refresh_resp.data)
        self.assertNotEqual(refresh_resp.data["refresh"], old_refresh)

        # Reusing the now-blacklisted old refresh token must be rejected.
        reuse_resp = self.client.post(
            reverse("token-refresh"),
            {"refresh": old_refresh},
            format="json",
        )
        self.assertEqual(reuse_resp.status_code, status.HTTP_400_BAD_REQUEST)


class WorkspaceTests(APITestCase):
    """Multi-tenant Workspace provisioning and data isolation."""

    def setUp(self):
        self.admin = User.objects.create_superuser(
            username="root", email="root@example.com", password="Password123!"
        )
        self.regular = User.objects.create_user(
            username="regular", password="Password123!"
        )

    def test_admin_creates_workspace_and_gets_api_key(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(reverse("workspace-list"), {"name": "Acme"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("api_key", resp.data)

        workspace = Workspace.objects.get(pk=resp.data["id"])
        # Only the hash is stored; the raw key is shown once and is verifiable.
        self.assertNotEqual(workspace.api_key_hash, resp.data["api_key"])
        self.assertTrue(workspace.verify_api_key(resp.data["api_key"]))
        self.assertFalse(workspace.verify_api_key("wrong-key"))

    def test_non_admin_cannot_create_workspace(self):
        self.client.force_authenticate(user=self.regular)
        resp = self.client.post(reverse("workspace-list"), {"name": "Hacked"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Workspace.objects.filter(name="Hacked").exists())

    def test_regenerate_key_invalidates_old_key(self):
        self.client.force_authenticate(user=self.admin)
        create_resp = self.client.post(
            reverse("workspace-list"), {"name": "Beta"}, format="json"
        )
        ws_id = create_resp.data["id"]
        old_key = create_resp.data["api_key"]

        regen_resp = self.client.post(
            reverse("workspace-regenerate-key", args=[ws_id]), format="json"
        )
        self.assertEqual(regen_resp.status_code, status.HTTP_200_OK)
        new_key = regen_resp.data["api_key"]
        self.assertNotEqual(old_key, new_key)

        workspace = Workspace.objects.get(pk=ws_id)
        self.assertFalse(workspace.verify_api_key(old_key))
        self.assertTrue(workspace.verify_api_key(new_key))

    def test_user_list_is_isolated_by_workspace(self):
        ws_a = Workspace.objects.create(name="Tenant-A")
        ws_b = Workspace.objects.create(name="Tenant-B")
        alice = User.objects.create_user(
            username="alice", password="Password123!", workspace=ws_a
        )
        bob = User.objects.create_user(
            username="bob", password="Password123!", workspace=ws_b
        )
        # A non-tenant user (legacy/single-tenant) is also present.
        legacy = User.objects.create_user(username="legacy", password="Password123!")

        # Alice (Tenant-A) only sees Tenant-A users.
        self.client.force_authenticate(user=alice)
        resp = self.client.get(reverse("user-list"))
        ids = [u["id"] for u in resp.data["results"]]
        self.assertIn(str(alice.id), ids)
        self.assertNotIn(str(bob.id), ids)
        self.assertNotIn(str(legacy.id), ids)

        # Bob (Tenant-B) only sees Tenant-B users.
        self.client.force_authenticate(user=bob)
        resp = self.client.get(reverse("user-list"))
        ids = [u["id"] for u in resp.data["results"]]
        self.assertIn(str(bob.id), ids)
        self.assertNotIn(str(alice.id), ids)

    def test_workspace_usage_endpoint(self):
        """Usage endpoint reports rolling totals and quota status."""
        self.client.force_authenticate(user=self.admin)
        create = self.client.post(reverse("workspace-list"), {"name": "MeterB"}, format="json")
        self.assertEqual(create.status_code, status.HTTP_201_CREATED)
        workspace = Workspace.objects.get(pk=create.data["id"])
        workspace.message_quota = 100
        workspace.save()
        WorkspaceDailyUsage.objects.create(
            workspace=workspace, date=timezone.localdate(), message_count=5
        )

        resp = self.client.get(reverse("workspace-usage", args=[workspace.id]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["total_messages_7d"], 5)
        self.assertEqual(resp.data["quota"], 100)
        self.assertFalse(resp.data["exceeded"])

        # Over the quota -> exceeded is True.
        WorkspaceDailyUsage.objects.update_or_create(
            workspace=workspace,
            date=timezone.localdate(),
            defaults={"message_count": 150},
        )
        resp2 = self.client.get(reverse("workspace-usage", args=[workspace.id]))
        self.assertEqual(resp2.data["total_messages_7d"], 150)
        self.assertTrue(resp2.data["exceeded"])


class WorkspaceWebhookTests(APITestCase):
    """Plug-and-play webhook subscriptions (API-key authenticated)."""

    def setUp(self):
        import secrets as secrets_lib
        from .models import WorkspaceWebhook

        self.Webhook = WorkspaceWebhook
        self.workspace = Workspace.objects.create(name='Hooked Inc')
        self.raw_key = secrets_lib.token_urlsafe(32)
        self.workspace.issue_api_key(self.raw_key)
        self.auth_headers = {
            'HTTP_X_WORKSPACE_ID': str(self.workspace.id),
            'HTTP_X_WORKSPACE_KEY': self.raw_key,
        }
        self.list_url = reverse('webhook-list')

    def test_create_webhook_returns_secret_once(self):
        resp = self.client.post(self.list_url, {
            'url': 'https://hooks.acme.com/dms',
            'events': ['message_created'],
        }, format='json', **self.auth_headers)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        secret = resp.data.get('secret')
        self.assertTrue(secret)
        # Never returned again.
        detail = self.client.get(
            reverse('webhook-detail', args=[resp.data['id']]),
            **self.auth_headers,
        )
        self.assertNotIn('secret', detail.data)

    def test_requires_workspace_api_key(self):
        resp = self.client.post(self.list_url, {'url': 'https://x.com/h'})
        self.assertIn(resp.status_code, {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN})

    def test_invalid_event_rejected(self):
        resp = self.client.post(self.list_url, {
            'url': 'https://x.com/h',
            'events': ['not_a_real_event'],
        }, format='json', **self.auth_headers)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_test_fire_queues_delivery(self):
        create = self.client.post(self.list_url, {
            'url': 'https://hooks.acme.com/dms', 'events': ['*'],
        }, format='json', **self.auth_headers)
        url = reverse('webhook-test-fire', args=[create.data['id']])
        resp = self.client.post(url, **self.auth_headers)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_emit_filters_by_subscribed_events_and_signs_payload(self):
        """emit_workspace_event signs with HMAC-SHA256 and honors event filters."""
        from unittest.mock import patch, MagicMock
        from .webhooks import emit_workspace_event, sign_payload

        hook = self.Webhook.objects.create(
            workspace=self.workspace,
            url='https://hooks.acme.com/dms',
            secret='whsec_test_123',
            events=['message_created'],  # does NOT include webhook.test
        )
        with patch('accounts.webhooks.requests.post') as mock_post:
            mock_post.return_value = MagicMock(status_code=200)

            # Subscribed event: delivered and correctly signed.
            emit_workspace_event(self.workspace, 'message_created', {'hello': 1})
            # Unsubscribed event: not delivered.
            emit_workspace_event(self.workspace, 'webhook.test', {'nope': 1})

            self.assertEqual(mock_post.call_count, 1)
            kwargs = mock_post.call_args.kwargs
            ts = kwargs['headers']['X-DMS-Timestamp']
            sig = kwargs['headers']['X-DMS-Signature']
            expected = 'sha256=' + sign_payload('whsec_test_123', ts, kwargs['data'])
            self.assertEqual(sig, expected)


class BootstrapWorkspaceCommandTests(APITestCase):
    """`manage.py bootstrap_workspace` — one-tenant bootstrap from the CLI."""

    def test_creates_workspace_with_hashed_key_and_quota(self):
        from io import StringIO
        from django.core.management import call_command

        out = StringIO()
        call_command('bootstrap_workspace', name='CLI Tenant',
                     daily_quota=500, stdout=out)
        ws = Workspace.objects.get(name='CLI Tenant')
        self.assertEqual(ws.message_quota, 500)
        self.assertTrue(ws.api_key_hash)
        self.assertIn(str(ws.id), out.getvalue())

    def test_duplicate_name_fails_cleanly(self):
        from io import StringIO
        from django.core.management import call_command
        from django.core.management.base import CommandError

        Workspace.objects.create(name='Dup Co')
        with self.assertRaises(SystemExit):
            call_command('bootstrap_workspace', name='Dup Co', stdout=StringIO())


class WorkspaceOriginMiddlewareTests(APITestCase):
    """Per-workspace CORS for embedded integrations."""

    EMBED_ORIGIN = 'https://embeds.acme.com'

    def setUp(self):
        self.workspace = Workspace.objects.create(name='Embed Co')

    def _get(self):
        return self.client.get('/api/health/', HTTP_ORIGIN=self.EMBED_ORIGIN)

    def test_allowed_origin_gets_cors_headers(self):
        self.workspace.allowed_origins = [self.EMBED_ORIGIN]
        self.workspace.save()
        resp = self._get()
        self.assertEqual(resp.headers.get('Access-Control-Allow-Origin'), self.EMBED_ORIGIN)

    def test_unknown_origin_gets_no_cors_headers(self):
        resp = self._get()
        self.assertIsNone(resp.headers.get('Access-Control-Allow-Origin'))
