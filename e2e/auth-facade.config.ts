import { defineConfig } from '@playwright/test'

// Browser integration with fixture HTTP responses, not a live Kratos/auth test.
export default defineConfig({
  testDir: './auth-facade',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: { baseURL: 'http://127.0.0.1:3307' },
  webServer: [
    { command: 'node auth-facade/server.mjs', url: 'http://127.0.0.1:4407/health', timeout: 30_000 },
    { command: 'node auth-facade/api.mjs', url: 'http://127.0.0.1:4408/v1/health', timeout: 30_000 },
    {
      command: 'pnpm --filter @heynaija/web exec next dev -H 127.0.0.1 -p 3307',
      url: 'http://127.0.0.1:3307/auth-error',
      timeout: 180_000,
      env: { API_INTERNAL_URL: 'http://127.0.0.1:4408', KRATOS_INTERNAL_URL: 'http://127.0.0.1:4407' },
    },
  ],
})
