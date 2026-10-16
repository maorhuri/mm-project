import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages are TypeScript source; Next compiles them.
  transpilePackages: ['@mm/core', '@mm/db'],
  // Native / server-only modules must not be bundled.
  serverExternalPackages: ['@prisma/client', '@node-rs/argon2', 'sharp', 'pino', 'bullmq', 'ioredis', 'undici', 'cheerio'],
  // Standalone output is used by docker/web.Dockerfile; `next start` works too.
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../../'),
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
