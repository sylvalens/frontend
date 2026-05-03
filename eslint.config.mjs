import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message:
            "Use shared helpers from src/lib/number-format.ts (formatFixed/formatInteger) instead of direct toFixed().",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleString']",
          message:
            "Use shared helper from src/lib/number-format.ts (formatGroupedInteger) instead of direct toLocaleString().",
        },
      ],
    },
  },
  {
    files: ["src/lib/number-format.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
