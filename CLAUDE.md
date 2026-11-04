# CLAUDE.md — TF Board Filter

Hand-off brief for Claude Code sessions working on this project. Read this
fully before making changes.

## What this is

A **Tampermonkey userscript** (not a Trello Power-Up) that gives UC Davis
Tech Foundry staff per-user control over their shared Trello operations
board ("UC Davis Tech Foundry Daily Operations", 15+ lists):

1. **Hide/show entire columns** — per user, per board. Hidden columns are
   fully removed from the layout (board reflows), unlike paid Trello's
   collapse-to-stub.
2. **Snooze** — hide a column for 4 hours; it returns automatically.
3. **Column colors** — faint tint + outline per column, with team-wide
   defaults keyed to staff names.

It exists because the Foundry is on **free Trello** (no native list
collapsing) and Power-Ups run in sandboxed iframes that cannot touch the
board DOM. A userscript can. It is part of the broader TF tooling suite
(TF-Plan, TF-Message, TF-Recharge, TF-MFG, TF-QMS Power-Ups) hosted at
tf-staff.github.io, but unlike those it is NOT a four-mode chassis HTML
file — it is a single injected script.

## Current state

**v1.2.1** (Nov 2026). All features above are live and in daily use by
the team. Version history:

- 1.0.0 — column hide/show panel, color tint/outline, per-board storage
- 1.1.0 — stronger tint (0.22) / 3px ring (0.95); panel persists until
  "Save & close" (click-outside close removed deliberately — it also
  masked a re-render bug where panel rebuilds made outside-click
  detection fire); open color palettes persist across re-renders
- 1.2.0 — Snooze (Zz) button, 4h timed hide with automatic return;
  "Show all" also wakes snoozes
- 1.2.1 — DEFAULT_COLORS roster expanded (Hayley pink, Robert red)

## Architecture

- **One file**: `tf-board-filter.user.js`. No build step, no dependencies,
  vanilla JS in a `'use strict'` IIFE. Keep it that way.
- **Storage**: `GM_getValue`/`GM_setValue`, one JSON blob per board under
  key `tfbf:<boardShortLink>` (shortLink parsed from `/b/<id>` in the URL).
  Schema: `{ hidden: [listName], colors: { listName: hex|null }, snoozed:
  { listName: epochMs } }`. `colors[name] = null` means "explicitly no
  color" and overrides a team default.
- **Lists are keyed by NAME, not list ID.** Renaming a list resets its
  prefs — accepted tradeoff on an ops board with stable names.
- **DOM anchors** (the most likely breakage point when Trello ships UI
  changes): `li[data-testid="list-wrapper"]`, `[data-testid="list-name"]`,
  `[data-testid="list"]`, each with legacy fallbacks (`.list-wrapper`,
  `.list-header-name`, `.list`). All DOM access funnels through three
  helpers: `getListWrappers()`, `getListName()`, `getListInner()` — fix
  selector breakage there and nowhere else.
- **Coloring technique**: `background-image: linear-gradient(tint, tint)`
  layers the tint OVER the list's own dark background without replacing
  it; ring is an inset `box-shadow`. Tuning knobs at top of file:
  `TINT_ALPHA` (0.22), `RING_ALPHA` (0.95), `RING_WIDTH` (3),
  `SNOOZE_MS` (4h).
- **Re-apply machinery**: MutationObserver on `document.body`
  (**childList only** — observing attributes would loop on our own inline
  style writes) with 250ms debounce; a 60s `setInterval(applyAll)` sweep
  so expired snoozes return on an idle board; an 800ms `location.href`
  poll for SPA board switches (Trello doesn't reload between boards).
- **Panel**: floating `#tfbf-fab` pill bottom-right with "N hidden" badge
  (counts hidden + snoozed); dark panel with per-list rows [eye toggle |
  name (+ "back h:mm" when snoozed) | Zz | color dot → swatch strip].
  Changes apply live; panel closes only via **Save & close** (or the
  fab). Do not reintroduce click-outside closing.
- **Team color defaults**: `DEFAULT_COLORS` at top of file, keyed by
  lowercase list name — steven #4BCE97 green, valerie #9F8FEF purple,
  tristan #FEA362 orange, hayley #E774BB pink, robert #F87168 red.
  Local user picks always beat defaults. **New staff member = one line
  here + version bump.**

## Deployment pipeline

- GitHub Pages serves this repo. Install/update URL (also the
  `@updateURL`/`@downloadURL` in the header):
  `https://tf-staff.github.io/tf-board-filter/tf-board-filter.user.js`
- **Push to `main` = deploy.** Allow a minute or two for Pages to publish.
- **Every functional change MUST bump `@version`** — Tampermonkey's
  auto-update only fires on a version increase. Staff pick it up within
  ~24h, or immediately via TM Dashboard → Utilities → Check for
  userscript updates. Also update the changelog comment block below the
  header.

## Environment / users

- ~5–7 staff, all on **Microsoft Edge** (Chromium), machines **managed by
  UC Davis org policy**. Tampermonkey 5.x requires the per-extension
  **"Allow user scripts"** toggle (in addition to global Developer mode);
  this was the install stumbling block. If org policy ever blocks
  userscripts outright, the fallback plan is repackaging as an unpacked
  MV3 extension (Load unpacked) — same content script, loses auto-update.
- Tampermonkey storage is per browser profile: prefs do **not** roam
  between a user's machines. A `chrome.storage.sync` variant was
  considered and traded away in favor of the userscript auto-update
  pipeline.

## Design language

Matches the TF suite: panel background `#1E1F24`, section lines
`#2C2D33`, borders `#3A3B42`, text `#E8E9ED`, muted `#8A8C94`, gold
accent `#E6A817` (fab hover, Save & close, snooze-active, "back at"
time). All injected styles live in one `<style id="tfbf-styles">` block;
every class is `tfbf-` prefixed. Prefer `data-testid` anchors over
Trello styling classes.

## Backlog (discussed with Steven, not yet built)

1. **Card cover display modes** — Full / Compact (~60px cropped banner)
   / Hidden, per user, probably per column. Must handle BOTH cover
   variants: top-banner covers and full-size covers (e.g. the yellow
   "Notes" cards, where the image is the whole card face — hiding leaves
   just the title, which is desired).
2. **Collapse-to-stub** middle ground (slim name-only column, like paid
   Trello's collapse) as a third visibility state.
3. **Per-column quick-hide button** injected into list headers, so
   common hides skip the panel.
4. **Snooze duration options** (1h / 4h / rest-of-day) — currently a
   single `SNOOZE_MS` constant.

## Known caveats

- Trello UI updates will periodically break selectors — historically the
  failure mode for all third-party Trello scripts. Fix in the three
  `getList*` helpers; keep fallback chains.
- Hidden/snoozed columns can't receive drag-and-drop; **Show all** is the
  universal escape hatch (unhides everything AND wakes all snoozes).
- No automated tests. Verify changes manually on the live board: pill
  renders; hide → reflow + badge; snooze → gold Zz + return time, and
  automatic return (temporarily shorten `SNOOZE_MS` to test); default +
  custom colors paint on first load; panel stays open through multiple
  changes; prefs survive a reload and a board switch.

## Working with Steven

Director of the Tech Foundry; deeply technical, iterates fast. Prefers
decisions-first communication and deliverables polished enough for
immediate professional use. Ship complete working versions, state what
changed and the deploy step, flag tradeoffs honestly and briefly.
