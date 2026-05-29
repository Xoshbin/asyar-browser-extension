import { describe, expect, it } from 'vitest';
import type { BrowserId, BrowserKey } from 'asyar-sdk/contracts';
import { resolveOpenTarget } from './target';

const arc: BrowserKey = { family: 'chromium', variant: 'arc' };
const brave: BrowserKey = { family: 'chromium', variant: 'brave' };

describe('resolveOpenTarget', () => {
  it('most-recent → the bridge\'s last-active browser', () => {
    const t = resolveOpenTarget('most-recent', { mostRecent: arc, paired: [arc, brave] });
    expect(t).toEqual({ family: 'chromium', variant: 'arc', profileId: 'Default' });
  });
  it('most-recent with no last-active → first paired', () => {
    const t = resolveOpenTarget('most-recent', { mostRecent: null, paired: [brave, arc] });
    expect(t?.variant).toBe('brave');
  });
  it('most-recent with nothing paired → undefined (let the bridge fall back)', () => {
    expect(resolveOpenTarget('most-recent', { mostRecent: null, paired: [] })).toBeUndefined();
  });
  it('a specific variant → that paired browser', () => {
    const t = resolveOpenTarget('brave', { mostRecent: arc, paired: [arc, brave] });
    expect(t?.variant).toBe('brave');
  });
  it('a specific variant not currently paired → undefined', () => {
    expect(resolveOpenTarget('safari', { mostRecent: arc, paired: [arc, brave] })).toBeUndefined();
  });
});
