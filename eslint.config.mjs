import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "release/**",
    "dist-electron/**",
    "next-env.d.ts",
    "resources/app-runtime/**",
    // vendored 外部代码: openworkflow 自己的 eslint config 引用了我们没装的
    // sonarjs/unicorn 插件, 留下 "Definition for rule was not found" error。
    "design/**",
    // windows toolchain 静态资源不该被 lint 扫
    "resources/git-bash/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
