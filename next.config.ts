import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // Browser-test builds skip types; `npm run check` covers them.
  typescript: { ignoreBuildErrors: process.env.E2E_BUILD === '1' },
  reactStrictMode: true,
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  serverExternalPackages: ['sharp', 'libheif-js', 'pg', 'pg-boss', 'archiver', 'opentype.js'],
}

export default nextConfig
