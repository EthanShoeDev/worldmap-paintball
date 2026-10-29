import { Match, Schema } from 'effect';

import { renderTuning } from './tuning.ts';

const scales = ['auto', '100', '75', '50', '35'] as const;

export const RenderScale = Schema.Literals(scales);
export type RenderScale = typeof RenderScale.Type;

export const renderScales: ReadonlyArray<RenderScale> = scales;

export const renderScaleLabel = (scale: RenderScale) =>
  Match.value(scale).pipe(
    Match.when('auto', () => 'Auto'),
    Match.when('100', () => 'Native'),
    Match.orElse((percent) => `${percent}%`),
  );

// Device pixels per CSS pixel for `scale` on a screen whose own ratio is
// `native`. Auto follows PerformanceMonitor's 0–1 `factor`, topping out below
// native on high-DPI screens.
export const renderDpr = (
  scale: RenderScale,
  native: number,
  factor: number,
) => {
  const dpr =
    scale === 'auto'
      ? renderTuning.minDpr +
        (Math.min(native, renderTuning.autoMaxDpr) - renderTuning.minDpr) *
          factor
      : (native * Number(scale)) / 100;
  return Math.max(renderTuning.minDpr, Math.round(dpr * 20) / 20);
};
