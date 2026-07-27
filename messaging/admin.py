from django.contrib import admin
from .models import Group, GroupMember, Message, MessageReadReceipt, MessageReaction, UserProfile

@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    list_display = ['id', 'name', 'created_by', 'created_at', 'member_count']
    list_filter = ['created_at']
    search_fields = ['name', 'created_by__username']
    readonly_fields = ['id', 'created_at']
    
    def member_count(self, obj):
        return obj.members.count()
    member_count.short_description = 'Members'

@admin.register(GroupMember)
class GroupMemberAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'group', 'is_admin', 'joined_at']
    list_filter = ['is_admin', 'joined_at']
    search_fields = ['user__username', 'group__name']

@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ['id', 'message_type', 'sender', 'created_at', 'content_preview']
    list_filter = ['message_type', 'created_at', 'is_encrypted']
    search_fields = ['sender__username', 'content']
    readonly_fields = ['id', 'created_at']
    
    def content_preview(self, obj):
        return obj.content[:50] if obj.content else '(encrypted)'
    content_preview.short_description = 'Content'

@admin.register(MessageReadReceipt)
class MessageReadReceiptAdmin(admin.ModelAdmin):
    list_display = ['id', 'message', 'user', 'read_at']
    list_filter = ['read_at']

@admin.register(MessageReaction)
class MessageReactionAdmin(admin.ModelAdmin):
    list_display = ['id', 'message', 'user', 'emoji', 'created_at']
    list_filter = ['emoji']

@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'has_key']
    
    def has_key(self, obj):
        return bool(obj.public_key)
    has_key.short_description = 'Has Public Key'
    has_key.boolean = True
