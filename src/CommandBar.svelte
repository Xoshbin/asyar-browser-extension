<script lang="ts">
  import { onMount } from 'svelte';
  import type { ExtensionContext } from 'asyar-sdk/contracts';
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

  interface SearchBarAccessoryLike {
    onChange(handler: (value: string) => void): () => void;
    set?(opts: {
      options?: Array<{
        value: string;
        title: string;
        selected?: boolean;
        subtitle?: string;
        children?: any[];
      }>;
      value?: string;
      buttonTitle?: string;
    }): Promise<void>;
  }

  let {
    context,
    searchBarAccessory,
  }: { context: ExtensionContext; searchBarAccessory?: SearchBarAccessoryLike } = $props();
  // `context` is a stable prop for this view's lifetime; reading the proxy
  // once at init is intentional.
  // svelte-ignore state_referenced_locally
  const browser = context.getService<IBrowserService>('browser');
  // svelte-ignore state_referenced_locally
  const extensionManager = context.getService<any>('extensions');

  type KindFilter = 'all' | 'tabs' | 'history' | 'bookmarks';

  let query = $state('');
  let kindFilter = $state<KindFilter>('all');
  let browserFilter = $state<string>('all');
  let availableVariants = $state<string[]>([]);
  let rawRows = $state<Row[]>([]);
  let selected = $state(0);
  let openTargetSetting = $state('most-recent');
  let listEl = $state<HTMLDivElement | null>(null);

  const rows = $derived.by(() => {
    let list = rawRows;

    if (kindFilter === 'tabs') {
      list = list.filter((r) => r.kind === 'tab');
    } else if (kindFilter === 'history') {
      list = list.filter((r) => r.kind === 'history');
    } else if (kindFilter === 'bookmarks') {
      list = list.filter((r) => r.kind === 'bookmark');
    }

    if (browserFilter !== 'all') {
      list = list.filter((r) => {
        if (r.kind === 'tab') {
          return r.tab.browser.variant.toLowerCase() === browserFilter.toLowerCase();
        }
        if (r.kind === 'history' || r.kind === 'bookmark') {
          return r.browserVariant.toLowerCase() === browserFilter.toLowerCase();
        }
        return true;
      });
    }

    return list;
  });

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
    rawRows = blendResults(q, {
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
    return BROWSER_NAMES[variant.toLowerCase()] ?? variant.charAt(0).toUpperCase() + variant.slice(1);
  }

  function isBrowserRow(row: Row): boolean {
    return row.kind === 'tab' || row.kind === 'bookmark' || row.kind === 'history';
  }

  function rowBrowserVariant(row: Row): string {
    if (row.kind === 'tab') return row.tab.browser.variant;
    if (row.kind === 'bookmark' || row.kind === 'history') return row.browserVariant;
    return '';
  }

  function faviconOf(row: Row): string | null {
    if (row.kind === 'tab' && row.tab.faviconUrl && row.tab.faviconUrl.startsWith('http')) {
      return row.tab.faviconUrl;
    }
    const url = urlOf(row);
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (
        !parsed.hostname ||
        parsed.protocol.startsWith('chrome') ||
        parsed.protocol.startsWith('brave') ||
        parsed.protocol.startsWith('edge') ||
        parsed.protocol.startsWith('about')
      ) {
        return null;
      }
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`;
    } catch {
      return null;
    }
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

  // Dynamically update the launcher's bottom-bar action pill based on the selected row
  $effect(() => {
    const row = rows[selected];
    if (!row) {
      extensionManager?.setActiveViewActionLabel?.('Open');
      return;
    }
    if (row.kind === 'tab') {
      const name = browserName(row.tab.browser.variant);
      extensionManager?.setActiveViewActionLabel?.(`Open in ${name}`);
    } else if (row.kind === 'history' || row.kind === 'bookmark') {
      const name = browserName(row.browserVariant);
      extensionManager?.setActiveViewActionLabel?.(`Open in ${name}`);
    } else if (row.kind === 'search') {
      extensionManager?.setActiveViewActionLabel?.('Search Web');
    } else if (row.kind === 'url') {
      extensionManager?.setActiveViewActionLabel?.('Open URL');
    } else {
      extensionManager?.setActiveViewActionLabel?.('Open');
    }
  });

  function buildAccessoryOptions(
    kind: KindFilter,
    browserVar: string,
    variants: string[],
  ) {
    const options: any[] = [
      {
        value: 'all',
        title: 'All Results',
        selected: kind === 'all',
      },
      {
        value: 'tabs',
        title: 'Open Tabs',
        selected: kind === 'tabs',
      },
      {
        value: 'history',
        title: 'History',
        selected: kind === 'history',
      },
      {
        value: 'bookmarks',
        title: 'Bookmarks',
        selected: kind === 'bookmarks',
      },
    ];

    if (variants.length > 0) {
      const browserSubtitle =
        browserVar === 'all' ? 'All Browsers' : `${browserName(browserVar)} Only`;
      options.push({
        value: 'submenu:browser',
        title: 'Filter by Browser',
        subtitle: browserSubtitle,
        children: [
          {
            value: 'browser:all',
            title: 'All Browsers',
            selected: browserVar === 'all',
          },
          ...variants.map((v) => ({
            value: `browser:${v}`,
            title: `${browserName(v)} Only`,
            selected: browserVar.toLowerCase() === v.toLowerCase(),
          })),
        ],
      });
    }

    return options;
  }

  function computeButtonTitle(kind: KindFilter, browserVar: string): string {
    const kindTitles: Record<KindFilter, string> = {
      all: 'All Results',
      tabs: 'Open Tabs',
      history: 'History',
      bookmarks: 'Bookmarks',
    };
    const bTitle = browserVar === 'all' ? '' : browserName(browserVar);
    if (kind === 'all' && !bTitle) return 'All Results';
    if (kind === 'all' && bTitle) return `${bTitle} Only`;
    if (!bTitle) return kindTitles[kind];
    return `${kindTitles[kind]} · ${bTitle}`;
  }

  async function syncAccessory(): Promise<void> {
    if (!searchBarAccessory?.set) return;
    const options = buildAccessoryOptions(kindFilter, browserFilter, availableVariants);
    const buttonTitle = computeButtonTitle(kindFilter, browserFilter);
    await searchBarAccessory.set({
      options,
      buttonTitle,
    });
  }

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
        const paired = (await browser.listPairedBrowsers?.().catch(() => [])) ?? [];
        pairedCount = paired.length;

        // Dynamically discover installed and paired browsers on this machine
        const available = (await browser.listAvailableBrowsers?.().catch(() => [])) ?? [];
        const variants = new Set<string>();
        for (const p of paired) {
          if (p?.variant) variants.add(p.variant.toLowerCase());
        }
        for (const a of available) {
          if (a?.variant) variants.add(a.variant.toLowerCase());
        }
        availableVariants = Array.from(variants);
        await syncAccessory();
      } catch {
        pairedCount = 0;
      }
    })();

    window.addEventListener('message', handleMessage);

    const offAccessory = searchBarAccessory?.onChange((value: string) => {
      if (!value) return;
      if (value === 'all' || value === 'kind:all') {
        kindFilter = 'all';
      } else if (value === 'tabs' || value === 'kind:tabs') {
        kindFilter = 'tabs';
      } else if (value === 'history' || value === 'kind:history') {
        kindFilter = 'history';
      } else if (value === 'bookmarks' || value === 'kind:bookmarks') {
        kindFilter = 'bookmarks';
      } else if (value === 'browser:all') {
        browserFilter = 'all';
      } else if (value.startsWith('browser:')) {
        browserFilter = value.slice('browser:'.length);
      } else if (availableVariants.includes(value.toLowerCase())) {
        browserFilter = value.toLowerCase();
      }
      selected = 0;
      void syncAccessory();
    });

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
        shortcut: 'Enter',
        execute: async () => {
          await activate(rows[selected]);
        },
      },
      {
        id: `${EXTENSION_ID}:copy-title`,
        title: 'Copy Title',
        icon: 'T',
        category: 'Share',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+Alt+T',
        execute: async () => {
          const row = rows[selected];
          if (!row) {
            await feedback.showHUD('Nothing to copy');
            return;
          }
          await feedback.showHUD((await copyText(row.title)) ? 'Copied title' : 'Copy failed');
        },
      },
      {
        id: `${EXTENSION_ID}:copy-domain`,
        title: 'Copy Domain',
        icon: '🌐',
        category: 'Share',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+Alt+D',
        execute: async () => {
          const row = rows[selected];
          const url = urlOf(row);
          if (!url) {
            await feedback.showHUD('No URL to copy domain from');
            return;
          }
          try {
            const domain = new URL(url).hostname;
            await feedback.showHUD((await copyText(domain)) ? 'Copied domain' : 'Copy failed');
          } catch {
            await feedback.showHUD('Invalid URL');
          }
        },
      },
      {
        id: `${EXTENSION_ID}:fetch-tabs`,
        title: 'Fetch Tabs',
        icon: '🔄',
        category: 'Navigation',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+R',
        execute: async () => {
          await refresh(query);
          await feedback.showHUD('Tabs refreshed');
        },
      },
      {
        id: `${EXTENSION_ID}:close-tab`,
        title: 'Close Tab',
        icon: '✕',
        category: 'Destructive',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        destructive: true,
        shortcut: 'Ctrl+X',
        execute: async () => {
          const row = rows[selected];
          if (row?.kind !== 'tab') {
            await feedback.showHUD('Select a tab to close');
            return;
          }
          const tabId = row.tab.id;
          await browser.closeTab(tabId);
          await feedback.showHUD('Tab closed');
          rawRows = rawRows.filter((r) => !(r.kind === 'tab' && r.tab.id === tabId));
          selected = Math.min(selected, Math.max(rows.length - 1, 0));
          await refresh(query);
        },
      },
      {
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
        title: 'Open in New Window',
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
      {
        id: `${EXTENSION_ID}:select-browsers`,
        title: 'Select Browsers',
        icon: '✓',
        category: 'Filter',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+Shift+S',
        execute: async () => {
          if (availableVariants.length === 0) {
            await feedback.showHUD('No other browsers detected');
            return;
          }
          const filters = ['all', ...availableVariants];
          const currIdx = filters.indexOf(browserFilter.toLowerCase());
          const nextFilter = filters[(currIdx + 1) % filters.length];
          browserFilter = nextFilter;
          selected = 0;
          await syncAccessory();
          const filterName = nextFilter === 'all' ? 'All Browsers' : `${browserName(nextFilter)} Only`;
          await feedback.showHUD(`Filter: ${filterName}`);
        },
      },
    ];

    for (const action of viewActions) {
      actionsService.registerAction(action);
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      offAccessory?.();
      extensionManager?.setActiveViewActionLabel?.(null);
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
      <div class="row-icon-tile" aria-hidden="true">
        {#if faviconOf(row)}
          <img
            class="favicon-img"
            src={faviconOf(row)}
            alt=""
            loading="lazy"
            onerror={(e) => {
              const target = e.currentTarget as HTMLElement;
              target.style.display = 'none';
              const fallback = target.nextElementSibling as HTMLElement;
              if (fallback) fallback.style.display = 'flex';
            }}
          />
          <span class="fallback-icon" style="display: none;">
            <asyar-icon name={ICONS[row.kind]} size="16"></asyar-icon>
          </span>
        {:else}
          <span class="fallback-icon">
            <asyar-icon name={ICONS[row.kind]} size="16"></asyar-icon>
          </span>
        {/if}
      </div>
      <div class="row-content">
        <span class="row-title">{row.title}</span>
        {#if subtitleOf(row)}
          <span class="row-subtitle">{subtitleOf(row)}</span>
        {/if}
      </div>
      <div class="row-accessory-container">
        {#if row.kind === 'bookmark'}
          <span class="kind-badge">Bookmark</span>
        {:else if row.kind === 'history'}
          <span class="kind-badge">History</span>
        {/if}
        {#if isBrowserRow(row)}
          <span class="browser-pill">
            <span class="browser-pill-icon" aria-hidden="true">
              <asyar-icon name="globe" size="12"></asyar-icon>
            </span>
            <span class="browser-pill-text">{browserName(rowBrowserVariant(row))}</span>
          </span>
        {:else}
          <span class="row-accessory">⏎</span>
        {/if}
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
  }

  .row:focus-visible {
    outline: none;
  }

  /* 22px icon slot: crisp optical alignment for favicon or vector icon */
  .row-icon-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
  }

  .favicon-img {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: contain;
  }

  .fallback-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-tertiary);
  }

  .row.selected .fallback-icon {
    color: var(--text-primary);
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
    padding: 1px var(--space-1-5);
    border-radius: var(--radius-xs);
    background-color: var(--bg-tertiary);
    color: var(--text-tertiary);
    font-size: var(--font-size-2xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid var(--separator);
  }

  /* Raycast-style browser pill */
  .browser-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 22px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    background-color: var(--bg-tertiary);
    border: 1px solid var(--separator);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: 500;
    white-space: nowrap;
    line-height: 1;
  }

  .browser-pill-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
  }

  .row.selected .browser-pill {
    background-color: var(--bg-secondary);
    border-color: var(--border-color);
    color: var(--text-primary);
  }

  .row.selected .browser-pill-icon {
    color: var(--text-secondary);
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
