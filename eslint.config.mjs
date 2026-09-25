import next from "eslint-config-next";

const config = [
  { ignores: [".next/**", "node_modules/**", ".data/**", "playwright-report/**", "test-results/**"] },
  ...next,
];

export default config;
