/**
 * popup.js — Popup bootstrap.
 *
 * The pieces of Pocket QA's popup (popup/init.js and the guide
 * modal from popup/main.js) that the two cards here need, plus one of its own:
 * the status bar says what the Adminer integration is doing on the tab the
 * popup was opened over.
 */

import { initTheme } from './theme.js';
import { CARD_HELP_DATA, CARD_HELP_LABELS } from './guides.js';

const SETTINGS_KEY = 'dbtoolsSettings';
const SESSIONS_KEY = 'dbtoolsSessions';
const ACTIVE_KEY = 'dbtoolsActive';

const FOCUS_DELAY_MS = 50;      // wait for modal DOM to paint before focusing
const TAB_REPING_MS = 400;      // an Adminer tab switches itself on/off from storage

const $ = (id) => document.getElementById(id);

/* === Full pages ═══════════════════════════════════════════════════════════ */

/**
 * Wire a button that opens one of the extension's full pages in its own tab.
 *
 * Both pages are tables too wide for a 480px popup. An already-open instance is
 * focused instead of duplicated — each page keeps state in storage (the unsaved
 * query text, the changeset being reviewed), and a second tab would silently
 * compete with the first over the same key.
 */
function initPageButton(buttonId, page) {
  const btn = $(buttonId);
  if (!btn) return;
  const url = chrome.runtime.getURL(page);
  btn.addEventListener('click', () => {
    // Matched without the query or hash: a page opened on one session
    // (`dbtools.html?session=…`) is still the page, and a second copy of it is
    // not what the button is for.
    chrome.tabs.query({}, (tabs) => {
      const existing = (tabs || []).find((t) => t.url && t.url.split(/[?#]/)[0] === url);
      if (existing) {
        chrome.tabs.update(existing.id, { active: true });
        chrome.windows.update(existing.windowId, { focused: true });
      } else {
        chrome.tabs.create({ url });
      }
      window.close();
    });
  });
}

/* === DB Test Session card ═════════════════════════════════════════════════ */

/**
 * The card's status line: the session recording right now (or the one last
 * used, when none is), with a click through to it on the manager page. Kept
 * live while the popup is open — ending a session in the Adminer tab next to it
 * shows up here straight away.
 */
function initDbStatus() {
  const line = $('dbStatus');
  if (!line) return;
  const KEYS = [SESSIONS_KEY, ACTIVE_KEY, SETTINGS_KEY];
  let target = '';

  const paint = (res) => {
    const sessions = Object.values(res[SESSIONS_KEY] || {});
    const active = res[ACTIVE_KEY] || {};
    const off = (res[SETTINGS_KEY] || {}).enabled === false;
    const recording = sessions.filter((s) => !s.closedAt && active[s.key] === s.id)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const latest = [...sessions].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
    const shown = recording[0] || latest;
    if (off) {
      line.hidden = true;
      target = '';
      return;
    }
    line.hidden = false;
    if (!shown) {
      // Nothing recorded yet: say where sessions come from rather than show
      // nothing — an empty card reads as broken.
      target = '';
      line.classList.remove('rec');
      line.classList.add('empty');
      line.textContent = 'No test session yet — start one from the panel in an Adminer tab';
      line.title = '';
      return;
    }
    target = shown.id;
    const n = (shown.changes || []).length;
    const rec = Boolean(recording[0]);
    line.classList.remove('empty');
    line.classList.toggle('rec', rec);
    line.replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.className = 'label';
    const lead = document.createElement('span');
    lead.textContent = rec ? 'Recording: ' : 'Last session: ';
    const name = document.createElement('b');
    name.textContent = shown.name;
    label.append(lead, name);
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = `${n} change${n === 1 ? '' : 's'}`
      + (rec && recording.length > 1 ? ` · +${recording.length - 1} more` : '')
      + (rec ? '' : ' · ended');
    line.append(dot, label, sub);
    line.title = 'Open this session on the Test sessions & rollback page';
  };

  chrome.storage.local.get(KEYS, paint);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEYS.some((k) => changes[k])) chrome.storage.local.get(KEYS, paint);
  });
  line.addEventListener('click', () => {
    if (!target) return;
    // The background reuses an open manager tab rather than opening another.
    chrome.runtime.sendMessage({ type: 'dbtools-open-manager', sessionId: target }, () => {
      void chrome.runtime.lastError;
      window.close();
    });
  });
}

/**
 * The master switch: off, the panel disappears from the Adminer tabs that are
 * already open and nothing is recorded — an Adminer tab watches this setting,
 * so it needs no page reload.
 */
function initDbEnabledToggle() {
  const enabled = $('dbEnabledToggle');
  if (!enabled) return;

  // Stored settings written before this switch existed have no `enabled` key,
  // and the integration was on for them.
  chrome.storage.local.get([SETTINGS_KEY], (res) => {
    enabled.checked = (res[SETTINGS_KEY] || {}).enabled !== false;
  });

  enabled.addEventListener('change', () => {
    chrome.storage.local.get([SETTINGS_KEY], (res) => {
      chrome.storage.local.set({ [SETTINGS_KEY]: { ...(res[SETTINGS_KEY] || {}), enabled: enabled.checked } });
    });
  });
}

/* === Status bar: this tab ═════════════════════════════════════════════════ */

/**
 * What the Adminer integration is doing on the tab the popup was opened over.
 *
 * Asked of the tab itself: the content script only loads on a page that looks
 * like Adminer, so no answer means "not Adminer", and the answer says whether
 * the panel is on, switched off, or standing aside for Pocket QA's
 * copy of it (dbtools/content-main.js, watchOtherCopy).
 */
function initTabStatus() {
  const dot = $('statusDot');
  const label = $('tabStatus');
  if (!dot || !label) return;

  const paint = (state, lead, detail = '', title = '') => {
    dot.className = `status-dot${state ? ` ${state}` : ''}`;
    label.replaceChildren();
    const b = document.createElement('b');
    b.textContent = lead;
    label.append(b);
    if (detail) label.append(` · ${detail}`);
    label.title = title || label.textContent;
  };

  const check = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    if (!tab || !/^https?:/i.test(tab.url || '')) {
      paint('', 'No Adminer on this tab');
      return;
    }
    const ping = await chrome.tabs.sendMessage(tab.id, { type: 'dbtools-ping' }, { frameId: 0 })
      .catch(() => null);
    if (!ping || !ping.ok) {
      paint('', 'No Adminer on this tab');
      return;
    }
    if (ping.yielded) {
      paint('warn', 'Adminer', 'Pocket QA\'s panel has this tab',
        'Pocket QA shows its own Adminer panel here, so this one stays out of the way. '
        + 'Turn off "Adminer panel" in Pocket QA\'s popup to use this one.');
      return;
    }
    if (!ping.on) {
      paint('inactive', 'Adminer', 'panel switched off');
      return;
    }
    const res = await chrome.storage.local.get([SESSIONS_KEY, ACTIVE_KEY]);
    const id = (res[ACTIVE_KEY] || {})[ping.key];
    const session = id && (res[SESSIONS_KEY] || {})[id];
    if (session && !session.closedAt) {
      paint('recording', 'Adminer', `recording "${session.name}"`);
    } else {
      paint('active', 'Adminer', 'panel on, no session recording');
    }
  };

  const run = () => check().catch(() => paint('', 'No Adminer on this tab'));
  run();
  let timer = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes[SETTINGS_KEY] || changes[SESSIONS_KEY] || changes[ACTIVE_KEY])) return;
    clearTimeout(timer);
    timer = setTimeout(run, TAB_REPING_MS);
  });
}

/* === Guide modal ══════════════════════════════════════════════════════════ */

let scrollLocked = false;
let savedScrollY = 0;

function lockScroll() {
  if (scrollLocked) return;
  scrollLocked = true;
  savedScrollY = document.body.scrollTop || window.scrollY || 0;
  document.body.classList.add('modal-open');
  document.documentElement.style.overflow = 'hidden';
}

function unlockScroll() {
  if (!scrollLocked) return;
  scrollLocked = false;
  document.body.classList.remove('modal-open');
  document.documentElement.style.overflow = '';
  document.body.scrollTop = savedScrollY;
}

function focusableIn(container) {
  return Array.from(container.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
}

function openModal(modal, firstFocusSelector) {
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  lockScroll();
  const target = firstFocusSelector ? modal.querySelector(firstFocusSelector) : focusableIn(modal)[0];
  setTimeout(() => target?.focus(), FOCUS_DELAY_MS);
}

function closeModal(modal, returnFocusEl) {
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  unlockScroll();
  returnFocusEl?.focus();
}

/** Escape closes; Tab and Shift+Tab stay inside the dialog. */
function trapKeys(modal, closeFn) {
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeFn(); return; }
    if (e.key !== 'Tab') return;
    const focusable = focusableIn(modal);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  });
}

function initCardHelp() {
  const modal = $('cardHelpModal');
  if (!modal) return;
  let lang = 'en';
  let key = null;
  let opener = null;

  const render = () => {
    const data = CARD_HELP_DATA[key];
    if (!data) return;
    const isVi = lang === 'vi';
    $('cardHelpTitle').textContent = data.title[lang];
    $('cardHelpLangToggle').textContent = isVi ? 'EN' : 'VI';
    $('cardHelpClose').textContent = isVi ? '✕ Đóng' : '✕ Close';
    $('cardHelpBody').innerHTML = data[lang];
  };
  const close = () => closeModal(modal, opener);

  document.querySelectorAll('.card-help-btn').forEach((btn) => {
    const cardKey = btn.dataset.card;
    btn.setAttribute('aria-label', CARD_HELP_LABELS[cardKey] || `Open ${cardKey} help`);
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!CARD_HELP_DATA[cardKey]) return;
      opener = btn;
      key = cardKey;
      chrome.storage.local.get('cardHelpLang', ({ cardHelpLang }) => {
        lang = cardHelpLang || 'en';
        render();
      });
      openModal(modal, '#cardHelpClose');
    });
  });

  trapKeys(modal, close);
  $('cardHelpLangToggle').addEventListener('click', () => {
    lang = lang === 'vi' ? 'en' : 'vi';
    chrome.storage.local.set({ cardHelpLang: lang });
    render();
  });
  $('cardHelpClose').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });
}

function initVersion() {
  const el = $('version');
  if (el) el.textContent = `v${chrome.runtime.getManifest().version}`;
}

/* === Boot ═════════════════════════════════════════════════════════════════ */

/**
 * Run one bootstrap step, isolated: a throw in one — a renamed element id is
 * enough — costs only that step, and says so, instead of leaving the rest of
 * the popup dead with nothing pointing at the cause.
 */
function step(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`[POPUP] ${name}() failed — the rest of the popup still loads:`, err);
  }
}

step('initTheme',           initTheme);
step('initDbPage',          () => initPageButton('openDbTools', 'dbtools.html'));
step('initSqlPage',         () => initPageButton('openSqlCases', 'sqlcases.html'));
step('initDbStatus',        initDbStatus);
step('initDbEnabledToggle', initDbEnabledToggle);
step('initTabStatus',       initTabStatus);
step('initCardHelp',        initCardHelp);
step('initVersion',         initVersion);
