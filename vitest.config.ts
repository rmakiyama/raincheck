import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Worktrees live under .claude/worktrees/ inside this checkout; Vitest's
    // default glob would run their copies of the suite too.
    include: ["test/**/*.test.ts"],
  },
});
