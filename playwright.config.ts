import { defineConfig } from '@playwright/test'
const production = !!process.env.AGR_E2E_PRODUCTION
const remoteURL = process.env.AGR_E2E_URL
const previewPort = process.env.AGR_E2E_PORT || '4190'
const baseURL = remoteURL || (production ? `http://127.0.0.1:${previewPort}` : 'http://127.0.0.1:4189')
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    viewport: { width: 1440, height: 1040 },
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--enable-webgl',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    },
  },
  webServer: remoteURL ? undefined : {
    // The production run must serve the artifact with the Azure globalHeaders
    // applied; `vite preview` omits them, which is how a policy that breaks the
    // page used to pass CI and fail only on the public site.
    command: production ? `npm run preview:release -- --port ${previewPort}` : 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
})
