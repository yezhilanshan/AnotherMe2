"""Run API gateway server."""

import os

import uvicorn

# Default to polling mode for local dev (no Redis required)
os.environ.setdefault("GATEWAY_QUEUE_BACKEND", "polling")

from api_gateway.config import get_settings

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "api_gateway.app:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=False,
    )
