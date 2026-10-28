import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // esbuild не эмитит design:paramtypes — NestJS-DI требует SWC
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false, // файлы делят одну тестовую БД — выполняем последовательно
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://vacation:vacation@localhost:5432/vacation_test',
      JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-test-secret-test-32ch',
      PORT: '0',
      MAIL_POLL_SECONDS: '0', // фоновая отправка в тестах не нужна: очередь разбирается вызовом flush()
    },
  },
});
