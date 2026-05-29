import type { Tab, Bookmark, HistoryEntry } from 'asyar-sdk/contracts';
import { isUrlLike, normaliseUrl } from './url';

export type Row =
  | { kind: 'tab'; title: string; subtitle: string; tab: Tab }
  | { kind: 'history'; title: string; subtitle: string; url: string; browserVariant: string }
  | { kind: 'bookmark'; title: string; subtitle: string; url: string; browserVariant: string }
  | { kind: 'url'; title: string; url: string }
  | { kind: 'search'; title: string; query: string };

const MAX_TABS = 20, MAX_HISTORY = 8, MAX_BOOKMARKS = 8, EMPTY_HISTORY = 4;

function host(u: string): string { try { return new URL(u).host; } catch { return u; } }

export function blendResults(
  query: string,
  data: { tabs: Tab[]; bookmarks: Bookmark[]; history: HistoryEntry[] },
): Row[] {
  const q = query.trim();
  const rows: Row[] = [];

  for (const t of data.tabs.slice(0, MAX_TABS)) {
    rows.push({ kind: 'tab', title: t.title || t.url, subtitle: `${t.browser.variant} · ${host(t.url)}`, tab: t });
  }
  const histLimit = q ? MAX_HISTORY : EMPTY_HISTORY;
  for (const h of data.history.slice(0, histLimit)) {
    rows.push({ kind: 'history', title: h.title || h.url, subtitle: `${h.browser.variant} · ${host(h.url)}`, url: h.url, browserVariant: h.browser.variant });
  }
  if (q) {
    for (const b of data.bookmarks.slice(0, MAX_BOOKMARKS)) {
      rows.push({ kind: 'bookmark', title: b.title || b.url, subtitle: `${b.browser.variant} · ${host(b.url)}`, url: b.url, browserVariant: b.browser.variant });
    }
    if (isUrlLike(q)) {
      rows.push({ kind: 'url', title: `Open ${normaliseUrl(q)}`, url: normaliseUrl(q) });
    }
    rows.push({ kind: 'search', title: `Search the web for "${q}"`, query: q });   // pinned last
  }
  return rows;
}
