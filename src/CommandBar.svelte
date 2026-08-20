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

  function urlOf(row: Row): string | undefined {
    if (row.kind === 'tab') return row.tab.url;
    if (row.kind === 'search') return undefined;
    return row.url;
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
        id: `${EXTENSION_ID}:close-tab`,
        title: 'Close Tab',
        icon: '✕',
        category: 'Destructive',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        destructive: true,
        execute: async () => {
          const row = rows[selected];
          if (row?.kind === 'tab') {
            await browser.closeTab(row.tab.id);
            await feedback.showHUD('Tab closed');
            await refresh(query);
          } else {
            await feedback.showHUD('Select a tab to close');
          }
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
          // Try the modern API first; fall back to execCommand for
          // sandboxed iframe contexts where the Permissions API denies
          // clipboard access.
          let ok = false;
          try {
            await navigator.clipboard.writeText(url);
            ok = true;
          } catch { /* try fallback */ }
          if (!ok) {
            try {
              const ta = document.createElement('textarea');
              ta.value = url;
              ta.setAttribute('readonly', '');
              ta.style.position = 'fixed';
              ta.style.opacity = '0';
              document.body.appendChild(ta);
              ta.select();
              ok = document.execCommand('copy');
              ta.remove();
            } catch { /* give up */ }
          }
          await feedback.showHUD(ok ? 'Copied URL' : 'Copy failed');
        },
      },
      {
        id: `${EXTENSION_ID}:open-new-window`,
        title: 'Open in New Window',
        icon: '🪟',
        category: 'Navigation',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          const url = urlOf(rows[selected]);
          if (url) {
            const target = await resolveTarget();
            await browser.openUrl(url, target ? { browser: target, newWindow: true } : { newWindow: true });
          } else {
            await feedback.showHUD('Nothing to open');
          }
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

  const ICONS: Record<Row['kind'], string> = {
    tab: '🌐',
    bookmark: '🔖',
    history: '🕘',
    search: '🔍',
    url: '🔗',
  };
</script>

<div class="command-bar" role="listbox" tabindex="0">
  {#each rows as row, i (row.kind + ':' + i)}
    <button
      class="row"
      class:selected={i === selected}
      role="option"
      aria-selected={i === selected}
      onclick={() => activate(row)}
      onmouseenter={() => (selected = i)}
    >
      <span class="icon">{ICONS[row.kind]}</span>
      <span class="title">{row.title}</span>
      {#if subtitleOf(row)}<span class="subtitle">{subtitleOf(row)}</span>{/if}
    </button>
  {/each}

  {#if rows.length === 0 && pairedCount === 0}
    <div class="companion-cta">
      <span class="cta-icon">🧩</span>
      <p class="cta-title">Connect your browser</p>
      <p class="cta-body">
        This extension works together with the <strong>Asyar Companion</strong> browser
        extension. Install the companion in your browser, then approve it from
        <strong>Settings → Browsers</strong> to search your tabs, bookmarks, and history here.
      </p>
    </div>
  {/if}
</div>

<style>
  .command-bar {
    display: flex;
    flex-direction: column;
    padding: var(--space-2);
    outline: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: none;
    text-align: left;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font: inherit;
    width: 100%;
  }
  .row.selected {
    background: var(--bg-selected);
  }
  .icon {
    font-size: var(--font-size-base);
  }
  .title {
    flex: 1;
    color: var(--text-primary);
  }
  .subtitle {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }
  .companion-cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-2);
    padding: var(--space-7) var(--space-5);
  }
  .cta-icon {
    font-size: var(--font-size-xl);
  }
  .cta-title {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--font-size-base);
    font-weight: 600;
  }
  .cta-body {
    margin: 0;
    max-width: 32ch;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }
</style>
