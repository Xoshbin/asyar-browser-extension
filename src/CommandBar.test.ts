// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/svelte';
import CommandBar from './CommandBar.svelte';

const chromeId = { family: 'chromium', variant: 'chrome', profileId: 'Default' };

function makeBrowser() {
  return {
    listTabs: vi.fn(async () => [
      { id: 't1', browser: chromeId, windowId: 'w', index: 0, title: 'React', url: 'https://react.dev', isActive: false, isPinned: false, isAudible: false },
    ]),
    searchHistory: vi.fn(async () => []),
    listBookmarks: vi.fn(async () => []),
    activateTab: vi.fn(async () => {}),
    closeTab: vi.fn(async () => {}),
    openUrl: vi.fn(async () => {}),
    searchWeb: vi.fn(async () => {}),
    getMostRecentActiveBrowser: vi.fn(async () => ({ family: 'chromium', variant: 'chrome' })),
    listPairedBrowsers: vi.fn(async () => [{ family: 'chromium', variant: 'chrome' }]),
  };
}
function makeContext(browser: any) {
  const prefs = { getAll: vi.fn(async () => ({ extension: { openTarget: 'most-recent' }, commands: {} })) };
  // Stable singletons so registerAction calls are observable after render
  const actions = { registerAction: vi.fn(), unregisterAction: vi.fn() };
  const feedback = { showHUD: vi.fn(async () => {}) };
  return {
    getService: (name: string) => {
      if (name === 'browser') return browser;
      if (name === 'preferences') return prefs;
      if (name === 'actions') return actions;
      if (name === 'feedback') return feedback;
      return undefined;
    },
  } as any;
}

function getAction(ctx: any, id: string) {
  const actions = ctx.getService('actions');
  const call = actions.registerAction.mock.calls.find((c: any[]) => c[0].id === id);
  return call?.[0];
}
function postToView(payload: any) {
  const ev = new MessageEvent('message', { data: payload });
  Object.defineProperty(ev, 'source', { value: window.parent, configurable: true });
  window.dispatchEvent(ev);
}
beforeEach(() => cleanup());

describe('CommandBar', () => {
  it('fetches + renders blended rows when a query arrives', async () => {
    const browser = makeBrowser();
    render(CommandBar, { props: { context: makeContext(browser) } });
    await waitFor(() => expect(browser.listTabs).toHaveBeenCalled());
    postToView({ type: 'asyar:view:search', payload: { query: 'react' } });
    await waitFor(() => expect(browser.listTabs).toHaveBeenCalledWith({ query: 'react' }));
    expect(browser.searchHistory).toHaveBeenCalledWith('react', { limit: 8 });
    expect(browser.listBookmarks).toHaveBeenCalledWith({ query: 'react' });
    await screen.findByText('React');
    await screen.findByText('Search the web for "react"');
  });

  it('shows Asyar Companion install guidance when no browser is paired', async () => {
    const browser = makeBrowser();
    browser.listTabs = vi.fn(async () => []);
    browser.searchHistory = vi.fn(async () => []);
    browser.listBookmarks = vi.fn(async () => []);
    browser.listPairedBrowsers = vi.fn(async () => []);
    render(CommandBar, { props: { context: makeContext(browser) } });
    await screen.findByText(/Asyar Companion/i);
    await screen.findByText(/Settings → Browsers/i);
  });

  it('does not show companion guidance once a browser is paired', async () => {
    const browser = makeBrowser();
    render(CommandBar, { props: { context: makeContext(browser) } });
    await screen.findByText('React');
    expect(screen.queryByText(/Asyar Companion/i)).toBeNull();
  });

  it('Enter on the focused tab row activates that tab', async () => {
    const browser = makeBrowser();
    render(CommandBar, { props: { context: makeContext(browser) } });
    await screen.findByText('React');          // initial empty-query render; tab is row 0
    postToView({ type: 'asyar:view:keydown', payload: { key: 'Enter' } });
    await waitFor(() => expect(browser.activateTab).toHaveBeenCalledWith('t1'));
  });

  it('Enter on the search row runs a web search with the resolved target', async () => {
    const browser = makeBrowser();
    render(CommandBar, { props: { context: makeContext(browser) } });
    postToView({ type: 'asyar:view:search', payload: { query: 'hello world' } });
    await screen.findByText('Search the web for "hello world"');   // rows: [tab, search]; selected reset to 0
    postToView({ type: 'asyar:view:keydown', payload: { key: 'ArrowDown' } }); // → search row
    postToView({ type: 'asyar:view:keydown', payload: { key: 'Enter' } });
    await waitFor(() => expect(browser.searchWeb).toHaveBeenCalledWith('hello world', chromeId));
  });

  it('ignores messages from non-parent sources', async () => {
    const browser = makeBrowser();
    render(CommandBar, { props: { context: makeContext(browser) } });
    await screen.findByText('React');
    const ev = new MessageEvent('message', { data: { type: 'asyar:view:keydown', payload: { key: 'Enter' } } });
    // source defaults to null ≠ window.parent → must be dropped
    window.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 50));
    expect(browser.activateTab).not.toHaveBeenCalled();
  });

  describe('EXTENSION_VIEW actions', () => {
    it('registers close-tab action that closes the selected tab and refreshes', async () => {
      const browser = makeBrowser();
      const ctx = makeContext(browser);
      render(CommandBar, { props: { context: ctx } });
      await screen.findByText('React'); // tab row 0 is selected
      const action = getAction(ctx, 'org.asyar.browser:close-tab');
      expect(action).toBeDefined();
      expect(action.context).toBe('extension_view');
      expect(action.destructive).toBe(true);
      const callsBefore = browser.listTabs.mock.calls.length;
      await action.execute();
      expect(browser.closeTab).toHaveBeenCalledWith('t1');
      expect(browser.listTabs.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('registers copy-url action that writes the selected tab URL to clipboard', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn(async () => {}) },
        configurable: true,
      });
      const browser = makeBrowser();
      const ctx = makeContext(browser);
      render(CommandBar, { props: { context: ctx } });
      await screen.findByText('React');
      const action = getAction(ctx, 'org.asyar.browser:copy-url');
      expect(action).toBeDefined();
      await action.execute();
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://react.dev');
    });

    it('registers open-new-window action that opens the selected tab URL in a new window', async () => {
      const browser = makeBrowser();
      const ctx = makeContext(browser);
      render(CommandBar, { props: { context: ctx } });
      await screen.findByText('React');
      const action = getAction(ctx, 'org.asyar.browser:open-new-window');
      expect(action).toBeDefined();
      await action.execute();
      expect(browser.openUrl).toHaveBeenCalledWith(
        'https://react.dev',
        { browser: { family: 'chromium', variant: 'chrome', profileId: 'Default' }, newWindow: true },
      );
    });
  });
});
