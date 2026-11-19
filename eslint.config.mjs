import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // A component declared inside another component is a new component on
    // every render: React unmounts and remounts everything under it, so an
    // input there loses focus after each keystroke. Declare components at
    // module scope, or write a plain function that returns elements.
    rules: {
      "react/no-unstable-nested-components": ["error", { allowAsProps: false }],
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Backend (Deno Edge Functions, SQL) shared with the mobile app: not
      // part of the Next.js app, not type-checked or linted by it.
      "supabase/**",
    ],
  },
];

export default eslintConfig;
