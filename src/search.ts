import type { ExtensionResult, IBrowserService } from 'asyar-sdk/contracts';
import { isUrlLike, normaliseUrl } from './url';
import { tabToResult, bookmarkToResult, historyToResult, openUrlToResult } from './result';

const MAX_PER_SOURCE = 20;

const TAB_SCORE_BASE = 0.85;
const BOOKMARK_SCORE_BASE = 0.75;
const HISTORY_SCORE_BASE = 0.55;
const DECAY = 0.02;

/**
 * Per-source wall-clock ceiling. Applied to EACH source independently, so the
 * handler is bounded by one budget rather than their sum.
 *
 * The host aggregates Tier-2 search results under a hard 200 ms budget and
 * drops a whole extension's response when it arrives late, so one slow source
 * does not merely lose its own rows — it loses every other source's rows too.
 * And slow is the normal case periodically: the launcher keeps a fingerprinted
 * copy of each browser's SQLite database for 45 s, and the first query after
 * that TTL rolls over pays a full multi-MB `fs::copy` of the database plus its
 * `-wal`/`-shm` sidecars. That is why the symptom was intermittent — a
 * function of time since the last browser query, not of the query text.
 *
 * Only history used to be bounded. Bookmarks had no ceiling at all (Firefox
 * bookmarks live in the same `places.sqlite` that history reads, behind the
 * same per-path copy lock; Chromium's `Bookmarks` is still a multi-MB JSON
 * parse), which left the handler unbounded regardless of the history budget.
 */
const SOURCE_BUDGET_MS = 100;

/**
 * Resolve what `source` produced if it settles inside `budgetMs`, else `null`.
 *
 * Never rejects and never leaves an unhandled rejection behind: the source's
 * own failure is folded to `null` up front, so a read that rejects *after*
 * losing the race is already handled. The timer is cleared on the way out so a
 * fast source doesn't hold a pending timeout open.
 */
async function withBudget<T>(source: Promise<T>, budgetMs: number): Promise<T | null> {
  const guarded = source.catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    return await Promise.race([guarded, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

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

  // Each source gets its own budget and degrades to `null` on its own. Fast
  // in-memory tabs are never held back by a cold on-disk bookmark or history
  // read, and a cold read costs only its own rows for that one query.
  const [tabs, bookmarks, history] = await Promise.all([
    withBudget(browser.listTabs({ query: q }), SOURCE_BUDGET_MS),
    withBudget(browser.listBookmarks({ query: q }), SOURCE_BUDGET_MS),
    withBudget(browser.searchHistory(q, { limit: MAX_PER_SOURCE }), SOURCE_BUDGET_MS),
  ]);

  if (tabs) {
    tabs.slice(0, MAX_PER_SOURCE).forEach((tab, i) => {
      out.push(tabToResult(tab, Math.max(0, TAB_SCORE_BASE - i * DECAY)));
    });
  }
  if (bookmarks) {
    bookmarks.slice(0, MAX_PER_SOURCE).forEach((bm, i) => {
      out.push(bookmarkToResult(bm, Math.max(0, BOOKMARK_SCORE_BASE - i * DECAY)));
    });
  }
  if (history) {
    history.slice(0, MAX_PER_SOURCE).forEach((h, i) => {
      out.push(historyToResult(h, Math.max(0, HISTORY_SCORE_BASE - i * DECAY)));
    });
  }

  return out;
}
