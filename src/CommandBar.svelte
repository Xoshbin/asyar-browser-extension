<script lang="ts">
  import { onMount } from 'svelte';
  import type { ExtensionContext } from 'asyar-sdk/view';
  import { ActionContext } from 'asyar-sdk/contracts';
  import type {
    IBrowserService,
    IPreferencesService,
    IActionService,
    IFeedbackService,
    ExtensionAction,
    BrowserId,
  } from 'asyar-sdk/contracts';
  import { blendResults, type Row } from './blend';
  import { resolveOpenTarget } from './target';
  import { copyText } from './clipboard';

  const EXTENSION_ID = 'org.asyar.browser';

  let { context }: { context: ExtensionContext } = $props();
  // `context` is a stable prop for this view's lifetime; reading the proxy
  // once at init is intentional.
  // svelte-ignore state_referenced_locally
  const browser = context.getService<IBrowserService>('browser');

  let query = $state('');
  let rows = $state<Row[]>([]);
  let selected = $state(0);
  let openTargetSetting = $state('most-recent');
  let listEl = $state<HTMLDivElement | null>(null);

  // Tracks whether any browser is paired so we can show install guidance when
  // the Asyar Companion isn't connected yet. `null` = not checked yet (avoids a
  // flash of the empty state before the first lookup resolves).
  let pairedCount = $state<number | null>(null);

  // Monotonic request serial: guards against a stale (earlier-issued)
  // refresh resolving AFTER a newer one and clobbering the results. On
  // fast typing each keystroke bumps `reqSeq`; only the latest in-flight
  // refresh is allowed to assign `rows`/`selected`. (NOT a debounce — every
  // query still fires immediately.)
  let reqSeq = 0;

  async function refresh(q: string): Promise<void> {
    const seq = ++reqSeq;
    // Promise.allSettled so one failing source never blanks the whole list.
    const [tabsR, histR, bmR] = await Promise.allSettled([
      browser.listTabs({ query: q }),
      browser.searchHistory(q, { limit: 8 }),
      q ? browser.listBookmarks({ query: q }) : Promise.resolve([]),
    ]);
    if (seq !== reqSeq) return; // a newer refresh superseded this one
    rows = blendResults(q, {
      tabs: tabsR.status === 'fulfilled' ? tabsR.value : [],
      history: histR.status === 'fulfilled' ? histR.value : [],
      bookmarks: bmR.status === 'fulfilled' ? bmR.value : [],
    });
    selected = 0;
  }

  async function resolveTarget(): Promise<BrowserId | undefined> {
    const [mostRecent, paired] = await Promise.all([
      browser.getMostRecentActiveBrowser(),
      browser.listPairedBrowsers(),
    ]);
    return resolveOpenTarget(openTargetSetting, { mostRecent, paired });
  }

  async function activate(row: Row | undefined): Promise<void> {
    if (!row) return;
    if (row.kind === 'tab') {
      await browser.activateTab(row.tab.id);
      return;
    }
    const target = await resolveTarget();
    if (row.kind === 'search') {
      await browser.searchWeb(row.query, target);
      return;
    }
    await browser.openUrl(row.url, target ? { browser: target } : undefined);
  }

  function move(delta: number): void {
    if (rows.length === 0) return;
    selected = Math.min(Math.max(selected + delta, 0), rows.length - 1);
  }

  function subtitleOf(row: Row): string {
    return 'subtitle' in row ? row.subtitle : '';
  }

  function urlOf(row: Row | undefined): string | undefined {
    if (!row) return undefined;
    if (row.kind === 'tab') return row.tab.url;
    if (row.kind === 'search') return undefined;
    return row.url;
  }

  const BROWSER_NAMES: Record<string, string> = {
    arc: 'Arc',
    brave: 'Brave',
    chrome: 'Chrome',
    edge: 'Edge',
    firefox: 'Firefox',
    safari: 'Safari',
    vivaldi: 'Vivaldi',
  };

  function browserName(variant: string): string {
    return BROWSER_NAMES[variant] ?? variant.charAt(0).toUpperCase() + variant.slice(1);
  }

  /**
   * The trailing slot: which browser the row lives in (or would open in), or
   * the key that opens it for the synthetic rows. Mono, because it is a
   * target and because it keeps the column optically aligned.
   */
  function accessoryOf(row: Row): string {
    if (row.kind === 'tab') return browserName(row.tab.browser.variant);
    if (row.kind === 'bookmark' || row.kind === 'history') return browserName(row.browserVariant);
    return '⏎';
  }

  const ICONS: Record<Row['kind'], string> = {
    tab: 'globe',
    bookmark: 'bookmark',
    history: 'history',
    search: 'search',
    url: 'link',
  };

  /** Stable per-row identity so closing a tab cannot shuffle rows onto each other. */
  function rowKey(row: Row): string {
    if (row.kind === 'tab') return `tab:${row.tab.id}`;
    if (row.kind === 'history') return `history:${row.browserVariant}:${row.url}`;
    if (row.kind === 'bookmark') return `bookmark:${row.browserVariant}:${row.url}`;
    if (row.kind === 'url') return `url:${row.url}`;
    return `search:${row.query}`;
  }

  function handleMessage(event: MessageEvent): void {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'asyar:view:search') {
      query = data.payload?.query ?? '';
    } else if (data.type === 'asyar:view:keydown') {
      const key = data.payload?.key;
      if (key === 'ArrowDown') move(1);
      else if (key === 'ArrowUp') move(-1);
      else if (key === 'Enter') void activate(rows[selected]);
    }
  }

  $effect(() => {
    void refresh(query);
  });

  // Keep the keyboard cursor on screen. `block: 'nearest'` moves the list only
  // when the row is actually out of view, so ↓ through visible rows is a
  // selection change and nothing else — no scroll jitter.
  $effect(() => {
    const index = selected;
    void rows.length;
    if (!listEl || index < 0) return;
    const row = listEl.querySelector<HTMLElement>(`[data-index="${index}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  });

  onMount(() => {
    void (async () => {
      try {
        const prefs = context.getService<IPreferencesService>('preferences');
        const all = await prefs.getAll();
        const v = all?.extension?.openTarget;
        if (typeof v === 'string' && v) openTargetSetting = v;
      } catch {
        /* keep default 'most-recent' */
      }
    })();
    void (async () => {
      try {
        const paired = await browser.listPairedBrowsers();
        pairedCount = paired.length;
      } catch {
        // Treat a lookup failure as "not paired" so guidance still surfaces.
        pairedCount = 0;
      }
    })();
    window.addEventListener('message', handleMessage);

    const actionsService = context.getService<IActionService>('actions');
    const feedback = context.getService<IFeedbackService>('feedback');

    const viewActions: ExtensionAction[] = [
      {
        id: `${EXTENSION_ID}:open`,
        title: 'Open',
        description: 'Switch to the tab, or open the URL',
        icon: '↵',
        category: 'Primary',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        primary: true,
        // Declaring Enter hands the key to this view: the launcher stops
        // submitting the search query to the extension when a primary action
        // owns it, and the iframe forwards the key here instead.
        shortcut: 'Enter',
        execute: async () => {
          await activate(rows[selected]);
        },
      },
      {
        // No shortcut: deleting is a ⌘K decision, and the platform reserves
        // ⌘⌫ for text editing (and drops shortcuts on destructive actions).
        id: `${EXTENSION_ID}:close-tab`,
        title: 'Close tab',
        icon: '✕',
        category: 'Destructive',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        destructive: true,
        execute: async () => {
          const row = rows[selected];
          if (row?.kind !== 'tab') {
            await feedback.showHUD('Select a tab to close');
            return;
          }
          const tabId = row.tab.id;
          await browser.closeTab(tabId);
          await feedback.showHUD('Tab closed');
          // Drop the row now so the list responds to the key that closed it,
          // then let the bridge's answer settle the final order.
          rows = rows.filter((r) => !(r.kind === 'tab' && r.tab.id === tabId));
          selected = Math.min(selected, Math.max(rows.length - 1, 0));
          await refresh(query);
        },
      },
      {
        // Mod+C is reserved for copying text, so this lives in ⌘K only.
        id: `${EXTENSION_ID}:copy-url`,
        title: 'Copy URL',
        icon: '📋',
        category: 'Share',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          const url = urlOf(rows[selected]);
          if (!url) {
            await feedback.showHUD('Nothing to copy');
            return;
          }
          await feedback.showHUD((await copyText(url)) ? 'Copied URL' : 'Copy failed');
        },
      },
      {
        id: `${EXTENSION_ID}:copy-markdown`,
        title: 'Copy as Markdown',
        icon: '📋',
        category: 'Share',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+Alt+C',
        execute: async () => {
          const row = rows[selected];
          const url = urlOf(row);
          if (!row || !url) {
            await feedback.showHUD('Nothing to copy');
            return;
          }
          const markdown = `[${row.title}](${url})`;
          await feedback.showHUD((await copyText(markdown)) ? 'Copied Markdown' : 'Copy failed');
        },
      },
      {
        id: `${EXTENSION_ID}:open-new-window`,
        title: 'Open in new window',
        icon: '🪟',
        category: 'Navigation',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+Enter',
        execute: async () => {
          const url = urlOf(rows[selected]);
          if (!url) {
            await feedback.showHUD('Nothing to open');
            return;
          }
          const target = await resolveTarget();
          await browser.openUrl(
            url,
            target ? { browser: target, newWindow: true } : { newWindow: true },
          );
        },
      },
    ];

    for (const action of viewActions) {
      actionsService.registerAction(action);
    }

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  });
</script>

<div class="command-bar" role="listbox" aria-label="Browser" tabindex="-1" bind:this={listEl}>
  {#each rows as row, i (rowKey(row))}
    <button
      type="button"
      class="row"
      class:selected={i === selected}
      role="option"
      aria-selected={i === selected}
      data-index={i}
      onclick={() => void activate(row)}
      onmouseenter={() => (selected = i)}
    >
      <span class="row-icon-tile" aria-hidden="true">
        <asyar-icon name={ICONS[row.kind]} size="16"></asyar-icon>
      </span>
      <div class="row-content">
        <span class="row-title">{row.title}</span>
        {#if subtitleOf(row)}
          <span class="row-subtitle">{subtitleOf(row)}</span>
        {/if}
      </div>
      <div class="row-accessory-container">
        {#if row.kind === 'tab'}
          <span class="kind-badge">Tab</span>
        {:else if row.kind === 'bookmark'}
          <span class="kind-badge">Bookmark</span>
        {/if}
        <span class="row-accessory">{accessoryOf(row)}</span>
      </div>
    </button>
  {/each}

  {#if pairedCount === 0 && rows.length === 0}
    <div class="companion-cta">
      <span class="cta-icon" aria-hidden="true">
        <asyar-icon name="puzzle" size="24"></asyar-icon>
      </span>
      <p class="cta-title">Connect your browser</p>
      <p class="cta-body">
        This view reads tabs, bookmarks, and history through the
        <strong>Asyar Companion</strong> browser extension. Install it in your browser, then approve
        it in <strong>Settings → Browsers</strong>.
      </p>
    </div>
  {:else if pairedCount !== null && rows.length === 0}
    <div class="empty-state">
      {#if query.trim()}
        <p class="empty-title">No browser tabs or history matching “{query.trim()}”</p>
        <p class="empty-body">Press ⏎ to search the web for “{query.trim()}”.</p>
      {:else}
        <p class="empty-title">No open tabs</p>
        <p class="empty-body">Open a tab in a paired browser, or type to search history.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .command-bar {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--space-2) var(--space-3);
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .command-bar::-webkit-scrollbar {
    width: var(--space-2);
  }

  .command-bar::-webkit-scrollbar-track {
    background: transparent;
  }

  .command-bar::-webkit-scrollbar-thumb {
    background-color: var(--scrollbar-thumb);
    border-radius: var(--radius-full);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    /* Standard Asyar launcher row metric: 38px, touching without random gaps */
    flex: 0 0 var(--shell-row-h);
    height: var(--shell-row-h);
    width: 100%;
    padding: 0 var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background-color: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: default;
    box-sizing: border-box;
    transition: none;
  }

  .row:hover {
    background-color: var(--bg-hover);
  }

  .row.selected {
    background-color: var(--bg-selected);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 35%, transparent);
  }

  .row:focus-visible {
    outline: none;
  }

  /* 22px icon tile: matches launcher optical icon column */
  .row-icon-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    background-color: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--separator);
  }

  .row.selected .row-icon-tile {
    color: var(--text-primary);
    background-color: color-mix(in srgb, var(--accent-primary) 18%, var(--bg-tertiary));
    border-color: color-mix(in srgb, var(--accent-primary) 35%, transparent);
  }

  .row-content {
    flex: 1 1 auto;
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    min-width: 0;
    overflow: hidden;
  }

  .row-title {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--text-primary);
    font-size: var(--font-size-base);
    font-weight: 500;
  }

  .row-subtitle {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
  }

  .row-accessory-container {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
    margin-left: auto;
  }

  .kind-badge {
    padding: 1px var(--space-2);
    border-radius: var(--radius-xs);
    background-color: var(--bg-tertiary);
    color: var(--text-tertiary);
    font-size: var(--font-size-2xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid var(--separator);
  }

  .row-accessory {
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }

  .row.selected .row-accessory {
    color: var(--text-secondary);
  }

  .companion-cta,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-2);
    padding: var(--space-9) var(--space-6);
  }

  .cta-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--size-2xl);
    height: var(--size-2xl);
    margin-bottom: var(--space-2);
    border-radius: var(--radius-lg);
    background-color: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .cta-title {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
  }

  .cta-body {
    margin: 0;
    max-width: 34ch;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }

  .cta-body strong {
    color: var(--text-primary);
    font-weight: var(--font-weight-medium);
  }

  .empty-title {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-base);
  }

  .empty-body {
    margin: 0;
    max-width: 36ch;
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }
</style>
