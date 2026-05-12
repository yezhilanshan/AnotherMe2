# Nginx HTTPS entrypoint

This compose service is intended for self-hosted servers. Put certificate files under `deploy/nginx/certs` by default:

- `fullchain.pem`
- `privkey.pem`

Start with:

```bash
docker compose -f docker-compose.unified.yml --profile https up -d
```

Recommended public environment values for a server:

```bash
NGINX_SERVER_NAME=example.com
ANOTHERME2_GATEWAY_WS_BASE_URL=wss://example.com
OBJECT_STORAGE_PUBLIC_BASE_URL=https://example.com/artifacts
```

The HTTPS entrypoint routes:

- `/` and normal `/api/*` requests to `anotherme-core`
- `/ws/*` and `/api/live-book/ws` WebSocket traffic to `api-gateway`
- `/artifacts/*` public artifact downloads to the MinIO bucket
