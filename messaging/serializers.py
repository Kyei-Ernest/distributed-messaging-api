from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Group, GroupMember, Message, MessageReadReceipt

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """Serializer for User model"""
    
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name']
        read_only_fields = ['id']


class GroupMemberSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    user_id = serializers.UUIDField(write_only=True, required=False)
    group_name = serializers.CharField(source='group.name', read_only=True)

    class Meta:
        model = GroupMember
        fields = ['id', 'user', 'user_id', 'group', 'group_name', 'joined_at', 'is_admin']
        read_only_fields = ['id', 'joined_at', 'group']  # <-- make 'group' read-only for GET


class GroupSerializer(serializers.ModelSerializer):
    """Serializer for Group"""
    created_by = UserSerializer(read_only=True)
    member_count = serializers.SerializerMethodField()
    is_member = serializers.SerializerMethodField()
    is_admin = serializers.SerializerMethodField()

    class Meta:
        model = Group
        fields = [
            'id', 'name', 'description', 'created_by', 
            'member_count', 'is_member', 'is_admin', 'created_at'
        ]
        read_only_fields = ['id', 'created_by', 'created_at']

    def get_member_count(self, obj):
        """Get total number of members"""
        return obj.members.count()

    def get_is_member(self, obj):
        """Check if current user is a member"""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return GroupMember.objects.filter(
                user=request.user, 
                group=obj
            ).exists()
        return False

    def get_is_admin(self, obj):
        """Check if current user is an admin"""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            membership = GroupMember.objects.filter(
                user=request.user, 
                group=obj
            ).first()
            return membership.is_admin if membership else False
        return False

    def create(self, validated_data):
        """Create group and add creator as admin member"""
        request = self.context.get('request')
        
        # Create the group (created_by is set in view's perform_create)
        group = super().create(validated_data)
        
        # Automatically add creator as admin member
        GroupMember.objects.create(
            user=request.user,
            group=group,
            is_admin=True  # Creator is admin
        )
        
        return group


class MessageSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    recipient = UserSerializer(read_only=True)

    group = serializers.PrimaryKeyRelatedField(
        queryset=Group.objects.all(),
        pk_field=serializers.UUIDField(),
        required=False,
        allow_null=True
    )

    recipient_id = serializers.PrimaryKeyRelatedField(
        source='recipient',
        queryset=User.objects.all(),
        pk_field=serializers.UUIDField(),
        write_only=True,
        required=False,
        allow_null=True
    )

    group_name = serializers.SerializerMethodField()
    
    # NEW: Read status fields
    is_read = serializers.SerializerMethodField()
    read_by = serializers.SerializerMethodField()
    read_by_current_user = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            'id',
            'message_type',
            'group',
            'group_name',
            'sender',
            'recipient',
            'recipient_id',
            'content',
            'created_at',
            'is_read',              # NEW
            'read_by',              # NEW
            'read_by_current_user'  # NEW
        ]
        read_only_fields = ['id', 'sender', 'recipient', 'created_at']

    def get_group_name(self, obj):
        return obj.group.name if obj.group else None
    
    def get_is_read(self, obj):
        """Check if this message has been read by the current user"""
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
            
        # For private messages: current user is recipient
        if obj.message_type == "private" and obj.recipient == request.user:
            return MessageReadReceipt.objects.filter(
                message=obj,
                user=request.user
            ).exists()
        
        # For group messages: check if current user has read it
        elif obj.message_type == "group":
            return MessageReadReceipt.objects.filter(
                message=obj,
                user=request.user
            ).exists()
        
        # For sent messages: not applicable (sender can't "read" their own message)
        return False
    
    def get_read_by(self, obj):
        """Get list of users who have read this message"""
        request = self.context.get('request')
        
        # For private messages: show if recipient has read it
        if obj.message_type == "private":
            if request and request.user == obj.sender:
                receipts = MessageReadReceipt.objects.filter(message=obj)
                return [{
                    'user_id': str(receipt.user.id),
                    'username': receipt.user.username,
                    'read_at': receipt.read_at.isoformat()
                } for receipt in receipts.select_related('user')]
            return []
        
        # For group messages: show all readers (except sender)
        elif obj.message_type == "group":
            receipts = MessageReadReceipt.objects.filter(message=obj)
            return [{
                'user_id': str(receipt.user.id),
                'username': receipt.user.username,
                'read_at': receipt.read_at.isoformat()
            } for receipt in receipts.select_related('user')]
        
        return []
    
    def get_read_by_current_user(self, obj):
        """Helper method for frontend to easily check if current user read this"""
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
            
        return MessageReadReceipt.objects.filter(
            message=obj,
            user=request.user
        ).exists()

    def validate(self, attrs):
        message_type = attrs.get('message_type')
        recipient = attrs.get('recipient')  # IMPORTANT: comes from recipient_id
        group = attrs.get('group')
        request = self.context.get('request')

        # DEBUG LOGS
        print("=== DEBUG MessageSerializer.validate ===")
        print(f"Message type: {message_type}")
        print(f"Request user ID: {request.user.id if request else 'No request'}")
        print(f"Request user username: {request.user.username if request else 'No request'}")
        print(f"Recipient from attrs: {recipient}")
        print(f"Recipient ID: {recipient.id if recipient else 'No recipient'}")
        print(f"Recipient username: {recipient.username if recipient else 'No recipient'}")

        # Validate group messages
        if message_type == 'group':
            if not group:
                raise serializers.ValidationError({
                    'group': 'Group message must have a group.'
                })

            if request and not GroupMember.objects.filter(
                user=request.user,
                group=group
            ).exists():
                raise serializers.ValidationError({
                    'group': 'You must be a member of this group to send messages.'
                })

            if recipient:
                raise serializers.ValidationError({
                    'recipient_id': 'Group messages cannot have a recipient.'
                })

        # Validate private messages
        if message_type == 'private':
            if not recipient:
                raise serializers.ValidationError({
                    'recipient_id': 'Private messages must have a recipient.'
                })

            if request and recipient.id == request.user.id:
                raise serializers.ValidationError({
                    'recipient_id': 'Cannot send private message to yourself.'
                })

            if group:
                raise serializers.ValidationError({
                    'group': 'Private messages cannot belong to a group.'
                })

        return attrs

    def create(self, validated_data):
        """
        recipient is already resolved by DRF because of
        source='recipient' on recipient_id
        """
        return super().create(validated_data)

class MessageListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for message lists"""
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    recipient_username = serializers.CharField(source='recipient.username', read_only=True)
    group_name = serializers.CharField(source='group.name', read_only=True)

    class Meta:
        model = Message
        fields = [
            'id', 'message_type', 'group', 'group_name',
            'sender_username', 'recipient_username',
            'content', 'created_at'
        ]
        read_only_fields = fields