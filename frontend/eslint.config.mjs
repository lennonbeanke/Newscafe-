import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // GSAP's typings declare an ambient `gsap` namespace, so a missing import still type-checks but throws at runtime.
    rules: {
      "no-restricted-globals": ["error", { name: "gsap", message: "Use the gsap instance passed to useGsap(), or import it from @/lib/gsap." }],
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
