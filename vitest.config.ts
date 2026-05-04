// vitest.config.ts
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 15000,
    teardownTimeout: 5000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
    projects: [
      // Node pool — unit tests that mock fetch (no DOM/WebGL needed)
      {
        test: {
          name: "node",
          environment: "node",
          pool: "forks",
          include: [
            "tests/client.test.ts",
            "tests/remote.test.ts",
            "tests/selector.test.ts",
          ],
        },
      },
      // jsdom pool — tests that need document/canvas (mocked WebGL)
      {
        test: {
          name: "jsdom",
          environment: "jsdom",
          pool: "forks",
          include: ["tests/webgl-manager.test.ts"],
        },
      },
      // Browser pool — WebGL / canvas / DOM integration tests
      {
        test: {
          name: "browser",
          include: ["tests/browser/**/*.test.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
