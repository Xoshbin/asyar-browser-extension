import type { ExtensionResult, IBrowserService } from 'asyar-sdk/contracts';
import { isUrlLike, normaliseUrl } from './url';
import { tabToResult, bookmarkToResult, historyToResult, openUrlToResult } from './result';

const MAX_PER_SOURCE = 20;

const TAB_SCORE_BASE = 0.85;
const BOOKMARK_SCORE_BASE = 0.75;
const HISTORY_SCORE_BASE = 0.55;
const DECAY = 0.02;

export async function aggregateSearch(
  query: string,
  browser: IBrowserService,
): Promise<ExtensionResult[]> {
  const q = query.trim();
  if (!q) return [];

  const out: ExtensionResult[] = [];

  if (isUrlLike(q)) {
    out.push(openUrlToResult(normaliseUrl(q), null));
  }

  // Tabs, bookmarks, history fetched in parallel; one failure must not drop the others.
  const [tabsResult, bookmarksResult, historyResult] = await Promise.allSettled([
    browser.listTabs({ query: q }),
    browser.listBookmarks({ query: q }),
    browser.searchHistory(q, { limit: MAX_PER_SOURCE }),
  ]);

  if (tabsResult.status === 'fulfilled') {
    tabsResult.value.slice(0, MAX_PER_SOURCE).forEach((tab, i) => {
      out.push(tabToResult(tab, Math.max(0, TAB_SCORE_BASE - i * DECAY)));
    });
  }
  if (bookmarksResult.status === 'fulfilled') {
    bookmarksResult.value.slice(0, MAX_PER_SOURCE).forEach((bm, i) => {
      out.push(bookmarkToResult(bm, Math.max(0, BOOKMARK_SCORE_BASE - i * DECAY)));
    });
  }
  if (historyResult.status === 'fulfilled') {
    historyResult.value.slice(0, MAX_PER_SOURCE).forEach((h, i) => {
      out.push(historyToResult(h, Math.max(0, HISTORY_SCORE_BASE - i * DECAY)));
    });
  }

  return out;
}
