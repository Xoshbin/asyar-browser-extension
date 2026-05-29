// view.ts — minimal Tier 2 view entry, loaded by dist/view.html.
//
// asyar-browser has no `mode: "view"` command, so this iframe is never
// navigated to and renders no UI. It exists only to satisfy Asyar's two-iframe
// Tier 2 model and the build/attach tooling, which expect a `dist/view.html`.
// All real work happens in the worker (search aggregation + open-url command).
//
// Imports come exclusively from `asyar-sdk/view`, which asserts
// `window.__ASYAR_ROLE__ === "view"` at module-load time.

import {
  ExtensionContext,
  extensionBridge,
  type Extension,
} from 'asyar-sdk/view';
import manifest from '../manifest.json';

class BrowserViewExtension implements Extension {
  async initialize(_ctx: ExtensionContext): Promise<void> {}
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async executeCommand(
    _commandId: string,
    _args?: Record<string, unknown>,
  ): Promise<unknown> {
    return undefined;
  }
  onUnload = (): void => {};
}

const extensionId =
  window.location.hostname === 'localhost' ||
  window.location.hostname === 'asyar-extension.localhost'
    ? window.location.pathname.split('/').filter(Boolean)[0] || 'org.asyar.browser'
    : window.location.hostname || 'org.asyar.browser';

const context = new ExtensionContext();
context.setExtensionId(extensionId);

const viewExtension = new BrowserViewExtension();
extensionBridge.registerManifest(
  manifest as Parameters<typeof extensionBridge.registerManifest>[0],
);
extensionBridge.registerExtensionImplementation(extensionId, viewExtension);

// Mirror the sibling extensions' view boot ceremony. Both calls are no-ops
// here (this view never renders), but driving them keeps the lifecycle
// protocol consistent with the worker and the other Tier 2 extensions.
void (async () => {
  await viewExtension.initialize(context);
  await viewExtension.activate();
})();
