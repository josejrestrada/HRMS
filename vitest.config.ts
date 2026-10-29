import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Database tests share one database, so files run one after another.
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
});
