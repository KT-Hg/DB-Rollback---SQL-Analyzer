/**
 * background.js — Service Worker (ES module entry point).
 *
 * Almost nothing happens here. The Adminer integration runs in its own content
 * script and its own page (dbtools/), the SQL Test Case Designer is a page that
 * needs no worker at all (sqlcases/), and the popup only reads storage and opens
 * those pages. What is left for the worker:
 *   - owning the IndexedDB that table snapshots are kept in (snapstore.js);
 *   - bringing the Test sessions page forward when the Adminer panel asks.
 */

import { serveSnapshots } from './dbtools/snapstore.js';

// DB Test Session snapshots live in this origin's IndexedDB; the Adminer panel is
// a content script and reads and writes them through here.
serveSnapshots();

/* === Test sessions page ═════════════════════════════════════════════════════
 * "View" on the panel, a recorded line clicked in its log, or the session line
 * in the popup. An open manager tab is brought forward and pointed at the session
 * (and change) through its hash — a new tab on every press left a test run with
 * half a dozen copies of the page. The hash carries a timestamp so pressing it
 * again for the same session still lands, after the page has been moved on to
 * another one by hand.
 * ═══════════════════════════════════════════════════════════════════════════ */

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type !== "DBTOOLS_OPEN_MANAGER" && request?.type !== "dbtools-open-manager") return;
  const base = chrome.runtime.getURL("dbtools.html");
  const target = [
    request.sessionId ? `session=${encodeURIComponent(request.sessionId)}` : "",
    request.changeId ? `change=${encodeURIComponent(request.changeId)}` : "",
  ].filter(Boolean).join("&");
  const done = () => { void chrome.runtime.lastError; sendResponse({ ok: true }); };

  chrome.tabs.query({}, (tabs) => {
    void chrome.runtime.lastError;
    const existing = (tabs || []).find((t) => t.url && t.url.split(/[?#]/)[0] === base);
    if (!existing) {
      chrome.tabs.create({ url: target ? `${base}?${target}` : base }, done);
      return;
    }
    const update = { active: true };
    if (target) update.url = `${existing.url.split("#")[0]}#${target}&at=${Date.now()}`;
    chrome.tabs.update(existing.id, update, () => {
      chrome.windows.update(existing.windowId, { focused: true }, done);
    });
  });
  return true;
});
