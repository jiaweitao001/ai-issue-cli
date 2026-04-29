// @ts-check
/**
 * `ai-issue model` command group.
 *
 * Subcommands:
 *   - default (no subcommand) → interactive picker
 *   - list → printed table of preset models
 *   - current → single line with the effective model id (script-friendly)
 *
 * Existing `ai-issue config set model <id>` is preserved for non-interactive
 * scripting; this command intentionally does NOT add a duplicate `set` action.
 *
 * @typedef {import('../types').Config} Config
 */

const path = require('path');
const { loadConfig, saveConfig } = require('../config');
const { log, info, success, warning, error, chalk } = require('../logger');
const modelCatalog = require('../model-catalog');
const { promptSelect, promptInput } = require('../prompts');

const CUSTOM_OPTION_LABEL = '[Enter custom model ID...]';

/**
 * Format a model entry as a single display line.
 * @param {import('../model-catalog').Model} m
 * @param {{ recommended?: string, current?: string }} ctx
 */
function _formatModel(m, ctx) {
  const parts = [];
  parts.push(m.id.padEnd(28));
  parts.push((m.vendor || '').padEnd(11));
  parts.push((m.tier || '').padEnd(10));
  const tags = (m.tags && m.tags.length ? m.tags.join(', ') : '').padEnd(28);
  parts.push(tags);
  const markers = [];
  if (ctx.recommended && m.id === ctx.recommended) markers.push('★ recommended');
  if (ctx.current && m.id === ctx.current) markers.push('✓ current');
  parts.push(markers.join('  '));
  return parts.join(' ');
}

/**
 * `ai-issue model list`
 */
function _cmdList() {
  let cat;
  try {
    cat = modelCatalog.loadCatalog();
  } catch (err) {
    error(`Failed to load model catalog: ${err.message}`);
    process.exit(1);
    return;
  }
  const config = loadConfig();
  const current = config.model;

  log('');
  log(chalk.bold.cyan('📦 Known model presets'));
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');
  const header =
    'ID'.padEnd(28) +
    ' ' +
    'Vendor'.padEnd(11) +
    ' ' +
    'Tier'.padEnd(10) +
    ' ' +
    'Tags'.padEnd(28) +
    ' Marker';
  log(chalk.bold(header));
  log(
    '─'.repeat(28) +
      ' ' +
      '─'.repeat(11) +
      ' ' +
      '─'.repeat(10) +
      ' ' +
      '─'.repeat(28) +
      ' ────────────────'
  );
  for (const m of cat.models) {
    log(_formatModel(m, { recommended: cat.recommended, current }));
  }
  log('');
  const builtinRel = path.relative(process.cwd(), cat.source.builtin);
  info(`Catalog: bundled (${builtinRel}) — preset list, not authoritative`);
  if (cat.source.override) {
    info(`Override file: ${cat.source.override}`);
  } else {
    info(`Override file: ${modelCatalog._USER_OVERRIDE_PATH} (not present)`);
  }
  log('');
}

/**
 * `ai-issue model current`
 */
function _cmdCurrent() {
  const config = loadConfig();
  log(config.model || '');
}

/**
 * Default action: launch the interactive selector.
 */
async function _cmdSelect() {
  let cat;
  try {
    cat = modelCatalog.loadCatalog();
  } catch (err) {
    error(`Failed to load model catalog: ${err.message}`);
    process.exit(1);
    return;
  }
  const config = loadConfig();
  const current = config.model;

  if (cat.models.length === 0) {
    error('Model catalog is empty. Edit data/models.json or ~/.ai-issue/models.json.');
    process.exit(1);
    return;
  }

  log('');
  log(`Current model: ${chalk.bold(current || '(none)')}`);
  log('');

  const items = cat.models.slice();
  // Build display lines
  const lines = items.map((m) => {
    const meta = [m.vendor, m.tier].filter(Boolean).join(' · ');
    const tags = m.tags && m.tags.length ? ' · ' + m.tags.join(', ') : '';
    const markers = [];
    if (cat.recommended && m.id === cat.recommended) markers.push('★ recommended');
    if (current && m.id === current) markers.push('✓ current');
    const markerSuffix = markers.length ? '  ' + markers.join(', ') : '';
    return `${m.id.padEnd(28)} ${meta}${tags}${markerSuffix}`;
  });
  lines.push(CUSTOM_OPTION_LABEL);

  // Pre-select current model when possible, else recommended, else 0.
  let initialIndex = items.findIndex((m) => m.id === current);
  if (initialIndex < 0 && cat.recommended) {
    initialIndex = items.findIndex((m) => m.id === cat.recommended);
  }
  if (initialIndex < 0) initialIndex = 0;

  const header = chalk.cyan('Select a model (↑/↓ + Enter, Ctrl+C to cancel):');

  const selected = await promptSelect(lines, { initialIndex, header });

  if (selected === null || selected === undefined) {
    // Distinguish: cancel vs non-interactive
    const stdin = process.stdin;
    const stdout = process.stdout;
    const stdinTTY = !!stdin.isTTY;
    const stdoutTTY = !!stdout.isTTY;
    if (!stdinTTY && !stdin.readable && !stdoutTTY) {
      error("Non-interactive shell. Use 'ai-issue model list' or 'ai-issue config set model <id>'.");
      process.exit(1);
      return;
    }
    info('Cancelled, no changes.');
    return;
  }

  let chosenId;
  if (selected === lines.length - 1) {
    // Custom option
    const answer = await promptInput('Enter custom model ID: ');
    if (!answer || !answer.trim()) {
      info('No id provided, no changes.');
      return;
    }
    chosenId = answer.trim();
  } else {
    chosenId = items[selected].id;
  }

  if (chosenId === current) {
    info(`Model unchanged (${chosenId}).`);
    return;
  }

  // Validate (warning-only, never blocks)
  modelCatalog.validateAndWarnModelOnce(chosenId);

  config.model = chosenId;
  saveConfig(config);
  success(`Model set to ${chalk.bold(chosenId)}`);
}

/**
 * Entry point dispatched by `ai-issue.js`.
 *
 * @param {'list'|'current'|undefined} action
 * @returns {Promise<void>}
 */
async function cmdModel(action) {
  if (action === 'list') return _cmdList();
  if (action === 'current') return _cmdCurrent();
  if (action === undefined || action === null) return _cmdSelect();
  error(`Unknown action: ${action}`);
  error('Available actions: list, current (no arg = interactive picker)');
  process.exit(1);
}

module.exports = {
  cmdModel,
  // Internal exports for testing
  _cmdList,
  _cmdCurrent,
  _cmdSelect,
};
