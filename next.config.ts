import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  reactStrictMode: true,
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  serverExternalPackages: ['sharp', 'libheif-js', 'pg', 'pg-boss', 'archiver', 'opentype.js'],
}

export default nextConfig
