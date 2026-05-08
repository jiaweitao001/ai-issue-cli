// @ts-check
/**
 * Model catalog: known/preset model ids with vendor / tier / tags metadata.
 *
 * Loads from bundled `data/models.json` plus optional user override at
 * `~/.ai-issue/models.json`. The catalog is informational only — unknown
 * model ids (BYOK / brand-new releases) are always allowed; they only
 * trigger a warning with a "did you mean" suggestion.
 *
 * @typedef {Object} Model
 * @property {string} id
 * @property {string} [displayName]
 * @property {string} [vendor]
 * @property {string} [tier]
 * @property {string[]} [tags]
 * @property {string} [agent]
 *
 * @typedef {Object} Catalog
 * @property {number} schemaVersion
 * @property {string} catalogVersion
 * @property {string} [recommended]
 * @property {Record<string, string>} [recommendedByAgent]
 * @property {Model[]} models
 * @property {Object} source - Where each part of the catalog came from
 * @property {string} source.builtin - Path to bundled file
 * @property {string|null} source.override - Path to user override file (null if absent)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { warning, debug } = require('./logger');

const BUILTIN_PATH = path.join(__dirname, '..', 'data', 'models.json');
const USER_OVERRIDE_PATH = path.join(os.homedir(), '.ai-issue', 'models.json');

let _cached = /** @type {Catalog | null} */ (null);
let _warned = /** @type {Set<string>} */ (new Set());

/**
 * Reset the catalog cache. Test-only.
 */
function _resetCache() {
  _cached = null;
}

/**
 * Reset the warned-once set. Test-only.
 */
function _resetWarned() {
  _warned = new Set();
}

/**
 * Validate a parsed catalog object (after JSON.parse). Returns a sanitized
 * copy with valid entries only. Logs warnings for skipped entries.
 *
 * @param {any} parsed - Raw object from JSON.parse
 * @param {string} sourcePath - Path used in warnings
 * @returns {{ recommended: string|undefined, recommendedByAgent: Record<string, string>, models: Model[] } | null}
 */
function _validateParsed(parsed, sourcePath) {
  if (!parsed || typeof parsed !== 'object') {
    warning(`Model catalog at ${sourcePath} is not a JSON object; ignoring.`);
    return null;
  }
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) {
    warning(`Model catalog at ${sourcePath} has unsupported schemaVersion=${parsed.schemaVersion}; ignoring.`);
    return null;
  }
  if (!Array.isArray(parsed.models)) {
    warning(`Model catalog at ${sourcePath} is missing a 'models' array; ignoring.`);
    return null;
  }
  const models = [];
  for (const entry of parsed.models) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.trim() === '') {
      warning(`Model catalog at ${sourcePath}: skipping entry without a valid 'id'.`);
      continue;
    }
    models.push({
      id: entry.id.trim(),
      agent: typeof entry.agent === 'string' && entry.agent.trim() ? entry.agent.trim() : 'copilot',
      displayName: typeof entry.displayName === 'string' ? entry.displayName : undefined,
      vendor: typeof entry.vendor === 'string' ? entry.vendor : undefined,
      tier: typeof entry.tier === 'string' ? entry.tier : undefined,
      tags: Array.isArray(entry.tags) ? entry.tags.filter((t) => typeof t === 'string') : undefined,
    });
  }
  const recommendedByAgent = {};
  let recommended;
  if (typeof parsed.recommended === 'string') {
    recommended = parsed.recommended;
    recommendedByAgent.copilot = parsed.recommended;
  } else if (parsed.recommended && typeof parsed.recommended === 'object' && !Array.isArray(parsed.recommended)) {
    for (const [agentName, modelId] of Object.entries(parsed.recommended)) {
      if (typeof modelId === 'string' && modelId.trim()) {
        recommendedByAgent[agentName] = modelId.trim();
      }
    }
    recommended = recommendedByAgent.copilot;
  }
  return {
    recommended,
    recommendedByAgent,
    models,
  };
}

/**
 * Read and parse a catalog JSON file. Returns null on any error
 * (file missing, bad JSON, schema invalid). Warnings are emitted for
 * non-missing failures.
 *
 * @param {string} filePath
 * @param {boolean} optional - If true, missing file is silent
 * @returns {{ recommended: string|undefined, recommendedByAgent: Record<string, string>, models: Model[] } | null}
 */
function _loadFile(filePath, optional) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (optional && err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return null;
    }
    if (!optional) {
      throw err;
    }
    warning(`Failed to read model catalog at ${filePath}: ${err.message}`);
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warning(`Failed to parse model catalog at ${filePath}: ${err.message}`);
    return null;
  }
  return _validateParsed(parsed, filePath);
}

/**
 * Load the merged catalog. Cached after first call.
 *
 * Merge rules (per design proposal §4.2):
 * - Built-in entries keep their original order.
 * - User override entries with the same id replace the built-in metadata
 *   in place (no reorder).
 * - User override entries with new ids are appended at the end in their
 *   original order.
 * - User-provided `recommended` field overrides the built-in one.
 *
 * @returns {Catalog}
 */
function loadCatalog() {
  if (_cached) return _cached;

  const builtin = _loadFile(BUILTIN_PATH, false);
  if (!builtin) {
    // _loadFile only returns null on parse/schema failure for non-optional files
    // (missing required file would have thrown). This branch protects future code paths.
    throw new Error(`Built-in model catalog at ${BUILTIN_PATH} is invalid.`);
  }

  let recommended = builtin.recommended;
  const recommendedByAgent = { ...(builtin.recommendedByAgent || {}) };
  const orderedModels = builtin.models.slice();
  const idToIndex = new Map(orderedModels.map((m, i) => [`${m.agent || 'copilot'}:${m.id}`, i]));

  const overrideExists = fs.existsSync(USER_OVERRIDE_PATH);
  if (overrideExists) {
    const override = _loadFile(USER_OVERRIDE_PATH, true);
    if (override) {
      if (override.recommended) recommended = override.recommended;
      Object.assign(recommendedByAgent, override.recommendedByAgent || {});
      for (const entry of override.models) {
        const key = `${entry.agent || 'copilot'}:${entry.id}`;
        const existingIdx = idToIndex.get(key);
        if (existingIdx !== undefined) {
          orderedModels[existingIdx] = entry;
        } else {
          idToIndex.set(key, orderedModels.length);
          orderedModels.push(entry);
        }
      }
    }
  }

  _cached = {
    schemaVersion: 1,
    catalogVersion: 'merged',
    recommended,
    recommendedByAgent,
    models: orderedModels,
    source: {
      builtin: BUILTIN_PATH,
      override: overrideExists ? USER_OVERRIDE_PATH : null,
    },
  };
  debug(`Loaded model catalog: ${orderedModels.length} model(s) from ${overrideExists ? 'builtin + override' : 'builtin'}`);
  return _cached;
}

/**
 * Get the list of known model ids without surfacing load errors.
 * Falls back to an empty list if the catalog itself can't be loaded.
 * @param {string} [agentName]
 * @returns {string[]}
 */
function _safeKnownIds(agentName) {
  try {
    return loadCatalog().models
      .filter((m) => !agentName || (m.agent || 'copilot') === agentName)
      .map((m) => m.id);
  } catch (err) {
    debug(`Catalog load failed in _safeKnownIds: ${err.message}`);
    return [];
  }
}

/**
 * Levenshtein distance between two strings. Iterative DP, O(m*n).
 * Returns Infinity if either argument is not a non-empty string.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function _levenshtein(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return Infinity;
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost  // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Suggest the closest known model id by Levenshtein distance.
 * Returns null if no model is within an acceptable threshold.
 *
 * Threshold: distance <= max(2, ceil(target.length / 4)). This keeps
 * trivial typos like 'claude-sonet-4.5' matching 'claude-sonnet-4.5'
 * while avoiding spurious matches between unrelated short ids.
 *
 * @param {string} id
 * @param {string} [agentName]
 * @returns {string | null}
 */
function suggestClosest(id, agentName) {
  if (typeof id !== 'string' || id.trim() === '') return null;
  const target = id.trim();
  const knownIds = _safeKnownIds(agentName);
  if (knownIds.length === 0) return null;

  let bestId = null;
  let bestDistance = Infinity;
  for (const known of knownIds) {
    const d = _levenshtein(target.toLowerCase(), known.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      bestId = known;
    }
  }
  const threshold = Math.max(2, Math.ceil(target.length / 4));
  return bestDistance <= threshold ? bestId : null;
}

/**
 * Check whether a model id is in the known catalog.
 * @param {string} id
 * @param {string} [agentName]
 * @returns {boolean}
 */
function isKnownModel(id, agentName) {
  if (typeof id !== 'string') return false;
  return _safeKnownIds(agentName).includes(id.trim());
}

/**
 * @param {string} agentName
 * @returns {string|undefined}
 */
function getRecommendedModel(agentName = 'copilot') {
  const cat = loadCatalog();
  return (cat.recommendedByAgent && cat.recommendedByAgent[agentName])
    || (agentName === 'copilot' ? cat.recommended : undefined);
}

/**
 * Validate a model id and emit a warning if unknown. Same id only warns
 * once per process (warned-once dedup) — protects batch / watch loops
 * from spamming the log. Never blocks, never asks for input.
 *
 * @param {string} id - Effective model id (post --model / config / env resolution)
 * @param {string} [agentName] - Agent the model will be used with
 */
function validateAndWarnModelOnce(id, agentName = 'copilot') {
  if (typeof id !== 'string' || id.trim() === '') return;
  const trimmed = id.trim();
  const warnKey = `${agentName}:${trimmed}`;
  if (_warned.has(warnKey)) return;
  _warned.add(warnKey);

  if (isKnownModel(trimmed, agentName)) return;

  const suggestion = suggestClosest(trimmed, agentName);
  let msg = `Model '${trimmed}' is not in the known model catalog for agent '${agentName}'.`;
  if (suggestion) msg += ` Did you mean '${suggestion}'?`;
  msg += ' Continuing with the provided id (BYOK / unknown models are allowed).';
  warning(msg);
}

module.exports = {
  loadCatalog,
  validateAndWarnModelOnce,
  suggestClosest,
  isKnownModel,
  getRecommendedModel,
  // Test-only exports
  _resetCache,
  _resetWarned,
  _BUILTIN_PATH: BUILTIN_PATH,
  _USER_OVERRIDE_PATH: USER_OVERRIDE_PATH,
};
