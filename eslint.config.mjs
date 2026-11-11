import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["main.js", "node_modules/**"],
  },
  {
    files: ["main.ts", "src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      obsidianmd,
    },
    rules: {
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/no-unsupported-api": "error",
    },
  },
];
