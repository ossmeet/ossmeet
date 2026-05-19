import pluginQuery from "@tanstack/eslint-plugin-query";
import pluginRouter from "@tanstack/eslint-plugin-router";
import tsParser from "@typescript-eslint/parser";

const tsFiles = ["src/**/*.{ts,tsx}"];

const withTsFiles = (config) => ({
  ...config,
  files: tsFiles,
});

export default [
  {
    ignores: ["dist/**", "node_modules/**", "src/routeTree.gen.ts"],
  },
  {
    files: tsFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
  },
  ...pluginQuery.configs["flat/recommended"].map(withTsFiles),
  ...pluginRouter.configs["flat/recommended"].map(withTsFiles),
];
