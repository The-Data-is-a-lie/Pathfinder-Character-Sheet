// Acceptance harness config. See tests/README.md and tests/features.json.
import { defineConfig, devices } from '@playwright/test';

const PORT = 8971;

export default defineConfig({
    testDir: 'tests',
    testMatch: '**/*.spec.mjs',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: [
        ['list'],
        // tools/features.mjs reads this to map feature annotations to results.
        ['json', { outputFile: 'tests/.last-run.json' }],
        ['html', { open: 'never' }],
    ],
    use: {
        baseURL: `http://127.0.0.1:${PORT}/`,
        // The PWA worker would otherwise serve cached shell files between runs.
        serviceWorkers: 'block',
        // Below ~1280px the action rail intercepts tab clicks.
        viewport: { width: 1440, height: 950 },
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 950 } } }],
    webServer: {
        command: `node tools/serve.mjs ${PORT}`,
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: !process.env.CI,
    },
});
