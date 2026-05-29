import type { Bookmark, BrowserId, ExtensionResult, HistoryEntry, Tab } from 'asyar-sdk/contracts';

function variantLabel(b: BrowserId | { variant: string }): string {
  return b.variant;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function tabToResult(tab: Tab, score: number): ExtensionResult {
  return {
    title: tab.title || tab.url,
    subtitle: `${variantLabel(tab.browser)} · ${hostOf(tab.url)}`,
    icon: '🌐',
    score,
    type: 'result',
    action: () => {},
    actionId: 'activate-tab',
    actionPayload: { tabId: tab.id },
  };
}

export function bookmarkToResult(bm: Bookmark, score: number): ExtensionResult {
  const folder = bm.folderPath.join(' / ');
  return {
    title: bm.title || bm.url,
    subtitle: `${variantLabel(bm.browser)} · ${folder} · ${hostOf(bm.url)}`,
    icon: '🔖',
    score,
    type: 'result',
    action: () => {},
    actionId: 'open-url',
    actionPayload: { url: bm.url, browser: bm.browser },
  };
}

export function historyToResult(h: HistoryEntry, score: number): ExtensionResult {
  return {
    title: h.title || h.url,
    subtitle: `${variantLabel(h.browser)} · ${h.visitCount} visits · ${hostOf(h.url)}`,
    icon: '🕘',
    score,
    type: 'result',
    action: () => {},
    actionId: 'open-url',
    actionPayload: { url: h.url, browser: h.browser },
  };
}

export function openUrlToResult(
  normalisedUrl: string,
  preferred: BrowserId | null,
): ExtensionResult {
  return {
    title: `Open ${normalisedUrl}`,
    subtitle: preferred ? `in ${preferred.variant}` : 'in default browser',
    icon: '🔗',
    score: 0.99,
    type: 'result',
    action: () => {},
    actionId: 'open-url',
    actionPayload: preferred
      ? { url: normalisedUrl, browser: preferred }
      : { url: normalisedUrl },
  };
}
