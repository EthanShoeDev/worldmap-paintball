import { defineShoemakerFormat } from 'shoemaker-oxfmt-config';

export default defineShoemakerFormat({
  // shoemaker:begin options
  tailwindStylesheet: './apps/web/src/styles.css',
  ignorePatterns: ['apps/web/src/routeTree.gen.ts'],
  // shoemaker:end options
});
