# messaging/serializers.py - UPDATED with E2EE fields

from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Group, GroupMember, Message, MessageReadReceipt, MessageReaction

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """Serializer for User model"""
    has_encryption = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'has_encryption']
        read_only_fields = ['id']
    
    def get_has_encryption(self, obj):
        """Check if user has uploaded public key"""
        return bool(obj.public_key)


class ReactionSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    
    class Meta:
        model = MessageReaction
        fields = ['id', 'user', 'emoji', 'created_at']


class SimpleMessageSerializer(serializers.ModelSerializer):
    """Simplified serializer for parent messages to avoid recursion"""
    sender = UserSerializer(read_only=True)
    
    class Meta:
        model = Message
        fields = ['id', 'content', 'sender', 'created_at', 'message_type', 'is_encrypted']




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
    
    # Read status fields
    is_read = serializers.SerializerMethodField()
    read_by = serializers.SerializerMethodField()
    read_by_current_user = serializers.SerializerMethodField()
    
    # ✅ NEW: Encryption fields
    is_encrypted = serializers.BooleanField(default=False)
    encrypted_content = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    encrypted_key = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    encrypted_key_self = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    encrypted_keys = serializers.JSONField(required=False, allow_null=True)
    iv = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    # ✅ NEW: Reply and Reaction fields
    parent_message_id = serializers.PrimaryKeyRelatedField(
        source='parent_message',
        queryset=Message.objects.all(),
        write_only=True,
        required=False,
        allow_null=True
    )
    parent_message = SimpleMessageSerializer(read_only=True)
    reactions = ReactionSerializer(many=True, read_only=True)



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
            'is_read',
            'read_by',
            'read_by_current_user',
            # ✅ Encryption fields
            'is_encrypted',
            'encrypted_content',
            'encrypted_key',
            'encrypted_key_self',
            'encrypted_keys',
            'iv',
            # ✅ New fields
            'parent_message',
            'parent_message_id',
            'reactions'

        ]
        read_only_fields = ['id', 'sender', 'recipient', 'created_at']

    def get_group_name(self, obj):
        return obj.group.name if obj.group else None
    
    def get_is_read(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
            
        if obj.message_type == "private" and obj.recipient == request.user:
            return MessageReadReceipt.objects.filter(
                message=obj,
                user=request.user
            ).exists()
        
        elif obj.message_type == "group":
            return MessageReadReceipt.objects.filter(
                message=obj,
                user=request.user
            ).exists()
        
        return False
    
    def get_read_by(self, obj):
        request = self.context.get('request')
        
        if obj.message_type == "private":
            if request and request.user == obj.sender:
                receipts = MessageReadReceipt.objects.filter(message=obj)
                return [{
                    'user_id': str(receipt.user.id),
                    'username': receipt.user.username,
                    'read_at': receipt.read_at.isoformat()
                } for receipt in receipts.select_related('user')]
            return []
        
        elif obj.message_type == "group":
            receipts = MessageReadReceipt.objects.filter(message=obj)
            return [{
                'user_id': str(receipt.user.id),
                'username': receipt.user.username,
                'read_at': receipt.read_at.isoformat()
            } for receipt in receipts.select_related('user')]
        
        return []
    
    def get_read_by_current_user(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
            
        return MessageReadReceipt.objects.filter(
            message=obj,
            user=request.user
        ).exists()

    def validate(self, attrs):
        message_type = attrs.get('message_type')
        recipient = attrs.get('recipient')
        group = attrs.get('group')
        request = self.context.get('request')
        is_encrypted = attrs.get('is_encrypted', False)

        # ✅ NEW: Make content optional for encrypted messages
        if is_encrypted:
            # For encrypted messages, content can be empty
            if not attrs.get('content'):
                attrs['content'] = ''  # Set empty string if not provided
        else:
            # For plain messages, content is required
            if not attrs.get('content'):
                raise serializers.ValidationError({
                    'content': 'This field is required for non-encrypted messages.'
                })
            
        # ✅ Validate encryption fields
        if is_encrypted:
            if message_type == 'group':
                if not attrs.get('encrypted_content'):
                    raise serializers.ValidationError({
                        'encrypted_content': 'Encrypted group messages must have encrypted_content.'
                    })
                if not attrs.get('encrypted_keys'):
                    raise serializers.ValidationError({
                        'encrypted_keys': 'Encrypted group messages must have encrypted_keys.'
                    })
                if not attrs.get('iv'):
                    raise serializers.ValidationError({
                        'iv': 'Encrypted messages must have an IV.'
                    })
            
            elif message_type == 'private':
                if not attrs.get('encrypted_content'):
                    raise serializers.ValidationError({
                        'encrypted_content': 'Encrypted private messages must have encrypted_content.'
                    })
                if not attrs.get('encrypted_key'):
                    raise serializers.ValidationError({
                        'encrypted_key': 'Encrypted private messages must have encrypted_key.'
                    })
                if not attrs.get('encrypted_key_self'):
                    raise serializers.ValidationError({
                        'encrypted_key_self': 'Encrypted private messages must have encrypted_key_self.'
                    })
                if not attrs.get('iv'):
                    raise serializers.ValidationError({
                        'iv': 'Encrypted messages must have an IV.'
                    })

        # Existing validation
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
        return super().create(validated_data)


class GroupMemberSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    user_id = serializers.UUIDField(write_only=True, required=False)
    group_name = serializers.CharField(source='group.name', read_only=True)

    class Meta:
        model = GroupMember
        fields = ['id', 'user', 'user_id', 'group', 'group_name', 'joined_at', 'is_admin']
        read_only_fields = ['id', 'joined_at', 'group']


class GroupSerializer(serializers.ModelSerializer):
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
        return obj.members.count()

    def get_is_member(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return GroupMember.objects.filter(
                user=request.user, 
                group=obj
            ).exists()
        return False

    def get_is_admin(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            membership = GroupMember.objects.filter(
                user=request.user, 
                group=obj
            ).first()
            return membership.is_admin if membership else False
        return False

    def create(self, validated_data):
        request = self.context.get('request')
        group = super().create(validated_data)
        
        GroupMember.objects.create(
            user=request.user,
            group=group,
            is_admin=True
        )
        
        return group

    def validate_name(self, value):
        """Check if group with this name already exists"""
        if Group.objects.filter(name__iexact=value).exists():
            raise serializers.ValidationError(f"Group with name '{value}' already exists")
        return value