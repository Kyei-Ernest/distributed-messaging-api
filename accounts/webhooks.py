"""Outbound webhook delivery for workspace integrations.

Plug-and-play contract for embedding applications: subscribe a URL, receive
signed JSON events. Deliveries are:

- **Signed** — ``X-DMS-Signature: sha256=<hex>`` HMAC of
  ``<timestamp>.<raw_body>`` with the subscription secret, plus the matching
  ``X-DMS-Timestamp`` header so receivers can reject replays.
- **Best-effort** — failures are logged, never raised. Webhooks must not be
  able to break messaging (same invariant as usage metering).
- **Asynchronous** — sent from daemon threads with a short timeout so the
  request path never waits on a receiver.

Verify in your receiver (pseudo-code)::

    expected = hmac_sha256(secret, f"{timestamp}.{raw_body}")
    assert hmac.compare_digest(expected, signature_header)
    assert abs(now - int(timestamp)) < 300
"""

import hashlib
import hmac
import json
import logging
import threading
import time

import requests

logger = logging.getLogger(__name__)

WEBHOOK_TIMEOUT_SECONDS = 5
WEBHOOK_MAX_ATTEMPTS = 3
WEBHOOK_RETRY_BACKOFF = (0.5, 2.0)  # seconds before 2nd/3rd attempt


def sign_payload(secret: str, timestamp: str, raw_body: bytes) -> str:
    """HMAC-SHA256 over '<timestamp>.<body>' — mirrors Stripe-style signing."""
    mac = hmac.new(
        secret.encode('utf-8'),
        f"{timestamp}.".encode('utf-8') + raw_body,
        hashlib.sha256,
    )
    return mac.hexdigest()


def _attempt(url, headers, raw_body):
    """Single POST; returns True on success (<400), False otherwise."""
    try:
        response = requests.post(url, data=raw_body, headers=headers,
                                 timeout=WEBHOOK_TIMEOUT_SECONDS)
        if response.status_code >= 400:
            logger.warning("Webhook to %s failed: HTTP %s", url, response.status_code)
        return response.status_code < 400
    except Exception as e:  # noqa: BLE001 - delivery must never raise
        logger.warning("Webhook to %s error: %s", url, e)
        return False


def _deliver_with_retries(webhook_id, url, secret, event_type, payload) -> None:
    """Blocking delivery with bounded exponential backoff; worker-thread only."""
    timestamp = str(int(time.time()))
    raw_body = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    base_headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'DMS-Webhooks/1.0',
        'X-DMS-Event': event_type,
        'X-DMS-Timestamp': timestamp,
        # Signed over "<timestamp>.<body>"; a fresh body per attempt is not
        # needed since payload and timestamp are fixed for this delivery.
        'X-DMS-Signature': f"sha256={sign_payload(secret, timestamp, raw_body)}",
    }

    for attempt in range(WEBHOOK_MAX_ATTEMPTS):
        if _attempt(url, base_headers, raw_body):
            return
        if attempt < WEBHOOK_MAX_ATTEMPTS - 1:
            time.sleep(WEBHOOK_RETRY_BACKOFF[min(attempt, len(WEBHOOK_RETRY_BACKOFF) - 1)])
    logger.error("Webhook %s to %s permanently failed after %d attempts",
                 webhook_id, url, WEBHOOK_MAX_ATTEMPTS)


def emit_workspace_event(workspace, event_type: str, data: dict) -> None:
    """Fan an event out to all active subscriptions that want it.

    Safe to call from anywhere (signals, views); returns immediately.
    """
    webhooks = workspace.webhooks.filter(is_active=True)
    for webhook in webhooks:
        subscribed = webhook.events or ['*']
        if '*' in subscribed or event_type in subscribed:
            payload = {
                'id': f"{event_type}:{webhook.id}:{int(time.time() * 1000)}",
                'type': event_type,
                'created': int(time.time()),
                'data': data,
            }
            thread = threading.Thread(
                target=_deliver_with_retries,
                args=(str(webhook.id), webhook.url, webhook.secret,
                      event_type, payload),
                daemon=True,
                name=f"dms-webhook-{str(webhook.id)[:8]}",
            )
            thread.start()
