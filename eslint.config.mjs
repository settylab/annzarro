// Flat config for ESLint 9+ (replaces .eslintrc.js, which ESLint 10 no longer reads).
// Run with `npm run lint`; CI runs the same command, and
// annzarro/tests/static/test_eslint.py runs it from pytest.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["static/vendor/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["static/js/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        // Loaded by <script> tags from static/vendor before the app modules.
        zarr: "readonly",
        Plotly: "readonly",
        $: "readonly",
        jQuery: "readonly",
        bootstrap: "readonly",
        chroma: "readonly",
        DataTable: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": ["warn", { allow: ["error", "warn", "info"] }],
    },
  },
  {
    files: ["annzarro/tests/js/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": "warn",
    },
  },
];
