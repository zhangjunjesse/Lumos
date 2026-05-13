import { defineConfig } from '@playwright/test';

// Dedicated config for the ecommerce-app e2e spec.
// Uses port 3457 to align with the local dev server already running in this worktree
// and avoids spinning up a second one.
export default defineConfig({
  testDir: './src/__tests__/e2e-ecommerce',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3457',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'PORT=3457 npx next dev --port 3457',
    url: 'http://localhost:3457/apps/ecommerce-assistant',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
