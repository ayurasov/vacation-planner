// e2e интерфейса: сервер API (dist) + vite preview с прокси /api.
// Нужна подготовленная БД: миграции + seed (make seed). Локально: npm run e2e.
import { defineConfig, devices } from '@playwright/test';

const API_ENV = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://vacation:vacation@localhost:5432/vacation',
  JWT_SECRET: process.env.JWT_SECRET ?? 'e2e-secret-e2e-secret-e2e-secret-32',
  PORT: '8080',
  // Плановые задачи (извещения, эскалация) — чаще, чем раз в минуту: тест не ждёт минуту
  JOBS_POLL_SECONDS: '3',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../server',
      url: 'http://127.0.0.1:8080/healthz',
      env: API_ENV,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
});
