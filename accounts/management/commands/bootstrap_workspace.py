"""Bootstrap a tenant workspace and print its API key exactly once.

Usage::

    python manage.py bootstrap_workspace --name "Acme Support"
    python manage.py bootstrap_workspace --name "Acme" --daily-quota 1000 \\
        --origin https://app.acme.com --origin https://staging.acme.com
"""

from django.core.management.base import BaseCommand

from accounts.models import Workspace


class Command(BaseCommand):
    help = 'Create a tenant Workspace and print its API key (shown only once).'

    def add_arguments(self, parser):
        parser.add_argument('--name', required=True, help='Unique workspace name.')
        parser.add_argument('--daily-quota', type=int, default=None,
                            help='Optional daily message entitlement.')
        parser.add_argument('--origin', action='append', default=[],
                            help='Allowed embed origin (repeatable).')

    def handle(self, *args, **options):
        name = options['name']
        if Workspace.objects.filter(name=name).exists():
            self.stderr.write(self.style.ERROR(
                f'Workspace "{name}" already exists. '
                f'Retrieve its id via the admin or use regenerate-key.'
            ))
            raise SystemExit(1)

        from accounts.authentication import generate_api_key

        workspace = Workspace.objects.create(
            name=name,
            message_quota=options['daily_quota'],
            allowed_origins=list(options['origin']),
        )
        raw_key = generate_api_key()
        workspace.issue_api_key(raw_key)

        self.stdout.write(self.style.SUCCESS(f'\nWorkspace created: {workspace.name}'))
        self.stdout.write(f'  Workspace ID : {workspace.id}')
        self.stdout.write(self.style.WARNING(f'  API key      : {raw_key}'))
        self.stdout.write('                 (stored hashed — this is the ONLY time it is shown)\n')
        if workspace.allowed_origins:
            self.stdout.write(f'  Allowed origins: {", ".join(workspace.allowed_origins)}')
        self.stdout.write('\nUse server-to-server:')
        self.stdout.write(
            f'  curl -X POST http://localhost:8000/api/provision/users/ \\\n'
            f'    -H "X-Workspace-ID: {workspace.id}" -H "X-Workspace-Key: {raw_key}" \\\n'
            f'    -H "Content-Type: application/json" \\\n'
            f'    -d \'{{"username": "acme_user1", "email": "u1@acme.com", "password": "..."}}\'\n'
        )
