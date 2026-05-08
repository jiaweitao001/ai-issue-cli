/**
 * Check command implementation
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, validateConfig } = require('../config');
const { log, error, success, warning, info, chalk } = require('../logger');
const { checkEnvironment } = require('../environment');
const { checkServiceConnectivity } = require('../service-health');
const { applyAgentCommandOptions } = require('../agents/command-options');

/**
 * Render a single service-connectivity probe result as one check line
 * (with optional indented hints), and return whether it represents a
 * pass for exit-code aggregation.
 *
 * Pass states: ok=true OR (probe is null AND skip is benign).
 *
 * @param {number} index            Zero-based index used for the line prefix.
 * @param {string} name             Display name (e.g. 'Service Reachability').
 * @param {object|null} probe       ServiceProbeResult or null when skipped.
 * @param {string|null} skipReason  Reason to render in the skipped line.
 * @param {string[]} hints          Hints to render under a failed probe.
 * @returns {boolean}               true if this row counts as a pass.
 */
function renderProbeRow(index, name, probe, skipReason, hints) {
  const prefix = `${index}. `;

  if (probe === null) {
    log(chalk.gray(`${prefix}⏭  ${name}    [${skipReason || 'skipped'}]`));
    return true; // skipped is not a failure
  }

  const detail = formatProbeDetail(probe);
  if (probe.ok) {
    success(`${prefix}✅ ${name}    ${chalk.gray(`[${detail}]`)}`);
    return true;
  }

  // Special case: 200 + credentialSent=none on auth → warning, not fail.
  if (
    name.toLowerCase().includes('authentication')
    && probe.status === 200
    && probe.credentialSent === 'none'
  ) {
    warning(`${prefix}⚠️  ${name}    [${detail}]`);
    info(`   ℹ️  Service allows anonymous access (no credential was rejected). Verify backend's auth configuration if this is unexpected.`);
    return true;
  }

  error(`${prefix}❌ ${name}    [${detail}]`);
  for (const h of hints) {
    warning(`   💡 ${h}`);
  }
  return false;
}

/**
 * @param {object} probe
 * @returns {string}
 */
function formatProbeDetail(probe) {
  if (probe.errorCode === 'INVALID_URL' || probe.errorCode === 'INVALID_SCHEMA') {
    return `${probe.errorCode}: ${probe.serviceUrl || ''}`;
  }
  const parts = [];
  if (probe.url) parts.push(`GET ${probe.url}`);
  if (probe.errorCode) {
    parts.push(`→ ${probe.errorCode}${probe.latencyMs != null ? ` after ${probe.latencyMs}ms` : ''}`);
  } else if (probe.status != null) {
    parts.push(`→ ${probe.status}${probe.latencyMs != null ? ` in ${probe.latencyMs}ms` : ''}`);
  }
  if (probe.credentialSent) {
    parts.push(`credentialSent=${probe.credentialSent}`);
  }
  return parts.join(', ');
}

/**
 * Warn when Claude Code's strict MCP config mode will intentionally ignore a
 * repository-level .mcp.json file.
 * @param {object} config
 */
function maybePrintProjectMcpNotice(config) {
  if ((config.agent || 'copilot') !== 'claude-code' || !config.repoPath) return;
  const projectMcpPath = path.join(config.repoPath, '.mcp.json');
  if (!fs.existsSync(projectMcpPath)) return;

  info(`Claude Code strict MCP mode: repository .mcp.json will be ignored (${projectMcpPath}). ai-issue uses its phase-specific MCP config instead.`);
}

// Command: check
async function cmdCheck(options = {}) {
  const config = loadConfig();
  applyAgentCommandOptions(config, options);

  log('');
  log(chalk.bold.cyan('🔍 Environment Check'));
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');

  let allOk = true;

  // First check configuration validation
  const { valid, errors: configErrors, warnings: configWarnings } = validateConfig(config);
  if (!valid) {
    error('0. ❌ Configuration Validation');
    configErrors.forEach(err => warning(`   💡 ${err}`));
    allOk = false;
  } else if (configWarnings && configWarnings.length > 0) {
    warning('0. ⚠️  Configuration Validation');
    configWarnings.forEach(w => info(`   ⚠️  ${w}`));
  } else {
    success('0. ✅ Configuration Validation');
  }

  const checks = checkEnvironment(config);
  maybePrintProjectMcpNotice(config);

  checks.forEach((check, index) => {
    const prefix = check.status ? '✅' : '❌';
    if (check.status) {
      const detail = check.detail ? `    ${chalk.gray(`[${check.detail}]`)}` : '';
      success(`${index + 1}. ${prefix} ${check.name}${detail}`);
    } else {
      const detail = check.detail ? `    ${chalk.gray(`[${check.detail}]`)}` : '';
      error(`${index + 1}. ${prefix} ${check.name}${detail}`);
    }

    if (!check.status && check.help) {
      warning(`   💡 ${check.help}`);
    }
    allOk = allOk && check.status;
  });

  // Service connectivity (optional; skipped when serviceUrl not configured).
  const nextIndex = checks.length + 1;
  const svc = await checkServiceConnectivity(config);

  if (!svc.configured) {
    if (svc.mismatch) {
      // serviceApiKey set but serviceUrl missing — warning, still passes.
      warning(`${nextIndex}. ⚠️  Service Reachability    [serviceUrl not configured, but serviceApiKey is set]`);
      info('   💡 You set serviceApiKey but no serviceUrl. Did you mean to enable service integration?');
      info('      Run: ai-issue config set serviceUrl <url>');
    } else {
      log(chalk.gray(`${nextIndex}. ⏭  Service Reachability    [serviceUrl not configured — service integration is optional]`));
    }
    log(chalk.gray(`${nextIndex + 1}. ⏭  Service Authentication  [skipped — service not configured]`));
  } else {
    const reachOk = renderProbeRow(
      nextIndex,
      'Service Reachability',
      svc.reachability,
      null,
      svc.reachability ? hintsFromAggregate(svc, 'reachability') : []
    );
    const authOk = renderProbeRow(
      nextIndex + 1,
      'Service Authentication',
      svc.auth,
      svc.authSkipReason,
      svc.auth ? hintsFromAggregate(svc, 'auth') : []
    );
    allOk = allOk && reachOk && authOk;
  }

  // Migration banner — always render (forced) when the server announced
  // a sub rotation, so users running `ai-issue check` always see it.
  if (svc.migration) {
    try {
      const { showMigrationBannerForced } = require('../migration-notifier');
      showMigrationBannerForced(svc.migration);
    } catch { /* notifier must never break the check command */ }
  }

  log('');
  log(chalk.grey('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (allOk) {
    success('All checks passed!');
  } else {
    error('Some checks failed, please fix the above issues');
    process.exit(1);
  }

  log('');
}

/**
 * Filter aggregated hints to only those produced by a specific probe kind,
 * by re-deriving via the same source-of-truth helper used internally by
 * service-health.js.
 *
 * @param {object} svc
 * @param {'reachability'|'auth'} kind
 * @returns {string[]}
 */
function hintsFromAggregate(svc, kind) {
  // service-health.js exports hintsFor; require here lazily to avoid a
  // circular module load at file top.
  const { hintsFor } = require('../service-health');
  const probe = kind === 'reachability' ? svc.reachability : svc.auth;
  return probe ? hintsFor(probe, kind) : [];
}

module.exports = {
  cmdCheck,
  maybePrintProjectMcpNotice,
  // Exported for tests
  formatProbeDetail,
};
