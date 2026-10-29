import '@tanstack/react-start/client-only';
import { BrowserKeyValueStore } from '@effect/platform-browser';
import { Atom } from 'effect/reactivity';

import { RenderScale } from './render-scale.ts';

export const renderScaleAtom = Atom.kvs({
  runtime: Atom.runtime(BrowserKeyValueStore.layerLocalStorage),
  key: 'worldmap-paintball/render-scale',
  schema: RenderScale,
  defaultValue: (): RenderScale => 'auto',
});
