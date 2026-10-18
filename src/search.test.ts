import { describe, expect, it, vi } from 'vitest';
import { aggregateSearch } from './search';

const browser = { family: 'chromium', variant: 'chrome', profileId: 'Default' } as const;

function makeBrowserProxy(
  opts: {
    tabs?: any[];
    bookmarks?: any[];
    history?: any[];
  } = {},
) {
  return {
    listTabs: vi.fn(async () => opts.tabs ?? []),
    listBookmarks: vi.fn(async () => opts.bookmarks ?? []),
    searchHistory: vi.fn(async () => opts.history ?? []),
    activateTab: vi.fn(),
    openUrl: vi.fn(),
  };
}

describe('aggregateSearch', () => {
  it('returns tabs without waiting for a stalled history lookup', async () => {
    vi.useFakeTimers();
    const proxy = makeBrowserProxy({
      tabs: [
        {
          id: 't',
          browser,
          windowId: 'w',
          index: 0,
          title: 'Fast tab',
          url: 'https://fast.test',
          isActive: true,
          isPinned: false,
          isAudible: false,
        },
      ],
    });
    proxy.searchHistory = vi.fn(() => new Promise(() => {}));

    const pending = aggregateSearch('fast', proxy as any);
    await vi.advanceTimersByTimeAsync(150);

    await expect(pending).resolves.toEqual([expect.objectContaining({ title: 'Fast tab' })]);
    vi.useRealTimers();
  });

  it('returns tab and bookmark rows when a cold history snapshot copy stalls', async () => {
    // The launcher caches a fingerprinted copy of each browser's SQLite
    // history for 45 s; the first query after that TTL rolls over pays a full
    // multi-MB file copy. The host drops a whole Tier-2 response that misses
    // its 200 ms budget, so a cold history read must cost its own rows only.
    vi.useFakeTimers();
    const proxy = makeBrowserProxy({
      tabs: [
        {
          id: 't',
          browser,
          windowId: 'w',
          index: 0,
          title: 'Cached tab',
          url: 'https://tab.test',
          isActive: true,
          isPinned: false,
          isAudible: false,
        },
      ],
      bookmarks: [
        { id: 'b', browser, title: 'Cached bookmark', url: 'https://bm.test', folderPath: [], addedAt: 0 },
      ],
    });
    proxy.searchHistory = vi.fn(() => new Promise(() => {}));

    const pending = aggregateSearch('cached', proxy as any);
    await vi.advanceTimersByTimeAsync(150);

    await expect(pending).resolves.toEqual([
      expect.objectContaining({ title: 'Cached tab' }),
      expect.objectContaining({ title: 'Cached bookmark' }),
    ]);
    vi.useRealTimers();
  });

  it('returns in-memory tabs without waiting for a stalled bookmarks read', async () => {
    // Firefox bookmarks live in places.sqlite, so they go through the same
    // snapshot copy as history — and a Chromium Bookmarks JSON file is still a
    // multi-MB disk read. Bookmarks was the one source with no budget at all,
    // which left the whole handler unbounded no matter what history did.
    vi.useFakeTimers();
    const proxy = makeBrowserProxy({
      tabs: [
        {
          id: 't',
          browser,
          windowId: 'w',
          index: 0,
          title: 'Fast tab',
          url: 'https://fast.test',
          isActive: true,
          isPinned: false,
          isAudible: false,
        },
      ],
    });
    proxy.listBookmarks = vi.fn(() => new Promise(() => {}));

    const pending = aggregateSearch('fast', proxy as any);
    await vi.advanceTimersByTimeAsync(150);

    await expect(pending).resolves.toEqual([expect.objectContaining({ title: 'Fast tab' })]);
    vi.useRealTimers();
  });

  it('returns disk rows when the in-memory tab lookup stalls', async () => {
    vi.useFakeTimers();
    const proxy = makeBrowserProxy({
      bookmarks: [
        { id: 'b', browser, title: 'Disk bookmark', url: 'https://bm.test', folderPath: [], addedAt: 0 },
      ],
    });
    proxy.listTabs = vi.fn(() => new Promise(() => {}));

    const pending = aggregateSearch('disk', proxy as any);
    await vi.advanceTimersByTimeAsync(150);

    await expect(pending).resolves.toEqual([
      expect.objectContaining({ title: 'Disk bookmark' }),
    ]);
    vi.useRealTimers();
  });

  it('bounds the handler by one source budget, not the sum of three', async () => {
    // All three sources cold: the response must still land inside the host's
    // 200 ms Tier-2 budget because the budgets run concurrently.
    vi.useFakeTimers();
    const proxy = makeBrowserProxy();
    proxy.listTabs = vi.fn(() => new Promise(() => {}));
    proxy.listBookmarks = vi.fn(() => new Promise(() => {}));
    proxy.searchHistory = vi.fn(() => new Promise(() => {}));

    let settled = false;
    const pending = aggregateSearch('cold', proxy as any).then((out) => {
      settled = true;
      return out;
    });

    await vi.advanceTimersByTimeAsync(150);
    expect(settled).toBe(true);
    await expect(pending).resolves.toEqual([]);
    vi.useRealTimers();
  });

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
      tabs: [
        {
          id: 't1',
          browser,
          windowId: 'w',
          index: 0,
          title: 'GitHub T',
          url: 'https://github.com',
          isActive: false,
          isPinned: false,
          isAudible: false,
        },
      ],
      bookmarks: [
        {
          id: 'b1',
          browser,
          title: 'GitHub B',
          url: 'https://github.com',
          folderPath: ['Bar'],
          addedAt: 0,
        },
      ],
      history: [
        { url: 'https://github.com', title: 'GitHub H', browser, lastVisitAt: 0, visitCount: 5 },
      ],
    });
    const out = await aggregateSearch('github', proxy as any);
    expect(out.length).toBe(3);
    expect(proxy.listTabs).toHaveBeenCalledWith({ query: 'github' });
    expect(proxy.listBookmarks).toHaveBeenCalledWith({ query: 'github' });
    expect(proxy.searchHistory).toHaveBeenCalledWith('github', { limit: 20 });
  });

  it('ranks tabs above bookmarks above history when all match', async () => {
    const proxy = makeBrowserProxy({
      tabs: [
        {
          id: 't',
          browser,
          windowId: 'w',
          index: 0,
          title: 'X',
          url: 'https://x.com',
          isActive: false,
          isPinned: false,
          isAudible: false,
        },
      ],
      bookmarks: [
        { id: 'b', browser, title: 'X', url: 'https://x.com', folderPath: [], addedAt: 0 },
      ],
      history: [{ url: 'https://x.com', title: 'X', browser, lastVisitAt: 0, visitCount: 1 }],
    });
    const out = await aggregateSearch('x', proxy as any);
    const tabScore = out.find((r) => r.icon === '🌐')?.score ?? 0;
    const bookmarkScore = out.find((r) => r.icon === '🔖')?.score ?? 0;
    const historyScore = out.find((r) => r.icon === '🕘')?.score ?? 0;
    expect(tabScore).toBeGreaterThan(bookmarkScore);
    expect(bookmarkScore).toBeGreaterThan(historyScore);
  });

  it('tolerates one source failing without dropping the others', async () => {
    const proxy = makeBrowserProxy({
      tabs: [
        {
          id: 't',
          browser,
          windowId: 'w',
          index: 0,
          title: 'X',
          url: 'https://x.com',
          isActive: false,
          isPinned: false,
          isAudible: false,
        },
      ],
      bookmarks: [
        { id: 'b', browser, title: 'X', url: 'https://x.com', folderPath: [], addedAt: 0 },
      ],
    });
    proxy.searchHistory = vi.fn(async () => {
      throw new Error('boom');
    });
    const out = await aggregateSearch('x', proxy as any);
    // Tabs + bookmark still returned, history dropped silently
    expect(out.length).toBe(2);
  });
});
