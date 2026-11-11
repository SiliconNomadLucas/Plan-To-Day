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
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/no-unsupported-api": "error",
      "obsidianmd/prefer-create-el": "error",
      "obsidianmd/no-misused-promises": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unused-vars": ["error", { args: "none", ignoreRestSiblings: true }],
      "no-empty": "error",
    },
  },
  {
    files: ["src/settings.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "MemberExpression[computed=false][object.type='ThisExpression'][property.name='update']", message: "Use a runtime capability check for Obsidian 1.13+ settings refresh." },
        { selector: "MemberExpression[computed=false][object.type='ThisExpression'][property.name='display']", message: "Use the guarded legacy settings fallback." },
        { selector: "MemberExpression[computed=false][property.name='setDestructive']", message: "Use a runtime capability check for Obsidian 1.13+ destructive styling." },
        { selector: "MemberExpression[computed=false][property.name='setWarning']", message: "Use the guarded legacy destructive styling fallback." },
      ],
    },
  },
];
