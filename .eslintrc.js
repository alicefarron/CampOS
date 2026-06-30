/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@campost/eslint-config"],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ["./tsconfig.json", "./apps/*/tsconfig.json", "./packages/*/tsconfig.json"],
  },
};
