import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "__tests__/mocks/vscode.ts"),
    },
  },
  test: {
    include: ["__tests__/**/*.test.ts"],
  },
});
