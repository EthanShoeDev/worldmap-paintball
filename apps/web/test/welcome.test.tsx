import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Welcome } from '../src/components/welcome.tsx';

describe('Welcome', () => {
  it('greets by name', () => {
    expect(renderToString(<Welcome name='Ada' />)).toContain('Ada');
  });
});
