from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User

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
