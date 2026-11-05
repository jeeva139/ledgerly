import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Tests run inside Electron's Node runtime (see scripts/run-tests.mjs) because the database layer
// uses the `node:sqlite` module that ships with Electron's Node, not with the host Node 20.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'threads',
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
