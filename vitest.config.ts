import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node environment — we're an SDK for Node, not the browser.
    environment: "node",
    // Strict mode catches accidental globals + unhandled rejections.
    // Surfaces test bugs that would otherwise hide.
    globals: false,
    include: ["tests/**/*.test.ts"],
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/version.ts"],
    },
    // Reasonable timeout — most tests are HTTP mocks (sub-100ms);
    // anything past 10s is a real bug, not a slow test.
    testTimeout: 10_000,
  },
});
