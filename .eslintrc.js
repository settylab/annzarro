module.exports = {
  env: {
    browser: true,
    es2021: true,
    jest: true,
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  globals: {
    zarr: 'readonly',
    Plotly: 'readonly',
    $: 'readonly',
    bootstrap: 'readonly',
    DataTable: 'readonly',
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-console': ['warn', { allow: ['error', 'warn', 'info'] }],
  },
};