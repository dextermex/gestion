import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Server modules carry the `server-only` marker; under vitest it is
      // a no-op so their logic can be exercised directly.
      "server-only": path.resolve(__dirname, "./src/lib/__tests__/helpers/server-only.ts"),
    },
  },
});
