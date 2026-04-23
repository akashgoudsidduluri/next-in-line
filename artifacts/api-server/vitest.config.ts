import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false, // DB-backed tests must not interleave between files
    sequence: { concurrent: false },
    setupFiles: ["src/__tests__/setup.ts"],
  },
});
