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
  overrides: [
    {
      files: ['apps/web/src/game/**/*.tsx'],
      rules: {
        // R3F intrinsics (<mesh geometry>, shadow-camera-*) aren't DOM; tsc checks their props.
        'react/no-unknown-property': 'off',
      },
    },
  ],
});
