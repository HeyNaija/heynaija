import { defineConfig, devices } from '@playwright/test'
import { env, root } from './lib/env.ts'

// See docs/e2e.md. Runs against the local dev stack; reuses the dev servers when
// they are already up, and starts them otherwise.
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // Google callback tests temporarily reload the shared local Kratos provider.
  // One worker prevents that reload from interrupting another test's auth request.
  fullyParallel: true,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: env.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'pnpm dev:api',
      cwd: root,
      url: `${env.apiUrl}/healthz`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm dev:web',
      cwd: root,
      url: env.baseUrl,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
})
