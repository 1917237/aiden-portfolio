/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss()],
    build: {
      sourcemap: false,
      reportCompressedSize: false,
      target: 'es2022',
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      exclude: ['**/*.integration.test.ts'],
      env,
    },
  }
})
