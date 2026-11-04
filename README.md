# TF Board Filter

Tampermonkey userscript for the UC Davis Tech Foundry Trello operations
board. Gives each staff member their own view of the shared board —
without a paid Trello plan and without changing anyone else's view:

- **Hide columns** entirely (per user, per board; the board reflows)
- **Snooze** a column for 4 hours — it comes back on its own
- **Color-code columns** with a faint tint + outline; staff columns ship
  with team default colors

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Edge/Chrome.
2. In `edge://extensions`, enable **Developer mode** AND Tampermonkey's
   per-extension **Allow user scripts** toggle (Details page).
3. Open the script URL — Tampermonkey will offer to install it:

   **https://tf-staff.github.io/tf-board-filter/tf-board-filter.user.js**

4. Open the Trello board and click the **Columns** pill, bottom-right.

Updates ship automatically when a new version is pushed to this repo.

## Development

See [CLAUDE.md](CLAUDE.md) for the full hand-off brief: architecture,
storage schema, DOM selector strategy, deployment pipeline, and backlog.
Rule zero: every functional change bumps `@version`, or auto-update
never fires.
