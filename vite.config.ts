import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 80,
    experimentalSortPackageJson: true,
    experimentalSortImports: {
      newlinesBetween: false,
      partitionByNewline: true,
      groups: [["builtin"], ["external"]],
    },
  },
  staged: {
    "*": "vp fmt",
  },
});
