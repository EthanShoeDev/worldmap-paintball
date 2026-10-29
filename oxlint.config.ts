import { defineShoemakerConfig } from 'shoemaker-oxlint-config';

export default defineShoemakerConfig({
  // shoemaker:begin options
  scope: 'worldmap-paintball',
  react: true,
  tanstackRouter: true,
  tanstackQuery: true,
  playwright: true,
  testingLibrary: true,
  web: true,
  varlock: true,
  ignorePatterns: ['apps/web/src/routeTree.gen.ts'],
  // shoemaker:end options
  // Project rules: every change carries a one-line reason above it.
  rules: {},
});
