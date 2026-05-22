import { ProxyAgent, setGlobalDispatcher } from 'undici';

let configuredProxyUrl: string | null = null;

function getProxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    undefined
  );
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;

  const proxyUrl = getProxyUrl();
  if (!proxyUrl || configuredProxyUrl === proxyUrl) return;

  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  configuredProxyUrl = proxyUrl;
}
