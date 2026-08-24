import logging
from django.db import connection
from django.core.cache import cache
from drf_spectacular.utils import extend_schema
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

logger = logging.getLogger(__name__)

class HealthCheckView(APIView):
    """
    Production health check endpoint for monitoring system health (DB, Cache, Services).
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        summary='Platform health check',
        description='Probes database and Redis cache; returns 503 when unhealthy.',
        responses={200: {'type': 'object', 'properties': {
            'status': {'type': 'string'},
            'services': {'type': 'object', 'properties': {
                'database': {'type': 'string'}, 'redis_cache': {'type': 'string'}}}}},
            503: {'type': 'object'}},
        tags=['Health']
    )
    def get(self, request, *args, **kwargs):
        health_status = {
            "status": "healthy",
            "services": {
                "database": "unknown",
                "redis_cache": "unknown"
            }
        }
        is_healthy = True

        # Check Database Connection
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                row = cursor.fetchone()
                if row and row[0] == 1:
                    health_status["services"]["database"] = "healthy"
                else:
                    health_status["services"]["database"] = "unhealthy"
                    is_healthy = False
        except Exception as e:
            logger.error(f"HealthCheck database error: {e}")
            health_status["services"]["database"] = f"unhealthy: {str(e)}"
            is_healthy = False

        # Check Redis Cache
        try:
            cache.set("health_check_ping", "pong", timeout=10)
            val = cache.get("health_check_ping")
            if val == "pong":
                health_status["services"]["redis_cache"] = "healthy"
            else:
                health_status["services"]["redis_cache"] = "unhealthy"
                is_healthy = False
        except Exception as e:
            logger.error(f"HealthCheck Redis error: {e}")
            health_status["services"]["redis_cache"] = f"unhealthy: {str(e)}"
            is_healthy = False

        if not is_healthy:
            health_status["status"] = "unhealthy"
            return Response(health_status, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        return Response(health_status, status=status.HTTP_200_OK)
