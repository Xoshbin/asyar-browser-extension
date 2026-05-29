import { describe, expect, it, vi } from 'vitest';
import { aggregateSearch } from './search';

const browser = { family: 'chromium', variant: 'chrome', profileId: 'Default' } as const;

function makeBrowserProxy(opts: {
  tabs?: any[]; bookmarks?: any[]; history?: any[];
} = {}) {
  return {
    listTabs: vi.fn(async () => opts.tabs ?? []),
    listBookmarks: vi.fn(async () => opts.bookmarks ?? []),
    searchHistory: vi.fn(async () => opts.history ?? []),
    activateTab: vi.fn(),
    openUrl: vi.fn(),
  };
}

describe('aggregateSearch', () => {
  it('returns empty array for empty query', async () => {
    const out = await aggregateSearch('', makeBrowserProxy() as any);
    expect(out).toEqual([]);
  });

  it('URL-like query returns Open URL result with highest score', async () => {
    const proxy = makeBrowserProxy();
    const out = await aggregateSearch('example.com', proxy as any);
    expect(out[0].title).toContain('Open https://example.com');
    expect(out[0].score).toBeGreaterThanOrEqual(0.95);
  });

  it('aggregates tabs, bookmarks, history for a word query', async () => {
    const proxy = makeBrowserProxy({
      tabs: [{ id: 't1', browser, windowId: 'w', index: 0, title: 'GitHub T', url: 'https://github.com', isActive: false, isPinned: false, isAudible: false }],
      bookmarks: [{ id: 'b1', browser, title: 'GitHub B', url: 'https://github.com', folderPath: ['Bar'], addedAt: 0 }],
      history: [{ url: 'https://github.com', title: 'GitHub H', browser, lastVisitAt: 0, visitCount: 5 }],
    });
    const out = await aggregateSearch('github', proxy as any);
    expect(out.length).toBe(3);
    expect(proxy.listTabs).toHaveBeenCalledWith({ query: 'github' });
    expect(proxy.listBookmarks).toHaveBeenCalledWith({ query: 'github' });
    expect(proxy.searchHistory).toHaveBeenCalledWith('github', { limit: 20 });
  });

  it('ranks tabs above bookmarks above history when all match', async () => {
    const proxy = makeBrowserProxy({
      tabs: [{ id: 't', browser, windowId: 'w', index: 0, title: 'X', url: 'https://x.com', isActive: false, isPinned: false, isAudible: false }],
      bookmarks: [{ id: 'b', browser, title: 'X', url: 'https://x.com', folderPath: [], addedAt: 0 }],
      history: [{ url: 'https://x.com', title: 'X', browser, lastVisitAt: 0, visitCount: 1 }],
    });
    const out = await aggregateSearch('x', proxy as any);
    const tabScore = out.find(r => r.icon === '🌐')?.score ?? 0;
    const bookmarkScore = out.find(r => r.icon === '🔖')?.score ?? 0;
    const historyScore = out.find(r => r.icon === '🕘')?.score ?? 0;
    expect(tabScore).toBeGreaterThan(bookmarkScore);
    expect(bookmarkScore).toBeGreaterThan(historyScore);
  });

  it('tolerates one source failing without dropping the others', async () => {
    const proxy = makeBrowserProxy({
      tabs: [{ id: 't', browser, windowId: 'w', index: 0, title: 'X', url: 'https://x.com', isActive: false, isPinned: false, isAudible: false }],
      bookmarks: [{ id: 'b', browser, title: 'X', url: 'https://x.com', folderPath: [], addedAt: 0 }],
    });
    proxy.searchHistory = vi.fn(async () => { throw new Error('boom'); });
    const out = await aggregateSearch('x', proxy as any);
    // Tabs + bookmark still returned, history dropped silently
    expect(out.length).toBe(2);
  });
});
