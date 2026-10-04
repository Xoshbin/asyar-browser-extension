// ───────────────────────────────────────────────────────────────────────────
// worker.ts — Tier 2 Browser extension worker entry, loaded by dist/worker.html.
//
// Owns: search aggregation (tabs + bookmarks + history), the `open-url`
// background command, and the SDK bootstrap ceremony.
//
// Imports come from `asyar-sdk/worker` (role assertion + worker-only
// ExtensionContext class) and `asyar-sdk/contracts` (pure types). The /worker
// entry asserts `window.__ASYAR_ROLE__ === "worker"` at module load time;
// the Rust `asyar-extension://` scheme handler injects that global into
// `worker.html` at serve time (see `uri_schemes.rs`).
// ───────────────────────────────────────────────────────────────────────────

import { ExtensionContext as WorkerExtensionContext, extensionBridge } from 'asyar-sdk/worker';
import type {
  Extension,
  ExtensionContext,
  BrowserId,
  CommandExecuteArgs,
  ExtensionResult,
  IActionService,
  IBrowserService,
  ILogService,
} from 'asyar-sdk/contracts';

import manifest from '../manifest.json';
import { aggregateSearch } from './search';
import { isUrlLike, normaliseUrl } from './url';

const extensionId = manifest.id;

const workerContext = new WorkerExtensionContext();
workerContext.setExtensionId(extensionId);

const log = workerContext.getService<ILogService>('log');
const browser = workerContext.getService<IBrowserService>('browser');
const actions = workerContext.getService<IActionService>('actions');

// The Extension interface's `initialize(ctx)` expects the contracts-flavored
// ExtensionContext, which is a sibling (not a supertype) of the worker-
// flavored class we construct at module scope. Since this worker owns its
// own context lexically, the `initialize` hook is a no-op — services are
// already wired via `workerContext` above.
class BrowserWorkerExtension implements Extension {
  async initialize(_ctx: ExtensionContext): Promise<void> {}

  async activate(): Promise<void> {
    actions.registerActionHandler('activate-tab', async (payload) => {
      const { tabId } = (payload ?? {}) as { tabId?: string };
      if (tabId) await browser.activateTab(tabId);
    });
    actions.registerActionHandler('open-url', async (payload) => {
      const { url, browser: target } = (payload ?? {}) as {
        url?: string;
        browser?: BrowserId;
      };
      if (url) await browser.openUrl(url, target ? { browser: target } : undefined);
    });
    log.info(`[${extensionId}] worker activated`);
  }

  async deactivate(): Promise<void> {}

  async search(query: string): Promise<ExtensionResult[]> {
    try {
      return await aggregateSearch(query, browser);
    } catch (err) {
      log.warn(
        `[${extensionId}] search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  async executeCommand(commandId: string, args?: CommandExecuteArgs): Promise<unknown> {
    if (commandId !== 'open-url') {
      log.warn(`[${extensionId}] unknown command: ${commandId}`);
      return undefined;
    }
    const userArgs = (args?.arguments ?? {}) as Record<string, unknown>;
    const raw = String(userArgs.url ?? '').trim();
    if (!raw) {
      log.warn(`[${extensionId}] open-url called with empty url`);
      return undefined;
    }
    if (!isUrlLike(raw)) {
      log.warn(`[${extensionId}] open-url called with non-URL: ${raw}`);
      return undefined;
    }
    const url = normaliseUrl(raw);
    try {
      // The browser bridge opens the URL in a connected companion. If no
      // companion is connected the bridge call may reject — we log it. No
      // opener SDK service is exposed to Tier 2 workers, so there is no
      // OS-default fallback from inside the worker in v1.
      await browser.openUrl(url, undefined);
    } catch (err) {
      log.warn(
        `[${extensionId}] open-url failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return undefined;
  }

  onUnload = (): void => {};
}

const browserExtension = new BrowserWorkerExtension();

extensionBridge.registerManifest(
  manifest as Parameters<typeof extensionBridge.registerManifest>[0],
);
extensionBridge.registerExtensionImplementation(extensionId, browserExtension);

void (async () => {
  try {
    await browserExtension.activate();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[${extensionId}] worker activate failed: ${msg}`);
  }
})();
