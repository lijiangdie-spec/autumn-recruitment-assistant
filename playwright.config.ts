import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const chromiumExecutable = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

// Keep E2E isolated from the real desktop app, which normally occupies port 3000
// and points at the user's production database.
const e2eBaseUrl = "http://127.0.0.1:3107";
const e2eDataRoot = path.join(os.tmpdir(), `autumn-recruitment-assistant-e2e-${process.pid}`);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "html",
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure",
    launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
  },
  webServer: {
    command: "npm run start -- -p 3107",
    url: e2eBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      AUTUMN_ASSISTANT_DATA_ROOT: e2eDataRoot,
      RECRUITMENT_DB_PATH: path.join(e2eDataRoot, "recruitment.db"),
      RECRUITMENT_WORKSPACE_ROOT: path.join(e2eDataRoot, "applications"),
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
  ],
});
