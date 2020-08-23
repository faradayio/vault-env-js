module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  // We need this for no-floating-promises.
  parserOptions: {
    project: "tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier/@typescript-eslint",
  ],
  rules: {
    "no-inner-declarations": ["off"],
    // Try to catch forgotten `await` calls, which usually result in frustrating
    // bugs.
    "@typescript-eslint/no-floating-promises": ["warn"],
    "@typescript-eslint/no-inferrable-types": ["off"],
  },
};
