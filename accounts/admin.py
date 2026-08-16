from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, Workspace


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ['id', 'name', 'created_at', 'has_api_key']
    search_fields = ['name']
    readonly_fields = ['id', 'created_at', 'api_key_hash']

    def has_api_key(self, obj):
        return bool(obj.api_key_hash)
    has_api_key.short_description = 'Has API Key'


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ['id', 'username', 'email', 'is_active', 'date_joined']
    list_filter = ['is_active', 'date_joined']
    search_fields = ['username', 'email']
    ordering = ['-date_joined']
    readonly_fields = ['id', 'date_joined']
    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('Personal info', {'fields': ('first_name', 'last_name', 'email')}),
        ('Encryption', {'fields': ('public_key',)}),
        ('Permissions', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )
