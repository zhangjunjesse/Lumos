/**
 * Browser-tab preload — runs in every Lumos built-in browser tab
 * (user-opened, AI-driven via chrome-devtools MCP, workflow agent,
 * DeepSearch background pages). Loaded by BrowserManager.createView().
 *
 * Single responsibility: inject a `chrome.runtime` stub into the page's
 * main world so anti-bot vendors (Akamai on etsy.com, Cloudflare bot
 * fight) don't flag us as automation.
 *
 * Why this is needed: real Chrome — even with zero extensions installed —
 * always exposes `window.chrome.runtime` as an object. Electron's
 * WebContentsView leaves `chrome.runtime` undefined. Akamai's sensor JS
 * runs `if (window.chrome && !window.chrome.runtime)` and flags any hit
 * as a bot. Patching this single tell makes Lumos's browser look like a
 * stock Chrome with no extensions.
 *
 * Scope: this file is intentionally minimal. It is NOT a stealth
 * framework. We do not patch webdriver, plugins, canvas/audio/webgl,
 * permissions, or any other fingerprint surface. If a site detects us
 * past `chrome.runtime`, that is out of scope — the right answer there
 * is "Lumos's built-in browser is not a tool for hardened anti-bot
 * sites." We patch one canonical Electron tell, no more.
 */

import { webFrame } from 'electron';

// Runs in main world before any page script. The IIFE keeps locals out
// of the page's global scope. We only define what's missing — never
// overwrite if the page (or another preload) has already set it up.
const stealthScript = `
(() => {
  try {
    if (typeof window.chrome !== 'object' || window.chrome === null) {
      Object.defineProperty(window, 'chrome', {
        value: {},
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    if (window.chrome && !window.chrome.runtime) {
      const noopListener = Object.freeze({
        addListener: () => {},
        removeListener: () => {},
        hasListener: () => false,
      });
      Object.defineProperty(window.chrome, 'runtime', {
        value: {
          // No extension is loaded, so id is intentionally undefined —
          // matches stock Chrome with no extensions installed.
          id: undefined,
          connect: () => ({
            name: '',
            disconnect: () => {},
            postMessage: () => {},
            onDisconnect: noopListener,
            onMessage: noopListener,
          }),
          sendMessage: () => {},
          getManifest: () => undefined,
          getURL: (path) => path,
          onConnect: noopListener,
          onMessage: noopListener,
          onInstalled: noopListener,
          onStartup: noopListener,
        },
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
  } catch {
    // Page CSP or another preload already locked window.chrome —
    // bail silently rather than spamming the console.
  }
})();
`;

webFrame.executeJavaScript(stealthScript).catch(() => {
  // Some chrome:// / devtools:// frames refuse executeJavaScript.
  // Failure is non-fatal — those frames don't load anti-bot sites.
});
