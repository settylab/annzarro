// Flat config for ESLint 9+ (replaces .eslintrc.js, which ESLint 10 no longer reads).
// Run with `npm run lint`; CI runs the same command, and
// annzarro/tests/static/test_eslint.py runs it from pytest.
import js from "@eslint/js";
import globals from "globals";

// 0.8.0 guards (F0). A spread into Math.max / Math.min overflows V8's call stack on a
// large column; confirm, alert and prompt are the browser's blocking dialogs, which
// the app replaces with its own. Old code that trips the spread rule is listed in
// SPREAD_LEGACY and is fixed there, never extended: every other file is held to it.
const SPREAD_LEGACY = [
  "static/js/utils/legend-options.js",
  "static/js/utils/line-select.js",
  "annzarro/tests/js/array-stats.test.mjs",
];
const DIALOG_NAME = "/^(confirm|alert|prompt)$/";
const NO_DIALOG_NAMES = [
  { selector: `FunctionDeclaration[id.name=${DIALOG_NAME}]`, message: "Do not name a function confirm, alert or prompt: it shadows the blocking browser dialog." },
  { selector: `VariableDeclarator[id.name=${DIALOG_NAME}][init.type=/Function/]`, message: "Do not name a function confirm, alert or prompt: it shadows the blocking browser dialog." },
  { selector: `MethodDefinition[key.name=${DIALOG_NAME}]`, message: "Do not name a method confirm, alert or prompt." },
  { selector: `Property[key.name=${DIALOG_NAME}][value.type=/Function/]`, message: "Do not name a function confirm, alert or prompt." },
];
const NO_MATH_SPREAD = {
  selector: "CallExpression[callee.object.name='Math'][callee.property.name=/^(max|min)$/] > SpreadElement",
  message: "Math.max(...x) and Math.min(...x) overflow the stack on a large column; use arrayMin / arrayMax from utils/array-stats.js.",
};
const ADMIN_MARKUP_SYNTAX = [
  { selector: "NewExpression[callee.name='DOMParser']", message: "DOMParser parses markup." },
  { selector: "CallExpression[callee.property.name='createContextualFragment']", message: "createContextualFragment parses markup." },
  { selector: "CallExpression[callee.property.name='setHTMLUnsafe']", message: "setHTMLUnsafe parses markup." },
];

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
      "no-restricted-syntax": ["error", ...ADMIN_MARKUP_SYNTAX, ...NO_DIALOG_NAMES, NO_MATH_SPREAD],
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
  {
    files: ["static/js/**/*.js", "annzarro/tests/js/**/*.mjs"],
    ignores: ["static/js/admin/**", ...SPREAD_LEGACY],
    rules: { "no-restricted-syntax": ["error", ...NO_DIALOG_NAMES, NO_MATH_SPREAD] },
  },
  {
    files: SPREAD_LEGACY,
    rules: { "no-restricted-syntax": ["error", ...NO_DIALOG_NAMES] },
  },
];
