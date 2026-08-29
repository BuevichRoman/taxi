import { defineConfig, devices } from '@playwright/test'

/**
 * Прогон приложения няни против мока API.
 *
 * Приложение берётся собранным, а не из dev-сервера: сборка ближе к тому,
 * что видит заказчик, и не зависит от вотчера. Собрать перед прогоном:
 *
 *   REACT_APP_SERVER_URL=http://localhost:4010/api/v1 npm run build
 */
const MOCK_PORT = 4010
const APP_PORT = 4173

export default defineConfig({
  testDir: './e2e/specs',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/mock-server/src/server.ts',
      port: MOCK_PORT,
      env: { MOCK_QUIET: '1' },
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
    },
    {
      command: 'node e2e/static-server.mjs',
      port: APP_PORT,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
