import '@tanstack/react-start/client-only';
import { BrowserKeyValueStore } from '@effect/platform-browser';
import { Schema } from 'effect';
import { Atom } from 'effect/reactivity';

import { RenderScale } from './render-scale.ts';

const storage = Atom.runtime(BrowserKeyValueStore.layerLocalStorage);

export const renderScaleAtom = Atom.kvs({
  runtime: storage,
  key: 'worldmap-paintball/render-scale',
  schema: RenderScale,
  defaultValue: (): RenderScale => 'auto',
});

export const soundVolumeAtom = Atom.kvs({
  runtime: storage,
  key: 'worldmap-paintball/sound-volume',
  schema: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  defaultValue: () => 0.6,
});
