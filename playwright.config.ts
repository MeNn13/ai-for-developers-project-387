import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['json', { outputFile: 'artifacts/e2e/report.json' }]],
  outputDir: 'artifacts/e2e/results',
  use: {
    baseURL: 'http://127.0.0.1:5187',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `dotnet backend/BookingCalendar.Api/bin/Release/net10.0/BookingCalendar.Api.dll --urls http://127.0.0.1:5187 --webroot "${resolve('frontend/dist')}"`,
    url: 'http://127.0.0.1:5187/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ASPNETCORE_ENVIRONMENT: 'Production' },
  },
})
