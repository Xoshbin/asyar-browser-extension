import { describe, expect, it } from 'vitest';
import type { Tab, Bookmark, HistoryEntry } from 'asyar-sdk/contracts';
import { tabToResult, bookmarkToResult, historyToResult, openUrlToResult } from './result';

const browser = { family: 'chromium', variant: 'arc', profileId: 'Default' } as const;

const fakeTab: Tab = {
  id: 'tab-7',
  browser,
  windowId: 'w1',
  index: 0,
  title: 'GitHub Notifications',
  url: 'https://github.com/notifications',
  isActive: true,
  isPinned: false,
  isAudible: false,
};

const fakeBookmark: Bookmark = {
  id: 'arc:Default:42',
  browser,
  title: 'Rust Book',
  url: 'https://doc.rust-lang.org/book/',
  folderPath: ['Bookmarks Bar', 'Dev'],
  addedAt: 0,
};

const fakeHistory: HistoryEntry = {
  url: 'https://news.ycombinator.com',
  title: 'Hacker News',
  browser,
  lastVisitAt: Date.now(),
  visitCount: 42,
};

describe('tabToResult', () => {
  it('title is tab title, subtitle is "[variant] · url"', () => {
    const r = tabToResult(fakeTab, 0.8);
    expect(r.title).toBe('GitHub Notifications');
    expect(r.subtitle).toContain('arc');
    expect(r.subtitle).toContain('github.com');
    expect(r.score).toBe(0.8);
    expect(r.type).toBe('result');
  });

  it('declares the activate-tab action with the tab id as payload', () => {
    const r = tabToResult(fakeTab, 0.8);
    expect(r.actionId).toBe('activate-tab');
    expect(r.actionPayload).toEqual({ tabId: 'tab-7' });
  });
});

describe('bookmarkToResult', () => {
  it('subtitle shows folder path and variant', () => {
    const r = bookmarkToResult(fakeBookmark, 0.6);
    expect(r.title).toBe('Rust Book');
    expect(r.subtitle).toContain('Bookmarks Bar / Dev');
    expect(r.subtitle).toContain('arc');
  });

  it('declares the open-url action targeting the bookmark URL and browser', () => {
    const r = bookmarkToResult(fakeBookmark, 0.6);
    expect(r.actionId).toBe('open-url');
    expect(r.actionPayload).toEqual({ url: 'https://doc.rust-lang.org/book/', browser });
  });
});

describe('historyToResult', () => {
  it('subtitle shows visit count and variant', () => {
    const r = historyToResult(fakeHistory, 0.5);
    expect(r.subtitle).toContain('42 visits');
    expect(r.subtitle).toContain('arc');
  });

  it('declares the open-url action targeting the history URL and browser', () => {
    const r = historyToResult(fakeHistory, 0.5);
    expect(r.actionId).toBe('open-url');
    expect(r.actionPayload).toEqual({ url: 'https://news.ycombinator.com', browser });
  });
});

describe('openUrlToResult', () => {
  it('title shows the normalised URL', () => {
    const r = openUrlToResult('https://example.com', null);
    expect(r.title).toContain('Open');
    expect(r.title).toContain('https://example.com');
    expect(r.score).toBeGreaterThanOrEqual(0.95);
  });

  it('declares the open-url action with no browser when no preferred browser', () => {
    const r = openUrlToResult('https://x.com', null);
    expect(r.actionId).toBe('open-url');
    expect(r.actionPayload).toEqual({ url: 'https://x.com' });
  });

  it('declares the open-url action with the preferred browser when given', () => {
    const r = openUrlToResult('https://x.com', browser);
    expect(r.actionId).toBe('open-url');
    expect(r.actionPayload).toEqual({ url: 'https://x.com', browser });
  });
});
