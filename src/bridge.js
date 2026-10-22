/*
 * bridge.js  —  ISOLATED-world content script
 *
 * The page/MAIN world has no access to chrome.runtime, so it can't resolve the
 * extension's own resource URLs. This tiny bridge runs in the ISOLATED world
 * (where chrome.* is available) and publishes the vendor base URL onto a shared
 * DOM attribute that the MAIN-world modules can read.
 *
 * We load the segmentation model's weights by fetching this URL. meet.google.com
 * sets no connect-src / default-src, so fetching chrome-extension:// resources
 * is permitted; and because all library JS ships as browser-injected content
 * scripts, we never inject a <script> at runtime (which the page's
 * strict-dynamic + Trusted Types CSP would block).
 */
(function () {
  "use strict";
  try {
    const base = chrome.runtime.getURL("vendor/");
    document.documentElement.dataset.tsVendorBase = base;
  } catch (e) {
    // Non-fatal: the extension falls back to full-frame mode.
    console.warn("[ThanosSnap] bridge could not publish vendor base", e);
  }
})();
