import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: resolve(__dirname, "specs"),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 2,
  reporter: [
    ["list"],
    ["html", { outputFolder: resolve(__dirname, "playwright-report"), open: "never" }],
  ],
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: resolve(__dirname, "test-results"),
});
