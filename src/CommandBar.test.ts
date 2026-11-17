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
    listAvailableBrowsers: vi.fn(async () => []),
  };
}
function makeContext(browser: any) {
  const prefs = { getAll: vi.fn(async () => ({ extension: { openTarget: 'most-recent' }, commands: {} })) };
  // Stable singletons so registerAction calls are observable after render
  const actions = { registerAction: vi.fn(), unregisterAction: vi.fn() };
  const feedback = { showHUD: vi.fn(async () => {}) };
  const extensions = { setActiveViewActionLabel: vi.fn() };
  return {
    getService: (name: string) => {
      if (name === 'browser') return browser;
      if (name === 'preferences') return prefs;
      if (name === 'actions') return actions;
      if (name === 'feedback') return feedback;
      if (name === 'extensions') return extensions;
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

    it('registers copy-title action that writes the title to clipboard', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn(async () => {}) },
        configurable: true,
      });
      const browser = makeBrowser();
      const ctx = makeContext(browser);
      render(CommandBar, { props: { context: ctx } });
      await screen.findByText('React');
      const action = getAction(ctx, 'org.asyar.browser:copy-title');
      expect(action).toBeDefined();
      await action.execute();
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('React');
    });

    it('registers copy-domain action that writes the domain to clipboard', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn(async () => {}) },
        configurable: true,
      });
      const browser = makeBrowser();
      const ctx = makeContext(browser);
      render(CommandBar, { props: { context: ctx } });
      await screen.findByText('React');
      const action = getAction(ctx, 'org.asyar.browser:copy-domain');
      expect(action).toBeDefined();
      await action.execute();
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('react.dev');
    });

    it('registers fetch-tabs action that refreshes tabs', async () => {
      const browser = makeBrowser();
      const ctx = makeContext(browser);
      render(CommandBar, { props: { context: ctx } });
      await screen.findByText('React');
      const action = getAction(ctx, 'org.asyar.browser:fetch-tabs');
      expect(action).toBeDefined();
      const callsBefore = browser.listTabs.mock.calls.length;
      await action.execute();
      expect(browser.listTabs.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('registers select-browsers action that cycles through detected browsers', async () => {
      const browser = makeBrowser();
      browser.listPairedBrowsers = vi.fn(async () => [
        { family: 'chromium', variant: 'brave' },
      ]);
      const ctx = makeContext(browser);
      const setMock = vi.fn(async () => {});
      const searchBarAccessory = {
        onChange: vi.fn(() => () => {}),
        set: setMock,
      };
      render(CommandBar, { props: { context: ctx, searchBarAccessory } });
      await screen.findByText('React');
      await waitFor(() => expect(setMock).toHaveBeenCalled());
      const action = getAction(ctx, 'org.asyar.browser:select-browsers');
      expect(action).toBeDefined();
      expect(action.shortcut).toBe('Mod+Shift+S');
      await action.execute();
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          buttonTitle: 'Brave Only',
        }),
      );
    });
  });

  describe('Dynamic Multistep SearchBarAccessory and filtering', () => {
    it('builds multistep accessory with result types and Filter by Browser submenu', async () => {
      const browser = makeBrowser();
      browser.listPairedBrowsers = vi.fn(async () => [
        { family: 'chromium', variant: 'brave' },
        { family: 'chromium', variant: 'chrome' },
      ]);
      const setMock = vi.fn(async () => {});
      const searchBarAccessory = {
        onChange: vi.fn(() => () => {}),
        set: setMock,
      };
      render(CommandBar, { props: { context: makeContext(browser), searchBarAccessory } });
      await waitFor(() => expect(setMock).toHaveBeenCalled());
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          buttonTitle: 'All Results',
          options: expect.arrayContaining([
            expect.objectContaining({ value: 'all', title: 'All Results' }),
            expect.objectContaining({ value: 'tabs', title: 'Open Tabs' }),
            expect.objectContaining({ value: 'history', title: 'History' }),
            expect.objectContaining({ value: 'bookmarks', title: 'Bookmarks' }),
            expect.objectContaining({
              value: 'submenu:browser',
              title: 'Filter by Browser',
              children: expect.arrayContaining([
                expect.objectContaining({ value: 'browser:all', title: 'All Browsers' }),
                expect.objectContaining({ value: 'browser:brave', title: 'Brave Only' }),
                expect.objectContaining({ value: 'browser:chrome', title: 'Chrome Only' }),
              ]),
            }),
          ]),
        }),
      );
    });

    it('filters rows by result type and browser simultaneously', async () => {
      const browser = makeBrowser();
      const braveId = { family: 'chromium', variant: 'brave', profileId: 'Default' };
      browser.listTabs = vi.fn(async () => [
        { id: 't1', browser: chromeId, windowId: 'w', index: 0, title: 'Chrome Tab', url: 'https://chrome.dev', isActive: false, isPinned: false, isAudible: false },
        { id: 't2', browser: braveId, windowId: 'w', index: 1, title: 'Brave Tab', url: 'https://brave.dev', isActive: false, isPinned: false, isAudible: false },
      ]);
      browser.searchHistory = vi.fn(async () => [
        { url: 'https://brave.com/history', title: 'Brave History', browser: braveId, lastVisitAt: 100, visitCount: 1 },
      ]);
      let changeCallback: (v: string) => void = () => {};
      const searchBarAccessory = {
        onChange: vi.fn((cb: (v: string) => void) => {
          changeCallback = cb;
          return () => {};
        }),
        set: vi.fn(async () => {}),
      };

      render(CommandBar, { props: { context: makeContext(browser), searchBarAccessory } });
      await screen.findByText('Chrome Tab');
      await screen.findByText('Brave Tab');
      await screen.findByText('Brave History');

      // 1. Filter by tabs only
      changeCallback('tabs');
      await waitFor(() => {
        expect(screen.queryByText('Brave History')).toBeNull();
        expect(screen.getByText('Chrome Tab')).toBeDefined();
        expect(screen.getByText('Brave Tab')).toBeDefined();
      });

      // 2. Further filter by brave browser
      changeCallback('browser:brave');
      await waitFor(() => {
        expect(screen.queryByText('Chrome Tab')).toBeNull();
        expect(screen.queryByText('Brave History')).toBeNull();
        expect(screen.getByText('Brave Tab')).toBeDefined();
      });
    });

    it('updates active view action label to Open in <Browser>', async () => {
      const browser = makeBrowser();
      const ctx = makeContext(browser);
      const extensions = ctx.getService('extensions');
      render(CommandBar, { props: { context: ctx } });
      await screen.findByText('React');
      await waitFor(() => {
        expect(extensions.setActiveViewActionLabel).toHaveBeenCalledWith('Open in Chrome');
      });
    });
  });
});
