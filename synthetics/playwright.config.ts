import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/test-results', // gravável pelo usuário não-root do container
  timeout: 30_000,
  retries: 1, // 1 retry evita alerta por falha intermitente de rede
  workers: 1,
  reporter: [['list'], ['./pushgateway-reporter.ts']],
  use: {
    baseURL: process.env.BASE_URL,
    extraHTTPHeaders: { 'User-Agent': 'synthetic-monitor/1.0' },
  },
});
