import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';

// Та же CSP, что отдаёт nginx стенда (web/nginx.conf): e2e на vite preview проверяет, что приложение работает под ней
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  preview: {
    headers: { 'Content-Security-Policy': CSP },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
