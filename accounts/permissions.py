from rest_framework import permissions


class IsOwnerOrReadOnly(permissions.BasePermission):
    '''
    Custom permission to only allow owners to edit their profile.
    '''
    def has_object_permission(self, request, view, obj):
        # Read permissions are allowed to any request
        if request.method in permissions.SAFE_METHODS:
            return True
        
        # Write permissions are only allowed to the owner
        return obj == request.user


class IsSelfOrAdmin(permissions.BasePermission):
    '''
    Permission to only allow users to access their own data
    or allow admins to access any user data.
    '''
    def has_object_permission(self, request, view, obj):
        # Admins can access any user
        if request.user.is_staff:
            return True
        
        # Users can only access their own data
        return obj == request.user