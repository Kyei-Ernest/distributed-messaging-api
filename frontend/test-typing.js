// Quick test: Add this to your browser console to manually trigger a typing indicator

// Simulate receiving a typing indicator event
app.handleTypingIndicator({
    user_id: "10abac26-f4f5-40fb-951f-c4b9f2bac4e2",
    username: "enexto",
    is_typing: true
});

// After a few seconds, hide it
setTimeout(() => {
    app.handleTypingIndicator({
        user_id: "10abac26-f4f5-40fb-951f-c4b9f2bac4e2",
        username: "enexto",
        is_typing: false
    });
}, 3000);
