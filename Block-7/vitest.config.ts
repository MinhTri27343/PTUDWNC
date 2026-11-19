import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    // starts ctl (+ 3 real service processes) unless it is already running
    globalSetup: ["tests/globalSetup.ts"],
  },
});
