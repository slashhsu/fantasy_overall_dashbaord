import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": root,
      "server-only": path.resolve(root, "test/server-only.ts"),
    },
  },
  test: {
    exclude: ["test/e2e/**", "node_modules/**"],
    environment: "jsdom",
    globals: true,
    setupFiles: [path.resolve(root, "test/setup.ts")],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
