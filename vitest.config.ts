import { defineConfig } from 'vitest/config'
import path from 'node:path'

const env = {
  NODE_ENV: 'test' as const,
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://localhost/event_photos_test',
  APP_URL: 'http://localhost:3000',
  APP_SECRET: 'test-secret-test-secret-test-secret-00',
  STORAGE_DRIVER: 'disk',
  STORAGE_DIR: '.data/test-storage',
  REPORT_EMAIL: 'report@example.test',
}
const alias = { '@': path.resolve(import.meta.dirname, 'src') }

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      { resolve: { alias }, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], env, testTimeout: 30_000 } },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          env,
          globalSetup: ['tests/helpers/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
