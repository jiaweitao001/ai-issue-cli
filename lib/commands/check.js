// @ts-check
/**
 * Check command implementation
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, validateConfig } = require('../config');
const { checkEnvironment } = require('../environment');
const { checkServiceConnectivity } = require('../service-health');
const { applyAgentCommandOptions } = require('../agents/command-options');
const { createUi } = require('../ui');

const GROUP_TITLES = {
  core: 'Core',
  agents: 'Agents',
  repository: 'Repository',
  service: 'Service',
  kb: 'Knowledge Base'
};

/**
 * @param {string} name             Display name (e.g. 'Service Reachability').
 * @param {object|null} probe       ServiceProbeResult or null when skipped.
 * @param {string|null} skipReason  Reason to render in the skipped line.
 * @param {string[]} hints          Hints to render under a failed probe.
 * @returns {{ item: import('../ui/components/status-list').StatusItem, ok: boolean }}
 */
function serviceProbeItem(name, probe, skipReason, hints) {
  if (probe === null) {
    return {
      item: { status: 'skip', name, detail: skipReason || 'skipped' },
      ok: true
    };
  }

  const detail = formatProbeDetail(probe);
  if (probe.ok) {
    return { item: { status: 'ok', name, detail }, ok: true };
  }

  // Special case: 200 + credentialSent=none on auth → warning, not fail.
  if (
    name.toLowerCase().includes('authentication')
    && probe.status === 200
    && probe.credentialSent === 'none'
  ) {
    return {
      item: {
        status: 'warn',
        name,
        detail,
        help: `Service allows anonymous access (no credential was rejected). Verify backend's auth configuration if this is unexpected.`
      },
      ok: true
    };
  }

  return {
    item: { status: 'fail', name, detail, help: hints.join('\n') },
    ok: false
  };
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
 * @param {{ info: (message: string) => void }} ui
 */
function maybePrintProjectMcpNotice(config, ui) {
  if ((config.agent || 'copilot') !== 'claude-code' || !config.repoPath) return;
  const projectMcpPath = path.join(config.repoPath, '.mcp.json');
  if (!fs.existsSync(projectMcpPath)) return;

  ui.info(`Claude Code strict MCP mode: repository .mcp.json will be ignored (${projectMcpPath}). ai-issue uses its phase-specific MCP config instead.`);
}

// Command: check
async function cmdCheck(options = {}) {
  const config = loadConfig();
  applyAgentCommandOptions(config, options);
  const ui = createUi({
    flagPlain: !!options.plain,
    flagTui: !!options.tui,
    debug: !!options.debug,
    config,
    env: process.env,
    stdout: process.stdout,
    stdin: process.stdin
  });

  ui.header('🔍 Environment Check');

  let allOk = true;
  /** @type {Record<string, import('../ui/components/status-list').StatusItem[]>} */
  const grouped = {
    core: [],
    agents: [],
    repository: [],
    service: [],
    kb: []
  };

  // First check configuration validation
  const { valid, errors: configErrors, warnings: configWarnings } = validateConfig(config);
  if (!valid) {
    grouped.core.push({
      status: 'fail',
      name: 'Configuration Validation',
      help: configErrors.join('\n')
    });
    allOk = false;
  } else if (configWarnings && configWarnings.length > 0) {
    grouped.core.push({
      status: 'warn',
      name: 'Configuration Validation',
      help: configWarnings.join('\n')
    });
  } else {
    grouped.core.push({ status: 'ok', name: 'Configuration Validation' });
  }

  const checks = checkEnvironment(config);
  maybePrintProjectMcpNotice(config, ui);

  checks.forEach((check) => {
    const group = check.group || 'core';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push({
      status: check.status ? 'ok' : 'fail',
      name: check.name,
      detail: check.detail,
      help: !check.status ? check.help : undefined
    });
    allOk = allOk && check.status;
  });

  // Service connectivity (optional; skipped when serviceUrl not configured).
  const svc = await checkServiceConnectivity(config);

  if (!svc.configured) {
    if (svc.mismatch) {
      // serviceApiKey set but serviceUrl missing — warning, still passes.
      grouped.service.push({
        status: 'warn',
        name: 'Service Reachability',
        detail: 'serviceUrl not configured, but serviceApiKey is set',
        help: 'You set serviceApiKey but no serviceUrl. Did you mean to enable service integration?',
        command: 'ai-issue config set serviceUrl <url>'
      });
    } else {
      grouped.service.push({
        status: 'skip',
        name: 'Service Reachability',
        detail: 'serviceUrl not configured — service integration is optional'
      });
    }
    grouped.service.push({
      status: 'skip',
      name: 'Service Authentication',
      detail: 'skipped — service not configured'
    });
  } else {
    const reach = serviceProbeItem(
      'Service Reachability',
      svc.reachability,
      null,
      svc.reachability ? hintsFromAggregate(svc, 'reachability') : []
    );
    const auth = serviceProbeItem(
      'Service Authentication',
      svc.auth,
      svc.authSkipReason,
      svc.auth ? hintsFromAggregate(svc, 'auth') : []
    );
    grouped.service.push(reach.item, auth.item);
    allOk = allOk && reach.ok && auth.ok;
  }

  ui.statusList(toStatusGroups(grouped));

  // Migration banner — always render (forced) when the server announced
  // a sub rotation, so users running `ai-issue check` always see it.
  if (svc.migration) {
    try {
      const { showMigrationBannerForced } = require('../migration-notifier');
      showMigrationBannerForced(svc.migration);
    } catch { /* notifier must never break the check command */ }
  }

  ui.log('');
  ui.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (allOk) {
    ui.success('All checks passed!');
  } else {
    ui.error('Some checks failed, please fix the above issues');
    process.exit(1);
  }

  ui.log('');
}

/**
 * @param {Record<string, import('../ui/components/status-list').StatusItem[]>} grouped
 * @returns {import('../ui/components/status-list').StatusGroup[]}
 */
function toStatusGroups(grouped) {
  return ['core', 'agents', 'repository', 'service', 'kb']
    .map((key) => ({ title: GROUP_TITLES[key] || key, items: grouped[key] || [] }))
    .filter((group) => group.items.length > 0);
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
  serviceProbeItem,
  toStatusGroups,
};
