from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from django.urls import reverse

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
