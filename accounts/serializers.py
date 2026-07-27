from rest_framework import serializers
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError

User = get_user_model()

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        # expose only safe fields
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "is_active",
            "date_joined",
        ]
        read_only_fields = ["id", "date_joined", "is_active"]

class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "password"]

    def create(self, validated_data):
        user = User(
            username=validated_data["username"],
            email=validated_data.get("email"),
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
        )
        user.set_password(validated_data["password"])
        user.save()
        return user





class TokenRefreshCustomSerializer(serializers.Serializer):
    refresh = serializers.CharField()

    def validate(self, attrs):
        refresh_token = attrs.get("refresh")

        try:
            # Verify & get new access token
            refresh = RefreshToken(refresh_token)
            data = {
                "access": str(refresh.access_token)
            }
            return data
        except TokenError:
            raise serializers.ValidationError("Invalid or expired refresh token.")

class LoginSerializer(serializers.Serializer):
    identifier = serializers.CharField(required=True)
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        identifier = attrs.get("identifier")
        password = attrs.get("password")

        if not identifier:
            raise serializers.ValidationError("Identifier is required.")

        user = None

        
        try:
            user = User.objects.get(username=identifier)
        except User.DoesNotExist:
            pass

        # 2. Try email
        if user is None:
            try:
                user = User.objects.get(email=identifier)
            except User.DoesNotExist:
                pass

        

        # If still no match → invalid identifier
        if user is None:
            raise serializers.ValidationError("User not found.")

        # Check password
        if not user.check_password(password):
            raise serializers.ValidationError("Invalid password.")

        # Attach user to validated data
        attrs["user"] = user
        return attrs
