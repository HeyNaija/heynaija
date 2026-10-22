import { defineConfig, devices } from '@playwright/test'
import { env, root } from './lib/env.ts'

const GOOGLE = /google-auth\.spec\.ts/

// See docs/e2e.md. Runs against the local dev stack; reuses the dev servers when
// they are already up, and starts them otherwise.
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // Every test makes its own members, so tests can run side by side. Two workers:
  // more than that overloads `next dev` and sign-ups start timing out.
  fullyParallel: true,
  workers: process.env.CI ? 1 : 2,
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
  // The Google tests restart Kratos with a local test issuer in place of Google,
  // which would cut off other tests' sign-ins, so they run once the rest are done.
  // Depending on desktop and mobile means `pnpm e2e google-auth` runs those in
  // full first; `pnpm e2e:google` runs only the Google tests.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: GOOGLE },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/, testIgnore: GOOGLE },
    { name: 'google', use: { ...devices['Desktop Chrome'] }, testMatch: GOOGLE, dependencies: ['desktop', 'mobile'] },
    { name: 'google-mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/, testMatch: GOOGLE, dependencies: ['google'] },
  ],
  webServer: [
    {
      command: 'pnpm dev:api',
      env: { AUTH_EXTERNAL_REDIRECT_ORIGINS: 'https://accounts.google.com,http://127.0.0.1:5099' },
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
