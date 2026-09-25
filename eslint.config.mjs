import next from "eslint-config-next";

export default [
  { ignores: [".next/**", "node_modules/**", ".data/**", "playwright-report/**", "test-results/**"] },
  ...next,
];
