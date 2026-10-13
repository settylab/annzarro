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
    // The admin pages show names, paths and owners that other users control
    // (design 1.7). Text reaches the DOM through textContent / createTextNode
    // only, so markup-parsing sinks are forbidden here.
    files: ["static/js/admin/**/*.js"],
    rules: {
      "no-restricted-properties": ["error",
        { property: "innerHTML", message: "Admin pages build DOM with textContent / createElement (static/js/admin/dom.js)." },
        { property: "outerHTML", message: "Admin pages build DOM with textContent / createElement (static/js/admin/dom.js)." },
        { property: "insertAdjacentHTML", message: "Admin pages build DOM with textContent / createElement (static/js/admin/dom.js)." },
        { object: "document", property: "write", message: "document.write parses markup." },
        { object: "document", property: "writeln", message: "document.writeln parses markup." },
      ],
      "no-restricted-syntax": ["error",
        { selector: "NewExpression[callee.name='DOMParser']", message: "DOMParser parses markup." },
        { selector: "CallExpression[callee.property.name='createContextualFragment']", message: "createContextualFragment parses markup." },
        { selector: "CallExpression[callee.property.name='setHTMLUnsafe']", message: "setHTMLUnsafe parses markup." },
      ],
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
