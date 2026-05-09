// @ts-check
import js from "@eslint/js";
import ts from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
    },
  },
  {
    files: ["apps/renderer/**/*.{ts,tsx}"],
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
    settings: { react: { version: "detect" } },
  },
  {
    // Config files and ad-hoc scripts are not part of any TS project
    files: [
      "*.mjs",
      "*.cjs",
      "**/*.config.{ts,js,mjs,cjs}",
      "**/postcss.config.js",
      "**/scripts/**/*.{js,mjs,cjs}",
    ],
    extends: [ts.configs.disableTypeChecked],
  },
  {
    // CJS config files need CJS globals
    files: ["*.cjs"],
    languageOptions: {
      globals: {
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
  {
    ignores: ["**/dist/**", "**/out/**", "**/.vite/**", "**/coverage/**"],
  },
  prettier,
);
