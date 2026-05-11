// @ts-check
/**
 * Skills metrics collection — SKILLS_ENHANCEMENT_PLAN §C2.
 *
 * Each MCP skill wraps its `CallToolRequest` handler with `wrapToolHandler()`.
 * On every tool call:
 *   - records latency from handler entry to result construction
 *   - measures output size (JSON.stringify(result).length, characters NOT bytes)
 *   - if env var `AI_ISSUE_SKILLS_METRICS_PATH` is set, appends one JSON line
 *     to that file
 *   - on disk error, swallows silently — metrics must NEVER break a skill call
 *
 * The agent runtime in `lib/agents/env-builder.js` decides whether to set the
 * env var (based on `config.skillsMetricsEnabled`); skills themselves have no
 * config knowledge — they're cheap, stateless, env-driven.
 *
 * Why env-driven (not config-driven) at the skill side:
 *   Copilot CLI uses `stdio: 'inherit'`, so we can't intercept stderr from the
 *   Node side. The original plan §C2.2 proposed a stderr-tap design which only
 *   half-works. The env-var/file-write design works identically for both
 *   Copilot and Claude Code, with no agent-side stream gymnastics. (Decision
 *   confirmed with user 2026-05-11.)
 *
 * Privacy: the schema deliberately excludes any tool input or output content —
 * only structural metadata (tool name, latency, size, timestamp, optional
 * error flag).
 */
const fs = require('fs');

const ENV_VAR = 'AI_ISSUE_SKILLS_METRICS_PATH';

/**
 * Append a single JSON line to the metrics file, if the env var is set.
 * Best-effort; all errors are swallowed.
 *
 * @param {object} metric
 */
function emitMetric(metric) {
  const target = process.env[ENV_VAR];
  if (!target) return;
  try {
    fs.appendFileSync(target, JSON.stringify(metric) + '\n');
  } catch (_e) {
    // Intentionally swallowed: metrics must never break a skill call.
  }
}

/**
 * Compute the metric record from inputs gathered by `wrapToolHandler`.
 * Extracted for testability.
 *
 * @param {{
 *   skillName: string,
 *   toolName: string|undefined,
 *   startNs: bigint,
 *   endNs: bigint,
 *   result?: any,
 *   error?: boolean
 * }} inputs
 * @returns {object}
 */
function computeMetric({ skillName, toolName, startNs, endNs, result, error }) {
  const latencyMs = Number((endNs - startNs) / 1000000n);
  let outputSize = 0;
  if (!error && result !== undefined) {
    try {
      outputSize = JSON.stringify(result).length;
    } catch (_e) {
      outputSize = -1; // signal "uncomputable" without breaking
    }
  }
  const metric = {
    timestamp: new Date().toISOString(),
    skill: skillName,
    tool: toolName || null,
    latency_ms: latencyMs,
    output_size_chars: outputSize,
  };
  if (error) metric.error = true;
  return metric;
}

/**
 * Wrap a `CallToolRequest` handler with metric collection. The wrapped
 * function is a drop-in replacement: same input shape, same return value,
 * same throw semantics. Adds an `appendFileSync` call after the handler
 * resolves (or rejects).
 *
 * @template {(request: any) => Promise<any>} H
 * @param {H} handler
 * @param {string} skillName  - logical skill identifier, e.g. "git-history-analyzer"
 * @returns {H}
 */
function wrapToolHandler(handler, skillName) {
  if (typeof handler !== 'function') {
    throw new TypeError('wrapToolHandler: handler must be a function');
  }
  if (!skillName || typeof skillName !== 'string') {
    throw new TypeError('wrapToolHandler: skillName must be a non-empty string');
  }
  // @ts-expect-error — return type narrows to H via the cast below
  return async function metricsWrapped(request) {
    const startNs = process.hrtime.bigint();
    const toolName =
      request && request.params && typeof request.params.name === 'string'
        ? request.params.name
        : undefined;
    let result;
    try {
      result = await handler(request);
    } catch (err) {
      const endNs = process.hrtime.bigint();
      emitMetric(computeMetric({ skillName, toolName, startNs, endNs, error: true }));
      throw err;
    }
    const endNs = process.hrtime.bigint();
    emitMetric(computeMetric({ skillName, toolName, startNs, endNs, result }));
    return result;
  };
}

module.exports = {
  wrapToolHandler,
  emitMetric,
  ENV_VAR,
  __internal: { computeMetric },
};
