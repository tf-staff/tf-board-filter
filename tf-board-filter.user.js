// ==UserScript==
// @name         TF Board Filter
// @namespace    https://tf-staff.github.io/
// @version      1.3.1
// @description  Tech Foundry: per-user column hiding, column colors, and wide card view for Trello boards
// @author       Tech Foundry
// @match        https://trello.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// @updateURL    https://tf-staff.github.io/tf-board-filter/tf-board-filter.user.js
// @downloadURL  https://tf-staff.github.io/tf-board-filter/tf-board-filter.user.js
// ==/UserScript==

/*
 * TF BOARD FILTER v1.3.1
 * Changelog:
 *   1.3.1 — TF-Filter button now works while a card is open (it used to
 *           close the card). Button renamed "TF-Filter"; panel header
 *           shows "TF Filter, Version x.y.z".
 *   1.3.0 — "Wide card view" toggle (Columns panel → Card view). Widens
 *           the open card to nearly full screen; the description side
 *           keeps its width and Comments and activity gets the extra
 *           room. Global per-user setting, off by default.
 *   1.2.1 — DEFAULT_COLORS roster expanded (Hayley pink, Robert red).
 *   1.2.0 — per-column Snooze (Zz): hides a column for 4 hours, then it
 *           returns automatically. Snoozes survive restarts.
 * ----------------------------------------------------------------------
 * What it does:
 *   1. Hide/show entire lists (columns), per user, per board.
 *   2. Apply a faint color tint + outline to lists, per user, per board.
 *   3. Optional wide card view: more room for Comments and activity.
 *
 * All preferences live in Tampermonkey storage in each person's browser
 * profile — nothing is written to Trello, and no one else's view changes.
 *
 * DEFAULT_COLORS below ships team-wide staff colors. Anyone can override
 * or clear them locally from the panel.
 * ----------------------------------------------------------------------
 */

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------

  // Team defaults, keyed by list name (case-insensitive).
  // Ships to everyone via auto-update; local choices override these.
  const DEFAULT_COLORS = {
    'steven': '#4BCE97',   // green
    'valerie': '#9F8FEF',  // purple
    'tristan': '#FEA362',  // orange
    'hayley': '#E774BB',   // pink
    'robert': '#F87168',   // red
  };

  const PALETTE = [
    { label: 'Green',   hex: '#4BCE97' },
    { label: 'Orange',  hex: '#FEA362' },
    { label: 'Purple',  hex: '#9F8FEF' },
    { label: 'Blue',    hex: '#579DFF' },
    { label: 'Red',     hex: '#F87168' },
    { label: 'Yellow',  hex: '#F5CD47' },
    { label: 'Teal',    hex: '#6CC3E0' },
    { label: 'Magenta', hex: '#E774BB' },
    { label: 'Gray',    hex: '#8590A2' },
  ];

  const TINT_ALPHA = 0.22;    // background tint strength
  const RING_ALPHA = 0.95;    // outline strength
  const RING_WIDTH = 3;       // outline thickness in px
  const SNOOZE_MS = 4 * 60 * 60 * 1000;  // snooze duration: 4 hours
  const WIDE_CARD_MAX = 1800; // wide card view: max card width in px
  const WIDE_CARD_GUTTER = 48; // wide card view: total side margin in px

  // ------------------------------------------------------------------
  // Storage (per board, per browser profile)
  // ------------------------------------------------------------------

  function getBoardId() {
    const m = location.pathname.match(/^\/b\/([^/]+)/);
    return m ? m[1] : null;
  }

  function loadState(boardId) {
    try {
      const raw = GM_getValue('tfbf:' + boardId, null);
      if (raw) {
        const s = JSON.parse(raw);
        return {
          hidden: Array.isArray(s.hidden) ? s.hidden : [],
          colors: s.colors && typeof s.colors === 'object' ? s.colors : {},
          snoozed: s.snoozed && typeof s.snoozed === 'object' ? s.snoozed : {},
        };
      }
    } catch (e) { /* corrupted state — fall through to fresh */ }
    return { hidden: [], colors: {}, snoozed: {} };
  }

  function saveState(boardId, state) {
    GM_setValue('tfbf:' + boardId, JSON.stringify(state));
  }

  // Global (not per-board) preferences
  function loadPrefs() {
    try {
      const raw = GM_getValue('tfbf:global', null);
      if (raw) {
        const p = JSON.parse(raw);
        return { wideCard: !!p.wideCard };
      }
    } catch (e) { /* corrupted — fall through to defaults */ }
    return { wideCard: false };
  }

  function savePrefs(prefs) {
    GM_setValue('tfbf:global', JSON.stringify(prefs));
  }

  // ------------------------------------------------------------------
  // Trello DOM helpers (with fallbacks for UI changes)
  // ------------------------------------------------------------------

  function getListWrappers() {
    let wrappers = document.querySelectorAll('li[data-testid="list-wrapper"]');
    if (!wrappers.length) wrappers = document.querySelectorAll('.list-wrapper, .js-list');
    return Array.from(wrappers);
  }

  function getListName(wrapper) {
    const el =
      wrapper.querySelector('[data-testid="list-name"]') ||
      wrapper.querySelector('h2') ||
      wrapper.querySelector('.list-header-name');
    if (!el) return null;
    const text = (el.value !== undefined && el.value !== '') ? el.value : el.textContent;
    const name = (text || '').trim();
    return name.length ? name : null;
  }

  function getListInner(wrapper) {
    return (
      wrapper.querySelector('[data-testid="list"]') ||
      wrapper.querySelector('.list') ||
      wrapper.firstElementChild
    );
  }

  // ------------------------------------------------------------------
  // Card back helpers (wide card view). Trello's card dialog has no
  // stable test ids for its two columns, so these locate the layout by
  // the "Comments and activity" heading, falling back to geometry.
  // Fix card-back selector breakage here and nowhere else.
  // ------------------------------------------------------------------

  function getCardDialog() {
    const anchor = document.querySelector(
      '[data-testid="card-back-name"], [data-testid="card-back-title-input"], ' +
      '#card-back-name, .card-detail-window'
    );
    let dlg = anchor && (anchor.closest('[role="dialog"]') || anchor.closest('.card-detail-window'));
    if (!dlg && /^\/c\//.test(location.pathname)) {
      // Card URL but no known anchor: take the largest visible dialog
      let best = null, bestArea = 0;
      document.querySelectorAll('[role="dialog"]').forEach((d) => {
        const r = d.getBoundingClientRect();
        if (r.width * r.height > bestArea) { bestArea = r.width * r.height; best = d; }
      });
      dlg = best;
    }
    return dlg || null;
  }

  // Returns { split, main, comments } — the container holding the two
  // side-by-side card columns, the left (main) column and the right
  // (comments/activity) column — or null if the layout isn't found.
  function findCardColumns(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => /^\s*(comments and activity|activity)\s*$/i.test(n.nodeValue)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    const text = walker.nextNode();
    if (text && text.parentElement) {
      const hit = climbToColumns(text.parentElement, root);
      if (hit) return hit;
    }
    // Geometry fallback: first container with two tall side-by-side kids
    const queue = [root];
    let visited = 0;
    while (queue.length && visited < 400) {
      const el = queue.shift();
      visited++;
      const hit = sideBySide(el);
      if (hit) return hit;
      queue.push(...el.children);
    }
    return null;
  }

  function climbToColumns(el, root) {
    let cur = el;
    while (cur && cur !== document.body) {
      const parent = cur.parentElement;
      if (!parent) break;
      const rc = cur.getBoundingClientRect();
      for (const sib of parent.children) {
        if (sib === cur) continue;
        const rs = sib.getBoundingClientRect();
        if (rs.width > 200 && rs.right <= rc.left + 2 &&
            rs.bottom > rc.top && rs.top < rc.bottom) {
          return { split: parent, main: sib, comments: cur };
        }
      }
      if (cur === root) break;
      cur = parent;
    }
    return null;
  }

  function sideBySide(container) {
    const kids = Array.from(container.children)
      .map((k) => ({ k, r: k.getBoundingClientRect() }))
      .filter((o) => o.r.width > 200 && o.r.height > 150)
      .sort((a, b) => a.r.left - b.r.left);
    if (kids.length < 2) return null;
    const m = kids[kids.length - 2], c = kids[kids.length - 1];
    if (c.r.left < m.r.right - 2) return null; // stacked, not columns
    return { split: container, main: m.k, comments: c.k };
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function colorForList(name, state) {
    if (Object.prototype.hasOwnProperty.call(state.colors, name)) {
      return state.colors[name]; // may be null = explicitly no color
    }
    return DEFAULT_COLORS[name.toLowerCase()] || null;
  }

  // ------------------------------------------------------------------
  // Apply visibility + colors to the board
  // ------------------------------------------------------------------

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // Wide card view. All styling lives in CSS gated on html.tfbf-wide, so
  // toggling off is just removing that class. Elements are tagged with
  // data-tfbf-* attributes (React leaves unknown attributes alone).
  function applyWideCard() {
    const on = loadPrefs().wideCard;
    document.documentElement.classList.toggle('tfbf-wide', on);
    if (!on) return;

    const tagged = ['[data-tfbf-shell]', '[data-tfbf-split]',
      '[data-tfbf-col="main"]', '[data-tfbf-col="comments"]']
      .every((sel) => document.querySelector(sel));
    if (tagged) return; // already laid out; nothing re-rendered

    const dlg = getCardDialog();
    if (!dlg) return;
    const cols = findCardColumns(dlg);
    if (!cols) return;
    const { split, main, comments } = cols;

    // Shell = outermost ancestor still narrower than the viewport (the
    // visible card box); its parent is the full-screen overlay.
    const vw = document.documentElement.clientWidth;
    let shell = split;
    while (shell.parentElement && shell.parentElement !== document.body &&
           shell.parentElement.getBoundingClientRect().width < vw - 40) {
      shell = shell.parentElement;
    }

    // Pin the main column at its natural width (measured before widening)
    if (!shell.dataset.tfbfMainW) {
      shell.dataset.tfbfMainW = String(Math.round(main.getBoundingClientRect().width));
    }
    shell.style.setProperty('--tfbf-main-w', shell.dataset.tfbfMainW + 'px');
    shell.setAttribute('data-tfbf-shell', '');

    // Anything between shell and columns that doesn't fill its parent
    // (max-width caps etc.) gets stretched, top-down.
    const chain = [];
    for (let el = split; el && el !== shell; el = el.parentElement) chain.unshift(el);
    chain.forEach((el) => {
      const parent = el.parentElement;
      const cs = getComputedStyle(parent);
      const inner = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const hasSideSibling = Array.from(parent.children).some((sib) => {
        if (sib === el) return false;
        const a = sib.getBoundingClientRect(), b = el.getBoundingClientRect();
        return a.width > 0 && a.bottom > b.top && a.top < b.bottom;
      });
      if (!hasSideSibling && el.getBoundingClientRect().width < inner - 4) {
        el.setAttribute('data-tfbf-fill', '');
      }
    });

    const gridCols = getComputedStyle(split).gridTemplateColumns;
    split.setAttribute('data-tfbf-split',
      getComputedStyle(split).display.includes('grid') && gridCols.split(' ').length === 2
        ? 'grid' : 'flex');
    main.setAttribute('data-tfbf-col', 'main');
    comments.setAttribute('data-tfbf-col', 'comments');

    // If the card was positioned with a fixed left offset, widening can
    // push it off-screen — recenter in that case only.
    const r = shell.getBoundingClientRect();
    if (r.left < 0 || r.right > vw + 1) {
      const pos = getComputedStyle(shell).position;
      shell.setAttribute('data-tfbf-recenter',
        pos === 'absolute' || pos === 'fixed' ? 'pos' : 'margin');
    }
  }

  function applyAll() {
    applyWideCard();
    const boardId = getBoardId();
    if (!boardId) { updateFabBadge(0); return; }
    const state = loadState(boardId);
    const now = Date.now();
    let hiddenCount = 0;

    // Purge expired snoozes — the column simply returns
    let expired = false;
    Object.keys(state.snoozed).forEach((k) => {
      if (state.snoozed[k] <= now) { delete state.snoozed[k]; expired = true; }
    });
    if (expired) {
      saveState(boardId, state);
      if (panel && panel.classList.contains('tfbf-open')) renderPanel();
    }

    getListWrappers().forEach((wrapper) => {
      const name = getListName(wrapper);
      if (!name) return; // skip list composer / unnamed elements

      // Visibility (permanent hide OR active snooze)
      const isSnoozed = state.snoozed[name] && state.snoozed[name] > now;
      if (state.hidden.includes(name) || isSnoozed) {
        wrapper.style.display = 'none';
        hiddenCount++;
      } else if (wrapper.style.display === 'none') {
        wrapper.style.display = '';
      }

      // Color
      const inner = getListInner(wrapper);
      if (!inner) return;
      const color = colorForList(name, state);
      if (color) {
        const tint = hexToRgba(color, TINT_ALPHA);
        // background-image layers the tint OVER the list's own dark
        // background without replacing it
        inner.style.backgroundImage = `linear-gradient(${tint}, ${tint})`;
        inner.style.boxShadow = `inset 0 0 0 ${RING_WIDTH}px ${hexToRgba(color, RING_ALPHA)}`;
      } else {
        inner.style.backgroundImage = '';
        inner.style.boxShadow = '';
      }
    });

    updateFabBadge(hiddenCount);
  }

  // ------------------------------------------------------------------
  // UI — floating button + panel
  // ------------------------------------------------------------------

  const CSS = `
    #tfbf-fab {
      position: fixed; bottom: 18px; right: 18px; z-index: 2147483000;
      display: flex; align-items: center; gap: 8px;
      background: #1E1F24; color: #E8E9ED;
      border: 1px solid #3A3B42; border-radius: 999px;
      padding: 9px 16px; cursor: pointer;
      font: 600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.45);
      transition: border-color .15s ease;
    }
    #tfbf-fab:hover { border-color: #E6A817; }
    #tfbf-fab .tfbf-badge {
      background: #E6A817; color: #17181C; border-radius: 999px;
      padding: 2px 7px; font-size: 11px; font-weight: 700;
    }
    #tfbf-panel {
      position: fixed; bottom: 66px; right: 18px; z-index: 2147483000;
      width: 320px; max-height: 70vh; overflow-y: auto;
      background: #1E1F24; color: #E8E9ED;
      border: 1px solid #3A3B42; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.55);
      font: 400 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      display: none;
    }
    #tfbf-panel.tfbf-open { display: block; }
    .tfbf-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px; border-bottom: 1px solid #2C2D33;
      position: sticky; top: 0; background: #1E1F24; border-radius: 12px 12px 0 0;
    }
    .tfbf-head strong { font-size: 13px; letter-spacing: .02em; }
    .tfbf-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 14px; border-bottom: 1px solid #26272C;
    }
    .tfbf-row:last-of-type { border-bottom: none; }
    .tfbf-name {
      flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .tfbf-name.tfbf-dim { color: #6A6C74; text-decoration: line-through; }
    .tfbf-until {
      color: #E6A817; font-size: 11px; text-decoration: none;
      display: inline-block; margin-left: 2px;
    }
    .tfbf-snooze {
      flex: none; border-radius: 6px; padding: 3px 7px;
      border: 1px solid #3A3B42; background: transparent; color: #8A8C94;
      font: 700 10px/1 system-ui, sans-serif; cursor: pointer;
      transition: border-color .15s ease, color .15s ease;
    }
    .tfbf-snooze:hover { border-color: #E6A817; color: #E8E9ED; }
    .tfbf-snooze.tfbf-zzz {
      background: #E6A817; border-color: #E6A817; color: #17181C;
    }
    .tfbf-eye {
      width: 34px; height: 20px; border-radius: 999px; border: none;
      cursor: pointer; position: relative; flex: none;
      background: #3A3B42; transition: background .15s ease;
    }
    .tfbf-eye::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 16px; height: 16px; border-radius: 50%;
      background: #8A8C94; transition: transform .15s ease, background .15s ease;
    }
    .tfbf-eye.tfbf-on { background: #2E4B3A; }
    .tfbf-eye.tfbf-on::after { transform: translateX(14px); background: #4BCE97; }
    .tfbf-dot {
      width: 18px; height: 18px; border-radius: 50%; flex: none;
      border: 2px solid #3A3B42; cursor: pointer; background: transparent;
    }
    .tfbf-swatches {
      display: none; flex-wrap: wrap; gap: 6px;
      padding: 8px 14px 10px 58px; border-bottom: 1px solid #26272C;
      background: #191A1E;
    }
    .tfbf-swatches.tfbf-open { display: flex; }
    .tfbf-swatch {
      width: 20px; height: 20px; border-radius: 50%;
      border: 2px solid transparent; cursor: pointer;
    }
    .tfbf-swatch:hover { border-color: #E8E9ED; }
    .tfbf-swatch.tfbf-none {
      background: transparent; border: 2px solid #3A3B42; position: relative;
    }
    .tfbf-swatch.tfbf-none::after {
      content: ''; position: absolute; left: 2px; right: 2px; top: 50%;
      height: 2px; background: #F87168; transform: rotate(-45deg);
    }
    .tfbf-foot {
      display: flex; gap: 8px; padding: 10px 14px;
      position: sticky; bottom: 0; background: #1E1F24;
      border-top: 1px solid #2C2D33; border-radius: 0 0 12px 12px;
    }
    .tfbf-foot button {
      flex: 1; background: #2C2D33; color: #E8E9ED; border: none;
      border-radius: 8px; padding: 7px 0; cursor: pointer;
      font: 600 12px system-ui, sans-serif;
    }
    .tfbf-foot button:hover { background: #3A3B42; }
    .tfbf-foot button.tfbf-save {
      flex: 1.4; background: #E6A817; color: #17181C; font-weight: 700;
    }
    .tfbf-foot button.tfbf-save:hover { background: #F5BC2F; }
    .tfbf-empty { padding: 16px 14px; color: #8A8C94; }
    .tfbf-section {
      padding: 10px 14px 4px; color: #8A8C94; font-size: 10px;
      font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
    }
    .tfbf-opt { border-bottom: 1px solid #2C2D33; padding-bottom: 10px; }
    .tfbf-opt .tfbf-name small { display: block; color: #8A8C94; font-size: 11px; }

    /* Wide card view — gated on html.tfbf-wide */
    html.tfbf-wide [data-tfbf-shell] {
      width: min(calc(100vw - ${WIDE_CARD_GUTTER}px), ${WIDE_CARD_MAX}px) !important;
      max-width: none !important;
    }
    html.tfbf-wide [data-tfbf-recenter="margin"] {
      margin-left: auto !important; margin-right: auto !important;
    }
    html.tfbf-wide [data-tfbf-recenter="pos"] {
      left: calc((100vw - min(calc(100vw - ${WIDE_CARD_GUTTER}px), ${WIDE_CARD_MAX}px)) / 2) !important;
      right: auto !important; margin-left: 0 !important; margin-right: 0 !important;
      transform: none !important;
    }
    html.tfbf-wide [data-tfbf-fill] { width: 100% !important; max-width: none !important; }
    html.tfbf-wide [data-tfbf-split="grid"] {
      grid-template-columns: var(--tfbf-main-w) minmax(0, 1fr) !important;
    }
    html.tfbf-wide [data-tfbf-col="main"] {
      flex: 0 0 var(--tfbf-main-w) !important;
      width: var(--tfbf-main-w) !important; max-width: var(--tfbf-main-w) !important;
    }
    html.tfbf-wide [data-tfbf-col="comments"] {
      flex: 1 1 0 !important; width: auto !important;
      max-width: none !important; min-width: 0 !important;
    }
  `;

  const SCRIPT_VERSION =
    (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '?';

  let fab = null;
  let panel = null;

  // Click handling for our UI. Trello closes an open card on any
  // pointer/click outside it, so we swallow those events for our fab and
  // panel in the window CAPTURE phase (registered at document-start, so
  // ahead of Trello's listeners) and dispatch our handlers ourselves.
  function onClick(el, fn) { el._tfbfClick = fn; }

  function isOurUi(target) {
    return target instanceof Element && !!target.closest('#tfbf-fab, #tfbf-panel');
  }

  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart', 'touchend', 'click']
    .forEach((type) => {
      window.addEventListener(type, (e) => {
        if (!isOurUi(e.target)) return;
        e.stopImmediatePropagation();
        // Keep focus where it is (inside the card) — focus moving out of
        // the card dialog can also close it.
        if (type === 'mousedown' || type === 'pointerdown') e.preventDefault();
        if (type === 'click') {
          let el = e.target;
          while (el && !el._tfbfClick && el !== document.documentElement) el = el.parentElement;
          if (el && el._tfbfClick) el._tfbfClick(e);
        }
      }, true);
    });
  const openStrips = new Set(); // list names with expanded color palettes

  function injectStyles() {
    if (document.getElementById('tfbf-styles')) return;
    const style = document.createElement('style');
    style.id = 'tfbf-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function updateFabBadge(hiddenCount) {
    if (!fab) return;
    const badge = fab.querySelector('.tfbf-badge');
    if (hiddenCount > 0) {
      badge.style.display = '';
      badge.textContent = hiddenCount + ' hidden';
    } else {
      badge.style.display = 'none';
    }
  }

  function buildFab() {
    if (document.getElementById('tfbf-fab')) return;
    fab = document.createElement('button');
    fab.id = 'tfbf-fab';
    fab.innerHTML = '<span>TF-Filter</span><span class="tfbf-badge" style="display:none"></span>';
    onClick(fab, () => {
      if (panel.classList.contains('tfbf-open')) {
        panel.classList.remove('tfbf-open');
      } else {
        renderPanel();
        panel.classList.add('tfbf-open');
      }
    });
    document.body.appendChild(fab);

    panel = document.createElement('div');
    panel.id = 'tfbf-panel';
    document.body.appendChild(panel);
    // Note: no click-outside close. The panel stays open through any
    // number of changes and closes only via Save & close (or the fab).
  }

  function renderPanel() {
    const boardId = getBoardId();
    panel.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'tfbf-head';
    const strong = document.createElement('strong');
    strong.textContent = 'TF Filter, Version ' + SCRIPT_VERSION;
    head.appendChild(strong);
    panel.appendChild(head);

    // Card view options (global, work on any board)
    const cardSec = document.createElement('div');
    cardSec.className = 'tfbf-section';
    cardSec.textContent = 'Card view';
    panel.appendChild(cardSec);

    const prefs = loadPrefs();
    const wideRow = document.createElement('div');
    wideRow.className = 'tfbf-row tfbf-opt';
    const wideSw = document.createElement('button');
    wideSw.className = 'tfbf-eye' + (prefs.wideCard ? ' tfbf-on' : '');
    wideSw.title = prefs.wideCard ? 'Turn off wide card view' : 'Turn on wide card view';
    onClick(wideSw, () => {
      const p = loadPrefs();
      p.wideCard = !p.wideCard;
      savePrefs(p);
      applyWideCard();
      renderPanel();
    });
    wideRow.appendChild(wideSw);
    const wideLabel = document.createElement('span');
    wideLabel.className = 'tfbf-name';
    wideLabel.innerHTML = 'Wide card view<small>More room for comments and activity</small>';
    wideRow.appendChild(wideLabel);
    panel.appendChild(wideRow);

    const colSec = document.createElement('div');
    colSec.className = 'tfbf-section';
    colSec.textContent = 'Columns';
    panel.appendChild(colSec);

    if (!boardId) {
      const empty = document.createElement('div');
      empty.className = 'tfbf-empty';
      empty.textContent = 'Open a board to manage its columns.';
      panel.appendChild(empty);
      return;
    }

    const state = loadState(boardId);
    const wrappers = getListWrappers();
    const seen = new Set();

    if (!wrappers.length) {
      const empty = document.createElement('div');
      empty.className = 'tfbf-empty';
      empty.textContent = 'No lists found yet — try reopening once the board loads.';
      panel.appendChild(empty);
      return;
    }

    wrappers.forEach((wrapper) => {
      const name = getListName(wrapper);
      if (!name || seen.has(name)) return;
      seen.add(name);

      const isHidden = state.hidden.includes(name);
      const snoozeUntil = state.snoozed[name];
      const isSnoozed = !!(snoozeUntil && snoozeUntil > Date.now());
      const color = colorForList(name, state);

      const row = document.createElement('div');
      row.className = 'tfbf-row';

      // Visibility toggle
      const eye = document.createElement('button');
      eye.className = 'tfbf-eye' + (isHidden ? '' : ' tfbf-on');
      eye.title = isHidden ? 'Show this column' : 'Hide this column';
      onClick(eye, () => {
        const s = loadState(boardId);
        const idx = s.hidden.indexOf(name);
        if (idx >= 0) s.hidden.splice(idx, 1);
        else s.hidden.push(name);
        saveState(boardId, s);
        applyAll();
        renderPanel();
      });
      row.appendChild(eye);

      // Name (with snooze return time when applicable)
      const label = document.createElement('span');
      label.className = 'tfbf-name' + (isHidden || isSnoozed ? ' tfbf-dim' : '');
      label.textContent = name;
      if (isSnoozed && !isHidden) {
        const until = document.createElement('span');
        until.className = 'tfbf-until';
        until.textContent = ' · back ' + fmtTime(snoozeUntil);
        label.appendChild(until);
      }
      row.appendChild(label);

      // Snooze button — hide for 4 hours / wake now
      const snooze = document.createElement('button');
      snooze.className = 'tfbf-snooze' + (isSnoozed ? ' tfbf-zzz' : '');
      snooze.textContent = 'Zz';
      snooze.title = isSnoozed
        ? 'Snoozed until ' + fmtTime(snoozeUntil) + ' — click to wake now'
        : 'Snooze: hide this column for 4 hours';
      onClick(snooze, () => {
        const s = loadState(boardId);
        if (s.snoozed[name] && s.snoozed[name] > Date.now()) {
          delete s.snoozed[name]; // wake now
        } else {
          s.snoozed[name] = Date.now() + SNOOZE_MS;
        }
        saveState(boardId, s);
        applyAll();
        renderPanel();
      });
      row.appendChild(snooze);

      // Color dot → toggles swatch strip
      const dot = document.createElement('button');
      dot.className = 'tfbf-dot';
      dot.title = 'Column color';
      if (color) {
        dot.style.background = color;
        dot.style.borderColor = color;
      }
      row.appendChild(dot);
      panel.appendChild(row);

      const strip = document.createElement('div');
      strip.className = 'tfbf-swatches' + (openStrips.has(name) ? ' tfbf-open' : '');

      PALETTE.forEach((p) => {
        const sw = document.createElement('button');
        sw.className = 'tfbf-swatch';
        sw.style.background = p.hex;
        sw.title = p.label;
        onClick(sw, () => {
          const s = loadState(boardId);
          s.colors[name] = p.hex;
          saveState(boardId, s);
          applyAll();
          renderPanel();
        });
        strip.appendChild(sw);
      });

      const none = document.createElement('button');
      none.className = 'tfbf-swatch tfbf-none';
      none.title = 'No color';
      onClick(none, () => {
        const s = loadState(boardId);
        s.colors[name] = null; // explicit "no color" beats team default
        saveState(boardId, s);
        applyAll();
        renderPanel();
      });
      strip.appendChild(none);

      onClick(dot, () => {
        if (openStrips.has(name)) openStrips.delete(name);
        else openStrips.add(name);
        strip.classList.toggle('tfbf-open');
      });
      panel.appendChild(strip);
    });

    // Footer actions
    const foot = document.createElement('div');
    foot.className = 'tfbf-foot';

    const showAll = document.createElement('button');
    showAll.textContent = 'Show all';
    onClick(showAll, () => {
      const s = loadState(boardId);
      s.hidden = [];
      s.snoozed = {};
      saveState(boardId, s);
      applyAll();
      renderPanel();
    });
    foot.appendChild(showAll);

    const resetColors = document.createElement('button');
    resetColors.textContent = 'Reset colors';
    resetColors.title = 'Clear local color choices (team defaults return)';
    onClick(resetColors, () => {
      const s = loadState(boardId);
      s.colors = {};
      saveState(boardId, s);
      applyAll();
      renderPanel();
    });
    foot.appendChild(resetColors);

    const saveClose = document.createElement('button');
    saveClose.className = 'tfbf-save';
    saveClose.textContent = 'Save & close';
    onClick(saveClose, () => {
      openStrips.clear();
      panel.classList.remove('tfbf-open');
    });
    foot.appendChild(saveClose);

    panel.appendChild(foot);
  }

  // ------------------------------------------------------------------
  // Keep up with Trello's re-renders and SPA navigation
  // ------------------------------------------------------------------

  let debounceTimer = null;
  function scheduleApply() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyAll, 250);
  }

  function start() {
    injectStyles();
    buildFab();
    applyAll();

    // Trello redraws lists constantly; childList-only observation avoids
    // reacting to our own inline-style changes (attribute mutations).
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });

    // Snooze expiry sweep — brings columns back on time even if the
    // board is otherwise idle (no mutations, no navigation)
    setInterval(applyAll, 60 * 1000);

    // SPA board switches don't reload the page
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        if (panel) panel.classList.remove('tfbf-open');
        scheduleApply();
      }
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
