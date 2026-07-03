import type { NextConfig } from 'next';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import bundleAnalyzer from '@next/bundle-analyzer';

const GATEWAY = process.env.ANOTHERME2_GATEWAY_BASE_URL || 'http://127.0.0.1:8080';
const EXTRA_ALLOWED_DEV_ORIGINS = process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const LAN_ALLOWED_DEV_ORIGINS = [
  '10.*.*.*',
  '192.168.*.*',
  ...Array.from({ length: 16 }, (_, index) => `172.${16 + index}.*.*`),
];

const nextConfig: NextConfig = {
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '10.51.37.135',
    ...LAN_ALLOWED_DEV_ORIGINS,
    ...(EXTRA_ALLOWED_DEV_ORIGINS ?? []),
  ],
  output: process.env.VERCEL ? undefined : 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: [],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
    ],
  },
  experimental: {
    proxyClientMaxBodySize: '200mb',
    proxyTimeout: 300_000, // 5 min — spine LLM generation is slow
  },
  async rewrites() {
    return [
      {
        source: '/api/co-writer/:path*',
        destination: `${GATEWAY}/co-writer/:path*`,
      },
    ];
  },
};

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withBundleAnalyzer(nextConfig);
