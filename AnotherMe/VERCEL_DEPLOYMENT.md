# Vercel Deployment

This project is deployed as a hybrid setup:

- Vercel runs the Next.js web/PWA app.
- Alibaba Cloud runs the AnotherMe2 gateway and worker.

## Vercel Project Settings

Use these settings when importing the Git repository into Vercel:

- Framework Preset: `Next.js`
- Root Directory: `AnotherMe`
- Install Command: `pnpm install`
- Build Command: `pnpm build`
- Output Directory: leave empty/default

The repository already includes `vercel.json` with the Next.js framework setting and API function duration configuration.

`maxDuration` is set to `300` seconds. This requires a Vercel plan that supports longer function durations. If the first deployment is on Hobby and Vercel rejects the limit, lower it to `60`.

## Environment Variables

Add the keys from `vercel.env.example` in:

`Project Settings -> Environment Variables`

Set them at least for `Production`. Use separate values for `Preview` if preview deployments should call a staging gateway.

Required for the Alibaba Cloud gateway connection:

```env
ANOTHERME2_GATEWAY_BASE_URL=https://api.example.com
ANOTHERME2_GATEWAY_WS_BASE_URL=wss://api.example.com
ANOTHERME2_GATEWAY_TOKEN=<same value as GATEWAY_API_TOKEN on Alibaba Cloud>
NEXT_PUBLIC_VIDEO_GENERATION_MODE=gateway-job
AUTH_COOKIE_SECURE=true
```

Configure at least one model provider:

```env
OPENAI_API_KEY=<secret>
DEFAULT_MODEL=openai:gpt-4o-mini
```

Do not enable `ALLOW_LOCAL_NETWORKS` on Vercel production deployments.

## Domains

Recommended domain split:

- `app.example.com` -> Vercel project
- `api.example.com` -> Alibaba Cloud gateway behind Nginx + HTTPS

After adding `app.example.com` in Vercel, follow the DNS instructions shown by Vercel. Vercel provisions HTTPS for the web app after DNS is valid.

## Post-Deploy Checks

After the production deployment finishes, verify:

```bash
curl -I https://app.example.com
curl -I https://app.example.com/manifest.json
curl -I https://app.example.com/sw.js
curl -I https://app.example.com/offline
curl https://api.example.com/healthz
```

Then test a browser flow that calls the gateway, such as the problem-video path if `NEXT_PUBLIC_VIDEO_GENERATION_MODE=gateway-job` is enabled.

## Current Limitation

The current auth implementation stores users and sessions in a local SQLite file under `data/auth.sqlite`. Vercel's runtime filesystem is not suitable for durable user account storage. This is acceptable for a short internal smoke test, but production auth should be moved to a durable external database or the Alibaba Cloud gateway.
