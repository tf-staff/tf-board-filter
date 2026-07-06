// ==UserScript==
// @name         TF Board Filter
// @namespace    https://tf-staff.github.io/
// @version      1.1.0
// @description  Tech Foundry: per-user column hiding + column colors for Trello boards
// @author       Tech Foundry
// @match        https://trello.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @updateURL    https://tf-staff.github.io/tf-board-filter/tf-board-filter.user.js
// @downloadURL  https://tf-staff.github.io/tf-board-filter/tf-board-filter.user.js
// ==/UserScript==

/*
 * TF BOARD FILTER v1.1.0
 * Changelog: stronger tint/outline; panel stays open until Save & close;
 *            expanded color palettes persist while making multiple changes.
 * ----------------------------------------------------------------------
 * What it does:
 *   1. Hide/show entire lists (columns), per user, per board.
 *   2. Apply a faint color tint + outline to lists, per user, per board.
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
        };
      }
    } catch (e) { /* corrupted state — fall through to fresh */ }
    return { hidden: [], colors: {} };
  }

  function saveState(boardId, state) {
    GM_setValue('tfbf:' + boardId, JSON.stringify(state));
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

  function applyAll() {
    const boardId = getBoardId();
    if (!boardId) { updateFabBadge(0); return; }
    const state = loadState(boardId);
    let hiddenCount = 0;

    getListWrappers().forEach((wrapper) => {
      const name = getListName(wrapper);
      if (!name) return; // skip list composer / unnamed elements

      // Visibility
      if (state.hidden.includes(name)) {
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
      position: fixed; bottom: 18px; right: 18px; z-index: 9999;
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
      position: fixed; bottom: 66px; right: 18px; z-index: 9999;
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
    .tfbf-head span { color: #8A8C94; font-size: 11px; }
    .tfbf-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 14px; border-bottom: 1px solid #26272C;
    }
    .tfbf-row:last-of-type { border-bottom: none; }
    .tfbf-name {
      flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .tfbf-name.tfbf-dim { color: #6A6C74; text-decoration: line-through; }
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
  `;

  let fab = null;
  let panel = null;
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
    fab.innerHTML = '<span>Columns</span><span class="tfbf-badge" style="display:none"></span>';
    fab.addEventListener('click', () => {
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
    head.innerHTML = '<strong>TF Board Filter</strong><span>just your view</span>';
    panel.appendChild(head);

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
      const color = colorForList(name, state);

      const row = document.createElement('div');
      row.className = 'tfbf-row';

      // Visibility toggle
      const eye = document.createElement('button');
      eye.className = 'tfbf-eye' + (isHidden ? '' : ' tfbf-on');
      eye.title = isHidden ? 'Show this column' : 'Hide this column';
      eye.addEventListener('click', () => {
        const s = loadState(boardId);
        const idx = s.hidden.indexOf(name);
        if (idx >= 0) s.hidden.splice(idx, 1);
        else s.hidden.push(name);
        saveState(boardId, s);
        applyAll();
        renderPanel();
      });
      row.appendChild(eye);

      // Name
      const label = document.createElement('span');
      label.className = 'tfbf-name' + (isHidden ? ' tfbf-dim' : '');
      label.textContent = name;
      row.appendChild(label);

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
        sw.addEventListener('click', () => {
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
      none.addEventListener('click', () => {
        const s = loadState(boardId);
        s.colors[name] = null; // explicit "no color" beats team default
        saveState(boardId, s);
        applyAll();
        renderPanel();
      });
      strip.appendChild(none);

      dot.addEventListener('click', () => {
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
    showAll.addEventListener('click', () => {
      const s = loadState(boardId);
      s.hidden = [];
      saveState(boardId, s);
      applyAll();
      renderPanel();
    });
    foot.appendChild(showAll);

    const resetColors = document.createElement('button');
    resetColors.textContent = 'Reset colors';
    resetColors.title = 'Clear local color choices (team defaults return)';
    resetColors.addEventListener('click', () => {
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
    saveClose.addEventListener('click', () => {
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
