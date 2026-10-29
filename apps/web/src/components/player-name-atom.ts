import '@tanstack/react-start/client-only';
import { BrowserKeyValueStore } from '@effect/platform-browser';
import { Schema } from 'effect';
import { Atom } from 'effect/reactivity';

// Storage failures (private mode, blocked site data) leave the name in memory only.
export const playerNameAtom = Atom.kvs({
  runtime: Atom.runtime(BrowserKeyValueStore.layerLocalStorage),
  key: 'worldmap-paintball/player-name',
  schema: Schema.String,
  defaultValue: () => '',
});
