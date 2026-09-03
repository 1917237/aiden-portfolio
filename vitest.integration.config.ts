/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'

const env = loadEnv('test', process.cwd(), '')

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    env,
    testTimeout: 30_000,
  },
})
