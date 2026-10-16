import type { ExtensionResult, IBrowserService } from 'asyar-sdk/contracts';
import { isUrlLike, normaliseUrl } from './url';
import { tabToResult, bookmarkToResult, historyToResult, openUrlToResult } from './result';

const MAX_PER_SOURCE = 20;

const TAB_SCORE_BASE = 0.85;
const BOOKMARK_SCORE_BASE = 0.75;
const HISTORY_SCORE_BASE = 0.55;
const DECAY = 0.02;
const HISTORY_BUDGET_MS = 100;

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

  // Tabs and bookmarks must not miss the host's 200 ms search budget because a
  // large on-disk history database is still being scanned.
  const [tabsResult, bookmarksResult, historyResult] = await Promise.allSettled([
    browser.listTabs({ query: q }),
    browser.listBookmarks({ query: q }),
    Promise.race([
      browser.searchHistory(q, { limit: MAX_PER_SOURCE }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('history search budget exceeded')), HISTORY_BUDGET_MS),
      ),
    ]),
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
