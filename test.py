#!/usr/bin/env python3
import redis
import json
import uuid
import time
from datetime import datetime

def test_redis_publishing():
    # Connect to Redis
    r = redis.Redis(host='localhost', port=6379, db=1)
    
    print("✅ Connected to Redis")
    
    # Test data
    user1_id = str(uuid.uuid4())
    user2_id = str(uuid.uuid4())
    group_id = str(uuid.uuid4())
    
    test_cases = [
        {
            "name": "Group Message",
            "data": {
                "type": "group_message",
                "data": {
                    "message_id": str(uuid.uuid4()),
                    "sender_id": user1_id,
                    "sender_username": "python_user",
                    "content": "Test message from Python script",
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "message_type": "group",
                    "group_id": group_id,
                    "group_name": "Python Test Group"
                }
            }
        },
        {
            "name": "Private Message",
            "data": {
                "type": "private_message",
                "data": {
                    "message_id": str(uuid.uuid4()),
                    "sender_id": user1_id,
                    "sender_username": "python_user",
                    "recipient_id": user2_id,
                    "recipient_username": "recipient_user",
                    "content": "Private test from Python",
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "message_type": "private"
                }
            }
        },
        {
            "name": "User Joined",
            "data": {
                "type": "user_joined",
                "data": {
                    "user_id": user2_id,
                    "username": "new_member",
                    "group_id": group_id,
                    "group_name": "Python Test Group",
                    "is_admin": False
                }
            }
        }
    ]
    
    # Publish each test case
    for test in test_cases:
        print(f"\n📤 Publishing: {test['name']}")
        json_data = json.dumps(test['data'])
        print(f"Data: {json_data[:100]}...")
        
        result = r.publish('messaging_events', json_data)
        print(f"Published to {result} subscriber(s)")
        
        time.sleep(1)  # Wait between messages
    
    print("\n✅ All test messages published!")

if __name__ == "__main__":
    test_redis_publishing()