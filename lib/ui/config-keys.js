// @ts-check
/**
 * UI configuration enum values.
 *
 * Single source of truth for the `uiMode` config key. Imported by:
 *   - lib/commands/config-cmd.js   → ENUM_VALUES.uiMode (set-time validation)
 *   - lib/config.js                → validateConfig (load-time warning)
 *   - lib/ui/capability.js         → detectUiMode (precedence rules)
 *
 * See docs/TUI_UX_REDESIGN_PROPOSAL.md §4.2.
 */

/** @type {ReadonlyArray<'auto'|'plain'|'tui'>} */
const UI_MODE_VALUES = Object.freeze(['auto', 'plain', 'tui']);

/** @type {'auto'} */
const UI_MODE_DEFAULT = 'auto';

module.exports = {
  UI_MODE_VALUES,
  UI_MODE_DEFAULT
};
