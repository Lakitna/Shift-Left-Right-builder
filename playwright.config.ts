import { defineConfig, devices } from '@playwright/test';

const PORT = 8080;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * GUI tests. The app is build-then-serve (not a dev server), so Playwright starts a web
 * server that builds `dist/web` and serves it with the repo's own zero-dependency static
 * server.
 *
 * Chromium and Firefox are both covered, and test order is randomised (`--shuffle` in the
 * `test:e2e` script) so a hidden dependency between tests cannot survive behind a fixed order.
 */
export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    // Two browser projects run at once, and every worker starts its own browser, so Playwright's
    // default (half the cores) multiplied by two projects oversubscribes a dev machine — unrelated
    // tests then fail with 30s actionability timeouts. A deliberately small pool keeps a failure
    // meaningful.
    // A small, explicit pool. Each project starts its own browsers, and Firefox in particular starts
    // crashing its renderer ("RenderCompositorSWGL failed mapping default framebuffer") and timing
    // out on downloads once a dozen instances run at once — failures that look real but are pure
    // contention. Verified: the same specs pass in isolation and fail under the default pool.
    workers: process.env.CI ? 2 : 4,
    reporter: [['list']],
    // Baselines live next to the spec that owns them, one folder per spec *and browser*:
    // Chromium and Firefox rasterise text and shapes differently and must not share a baseline.
    snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFileName}/{arg}{ext}',
    expect: {
        toHaveScreenshot: {
            // Web fonts + pattern/gradient fills make pixel-exact comparison unrealistic;
            // a small tolerance keeps the check meaningful without being flaky.
            maxDiffPixels: 150,
            animations: 'disabled',
        },
    },
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                headless: true,
                permissions: ['clipboard-read', 'clipboard-write'],
            },
        },
        { name: 'firefox', use: { ...devices['Desktop Firefox'], headless: true } },
    ],
    webServer: {
        command: `npm run build && node ./scripts/serve-web.mjs ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
