import { defineConfig, devices } from "@playwright/test";
// 사용자가 확인 중인 13000 포트를 재사용하지 않는다.
const baseURL = "http://127.0.0.1:13100";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "../.venv/bin/python -B tests/mock_backend.py",
      url: "http://127.0.0.1:18080/",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 13100",
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        BACKEND_API_URL: "http://127.0.0.1:18080",
        NEXT_TELEMETRY_DISABLED: "1",
        NESTSIDE_TEST_BUILD: "1",
      },
    },
  ],
});
