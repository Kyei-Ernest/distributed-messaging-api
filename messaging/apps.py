from django.apps import AppConfig


class MessagingConfig(AppConfig):
    name = 'messaging'

    def ready(self):
        # Register metering signal handlers.
        import messaging.signals  # noqa: E402,F401
