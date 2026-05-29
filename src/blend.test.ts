import { describe, expect, it } from 'vitest';
import { blendResults } from './blend';

const browser = { family: 'chromium', variant: 'chrome', profileId: 'Default' } as const;
const tab = (id: string, title: string, url: string) => ({ id, browser, windowId: 'w', index: 0, title, url, isActive: false, isPinned: false, isAudible: false });
const bm = (title: string, url: string) => ({ id: title, browser, title, url, folderPath: [], addedAt: 0 });
const hist = (title: string, url: string) => ({ url, title, browser, lastVisitAt: 0, visitCount: 1 });

describe('blendResults', () => {
  it('empty query → tabs then a few history, no search/url rows', () => {
    const rows = blendResults('', { tabs: [tab('1', 'A', 'https://a')], bookmarks: [], history: [hist('H', 'https://h')] });
    expect(rows[0].kind).toBe('tab');
    expect(rows.some(r => r.kind === 'history')).toBe(true);
    expect(rows.some(r => r.kind === 'search')).toBe(false);
  });
  it('non-empty query → tabs, history, bookmarks, then a search row pinned', () => {
    const rows = blendResults('react', {
      tabs: [tab('1', 'React', 'https://react.dev')],
      bookmarks: [bm('React docs', 'https://react.dev/docs')],
      history: [hist('react.dev/learn', 'https://react.dev/learn')],
    });
    const kinds = rows.map(r => r.kind);
    expect(kinds.indexOf('tab')).toBeLessThan(kinds.indexOf('history'));
    expect(kinds.indexOf('history')).toBeLessThan(kinds.indexOf('bookmark'));
    expect(rows[rows.length - 1].kind).toBe('search');           // search pinned last
  });
  it('URL-like query → an open-url row in addition to search', () => {
    const rows = blendResults('react.dev', { tabs: [], bookmarks: [], history: [] });
    expect(rows.some(r => r.kind === 'url')).toBe(true);
    expect(rows.some(r => r.kind === 'search')).toBe(true);
  });
  it('plain word query → search row but NO url row', () => {
    const rows = blendResults('hello world', { tabs: [], bookmarks: [], history: [] });
    expect(rows.some(r => r.kind === 'url')).toBe(false);
    expect(rows.some(r => r.kind === 'search')).toBe(true);
  });
});
