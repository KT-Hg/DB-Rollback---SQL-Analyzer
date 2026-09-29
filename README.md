# DB Rollback & SQL Analyzer

A Chrome extension (Manifest V3) with two testing tools, taken out of
[Pocket QA](../Pocket%20QA) so they can be installed on their own:

- **DB Test Session & Rollback** — records every change you make to a database through **Adminer**, and rolls
  the whole session back with SQL you review before it runs.
- **SQL Test Case Designer** — paste a SQL query, get a numbered test case list (EP/BVA, decision table, NULL
  3-valued logic, JOIN/GROUP BY/ORDER-LIMIT) with fixture rows and verification SQL, exported as CSV or JSON.

Same UI as Pocket QA: the popup is built on its popup (status bar, cards, guide modal) and both full pages
are its pages, in the same light/dark theme.

## Installation

1. Open `chrome://extensions`, switch on **Developer mode**.
2. **Load unpacked** → pick this folder.
3. Pin the extension; the ↺ database icon opens the popup.

Chrome 109 or later.

## The popup

| Part | What it does |
|---|---|
| Status bar | What the Adminer integration is doing on the tab you opened the popup over: green — panel on; pulsing red — a session is recording; red — panel switched off; amber — Pocket QA's panel has that tab (see below); grey — not an Adminer page. 🌙/☀️ switches the theme for the popup, both pages and the Adminer panel. |
| DB Test Session card | The session recording now (or the last one), one click from its page; **Test sessions & rollback** opens the manager page; **Adminer panel** switches the integration off and on, on open Adminer tabs too. |
| SQL Test Case Designer card | **Analyze a SQL query** opens the designer. |
| **?** on each card | The guide for that tool, Vietnamese or English. |

## DB Test Session & Rollback (Adminer)

Open any Adminer page and a small panel appears bottom-right. **▶ Start session**, change data as usual —
edit form, grid, mass edit, the SQL page — then **↺ Roll back all** (or **↺ Undo last**, <kbd>Alt</kbd>+
<kbd>Shift</kbd>+<kbd>Z</kbd>). Every rollback opens a preview with the exact SQL first, and re-reads each row
before overwriting it, so a row someone else changed after you is shown to you instead of being overwritten.
**↷ Re-apply** puts rolled-back changes back. The manager page (`dbtools.html`) lists every session and change,
with per-column before/after, per-change undo/redo, and `.sql` / `.json` export.

It is a changeset kept by the extension, not a transaction — Adminer opens a new connection per request.
Rollback always runs inside the Adminer tab (a request from the extension's own origin would not carry Adminer's
session cookie); nothing leaves the browser.

The full description — what is recorded where, what is refused and why, drift handling — is the
*DB Test Session & Rollback* section of Pocket QA's README; the design notes are in
[`docs/adminer-rollback-plan.md`](docs/adminer-rollback-plan.md).

### Installed next to Pocket QA

Pocket QA carries the same Adminer integration. Two copies on one page would each hold every form submit and
each send it again — an `INSERT` saved twice — so this extension **gives way**: while Pocket QA's panel
(`#frp-dbtools-panel`) is on the page, this one shows no panel and records nothing, and it takes over by itself as
soon as that panel goes. To use this one, untick **Adminer panel** on Pocket QA's DB Test Session card (or
disable Pocket QA). The popup's status bar turns amber while it is giving way, and the manager page says so if
you ask it to roll back through such a tab.

The two extensions keep separate storage: sessions recorded in one are not visible in the other.

## SQL Test Case Designer

`sqlcases.html` — tokenising, parsing and generation all run locally in the page. `SELECT` (joins, `WHERE`,
`GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`/`OFFSET`, `UNION`, CTEs, `CASE`) plus `INSERT`, `UPDATE`, `DELETE`;
MySQL, SQL Server and ANSI quoting, and `?` / `:name` / `@name` / `$1` parameters. Vietnamese by default,
English via 🌐. Compare mode diffs two versions of a query on the parsed tree and sorts the cases into
*changed*, *unrelated* and *stale*. The full description is the *SQL Test Case Designer* section of
Pocket QA's README.

## Layout

```
manifest.json         MV3 manifest — tabs, storage, downloads; http(s) hosts for the Adminer content script
background.js         service worker: snapshot IndexedDB (snapstore.js) + "open the manager page on session X"
popup.html            popup markup
popup/popup.js        popup bootstrap: page buttons, session line, Adminer switch, tab status, guide modal
popup/guides.js       the ? guides, VI + EN
popup/theme.js        light/dark (`popupTheme` in storage — read by every page and the Adminer panel)
css/popup.css         the popup's share of Pocket QA's popup.css
dbtools.html          Test sessions & rollback page          (+ css/dbtools.css)
dbtools/              Adminer integration: boot.js (content script) → content-main.js, panel, capture,
                      undo generation, rollback, manager page
sqlcases.html         SQL Test Case Designer page            (+ css/sqlcases.css)
sqlcases/             tokenizer, parser, analysis, techniques, generation, export, UI
icons/                16 / 32 / 48 / 128 (+ 1024 for a store listing)
docs/                 design notes for the rollback feature
```

## Differences from the copy in Pocket QA

`dbtools/`, `sqlcases/`, both pages and their CSS were copied verbatim; only these were changed, so a fix made
there can be carried over with a plain diff:

| File | Change |
|---|---|
| `dbtools/content-main.js` | Gives way to Pocket QA's panel (`watchOtherCopy`); ping reports `yielded`; resubmit marker renamed |
| `dbtools/manager.js` | Says why a yielded tab cannot run a rollback; the Playback-guard settings are never shown (there is no Playback here) |
| `dbtools/i18n.js` | `mgr.otherExtension` (VI + EN) |
| `dbtools/panel.js` | Panel host `#dbx-dbtools-panel` and `dbxDbtools*` localStorage keys, so the two panels never replace or share state with each other |
| `dbtools/boot.js`, `dbtools/snapstore.js` | Boot flag, log prefix and IndexedDB name |
| `dbtools/e2e/run.mjs` | Selectors follow the renamed panel host |
| `sqlcases/export.js` | `generator` field in the JSON export |

Not carried over: `bg/dbguard.js` (the Playback guard) — this extension has no Playback to wrap.

## Tests

```bash
node dbtools/selftest.mjs      # undo generation, quoting, predicates, catalogs — no dependencies
node sqlcases/selftest.mjs     # parser, analysis, techniques, diff, export, catalogs
bash dbtools/e2e/setup.sh      # then, in another terminal:
node dbtools/e2e/run.mjs       # the extension against a real Adminer over a real database (needs playwright + php)
```
