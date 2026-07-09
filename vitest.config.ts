import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "src/test/mocks/vscode.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
