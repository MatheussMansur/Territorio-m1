import js from "@eslint/js";
import nounsanitized from "eslint-plugin-no-unsanitized";
import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**", "test-results/**", "playwright-report/**", "public/**"] },
  js.configs.recommended,
  nounsanitized.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser } },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // As telas falam com a API só por src/services/api.
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.name='fetch']", message: "Use src/services/api em vez de fetch direto." },
        { selector: "CallExpression[callee.property.name='fetch']", message: "Use src/services/api em vez de fetch direto." },
        { selector: "NewExpression[callee.name='XMLHttpRequest']", message: "Use src/services/api." },
        { selector: "CallExpression[callee.property.name='sendBeacon']", message: "Use src/services/api." },
      ],
    },
  },
  {
    files: ["src/services/api/**", "src/mocks/**"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // As páginas públicas nunca puxam código do painel para o pacote do visitante.
    files: ["src/pages/**", "src/site/**", "src/features/booking/**", "src/features/landing/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["**/admin/**", "**/pages/admin/**", "**/features/admin/**"] }],
    },
  },
  {
    files: ["scripts/**", "tests/**", "*.config.js"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-restricted-syntax": "off" },
  },
];
