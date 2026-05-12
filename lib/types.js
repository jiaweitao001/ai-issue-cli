// @ts-check
//
// Shared type definitions for ai-issue-cli.
// These are used via JSDoc typedef and type annotations across the codebase.
//
// Usage in other files:
//   /** @typedef {import('./types').Config} Config */

/**
 * @typedef {Object} Config
 * @property {string} repoPath - Path to the target repository
 * @property {string} reportPath - Path to store generated reports
 * @property {string} issueBaseUrl - Base URL for issues (e.g. https://github.com/owner/repo/issues)
 * @property {string} model - AI model identifier (e.g. 'gpt-4', 'claude-sonnet-4.5')
 * @property {string} [agent] - Agent identifier (5A supports only 'copilot')
 * @property {Record<string, { model?: string }>} [agents] - Per-agent configuration
 * @property {string} [rubberDuckAgent] - Optional agent override for rubber-duck tasks
 * @property {string} [modelOverride] - Run-scoped command-line model override
 * @property {string} logLevel - Logging level ('info', 'debug', 'error')
 * @property {string} [repo] - GitHub owner/name (e.g. 'owner/repo')
 * @property {string} [serviceUrl] - Pipeline service URL
 * @property {string} [serviceApiKey] - Pipeline service API key
 * @property {string} [knowledgeBasePath] - Local knowledge base directory
 * @property {boolean} [knowledgeBaseEnabled] - Whether local knowledge base support is enabled
 * @property {boolean} [knowledgeBaseAutoUpdate] - Whether local knowledge base auto-update is enabled
 * @property {boolean} [skillsMetricsEnabled] - Whether per-skill local metrics collection is enabled
 * @property {string} [skillsMetricsPath] - Path to the skills metrics JSONL file
 * @property {string} [updateChannel] - How `ai-issue update` resolves the upstream target ('auto' / 'tag' / 'branch')
 * @property {string} [forkRemote] - Git remote name for fork pushes
 * @property {string} [reviewToolRepoUrl] - URL for the review tool installer repo
 * @property {string} [owner] - Engineer owner identifier (used by `ai-issue register` and triage assignment)
 * @property {string} [workDir] - Workspace directory for `ai-issue validate` to scan for reports
 */

/**
 * @typedef {Object} SolveOptions
 * @property {string} [model] - Override config model
 * @property {string} [agent] - Override config agent
 * @property {boolean} [debug] - Enable debug output
 * @property {boolean} [silent] - Suppress all output
 * @property {boolean} [skipEval] - Skip evaluation phase
 * @property {boolean} [branch] - Create a fix branch
 * @property {boolean} [pushFork] - Push branch to fork remote
 * @property {boolean} [force] - Override pipeline triage status
 * @property {boolean} [skipHeader] - Skip header display
 * @property {boolean} [quiet] - Suppress non-essential output
 */

/**
 * @typedef {Object} CopilotOptions
 * @property {string[]} [additionalArgs] - Extra CLI arguments for copilot
 * @property {boolean} [silent] - Run in silent mode (stdio: 'ignore')
 * @property {boolean} [debugMode] - Enable debug output
 * @property {string|null} [phase] - Current phase identifier ('phase1', 'phase2', 'evaluate')
 */

/**
 * @typedef {'research'|'solution'|'rubber_duck_critique'|'rubber_duck_fix'|'auto_review'|'evaluation'} TaskType
 */

/**
 * @typedef {'read-only'|'noninteractive-full-auto'} PermissionProfile
 */

/**
 * @typedef {Object} GitPolicy
 * @property {'no-commit'|'may-commit'|'forbid-commit'} commitBehavior
 */

/**
 * @typedef {Object} ArtifactSpec
 * @property {'file'|'stdout'} kind
 * @property {string} path
 * @property {'throw'|'warn'} [failureMode]
 * @property {RegExp} [requiredSection]
 * @property {(content: string) => boolean} [validate]
 */

/**
 * @typedef {Object} TaskRequest
 * @property {TaskType} taskType
 * @property {string} prompt
 * @property {string} repoPath
 * @property {string} reportPath
 * @property {string} model
 * @property {'phase1'|'phase2'|'evaluate'|null} mcpProfile
 * @property {PermissionProfile} permissionProfile
 * @property {GitPolicy} gitPolicy
 * @property {ArtifactSpec[]} expectedArtifacts
 * @property {(elapsedSeconds: number) => void} [onArtifactWaitProgress]
 * @property {boolean} debugMode
 * @property {boolean} silent
 */

/**
 * @typedef {Object} TaskResult
 * @property {boolean} success
 * @property {Record<string, string>} artifacts
 * @property {string[]} [warnings]
 * @property {Object} git
 * @property {string} git.beforeHead
 * @property {string} git.afterHead
 * @property {string[]} git.commits
 * @property {string[]} git.changedFiles
 * @property {string} [stderr]
 * @property {boolean} [skipped]
 * @property {string} [reason]
 */

/**
 * @typedef {Object} BatchOptions
 * @property {string} [model] - Override config model
 * @property {string} [agent] - Override config agent
 * @property {boolean} [debug] - Enable debug output
 * @property {number} [concurrency] - Max parallel issue processing (default: 3)
 */

/**
 * @typedef {'GUIDANCE'|'CODE_CHANGE'} IssueType
 */

/**
 * @typedef {'triaged'|'queued'|'solving'|'solved'|'skipped'|'failed'} PipelineStatus
 */

/**
 * @typedef {'PROCEED'|'SKIP'|'NEEDS_HUMAN'} TriageRecommendation
 */

/**
 * @typedef {Object} PipelineEntry
 * @property {number} issue - Issue number
 * @property {PipelineStatus} status - Current pipeline status
 * @property {TriageRecommendation} [recommendation] - Triage recommendation
 * @property {string} [owner] - Assigned owner
 * @property {string} [branch] - Fix branch name
 */

/**
 * @typedef {Object} StyleEntry
 * @property {string} emoji - Display emoji
 * @property {string} color - Chalk color name
 */

/**
 * Subscription-rotation migration info parsed from server response headers.
 * Set by lib/service-client.js#parseMigrationHeaders when the server returns
 * X-Service-Migration-Url (and optionally X-Service-Migration-Deadline).
 *
 * @typedef {Object} MigrationInfo
 * @property {string} newUrl - The new serviceUrl users should switch to.
 * @property {string} [deadline] - Optional ISO date (YYYY-MM-DD) for old service decommission.
 */

/**
 * Result of a connectivity probe (lib/service-client.js#pingHealth/pingAuthenticated).
 * Probes never throw — they map every failure to one of the shapes below.
 *
 * @typedef {Object} ServiceProbeResult
 * @property {boolean} ok - True only when HTTP status is 200 AND body shape matches.
 * @property {string} [reason] - 'not_configured' when serviceUrl is empty.
 * @property {string} [errorCode] - 'INVALID_URL' / 'INVALID_SCHEMA' / 'ETIMEDOUT' / 'ECONNREFUSED' / 'ENOTFOUND' / etc.
 * @property {string} [error] - Human-readable error message.
 * @property {number} [status] - HTTP status code (when a response was received).
 * @property {number} [latencyMs] - End-to-end probe latency in milliseconds.
 * @property {boolean} [unexpectedShape] - True when status=200 but body shape did not match.
 * @property {string} [body] - Truncated response body (first 200 chars).
 * @property {string} [url] - The actual URL that was probed.
 * @property {string} [serviceUrl] - The configured serviceUrl (for INVALID_URL diagnostics).
 * @property {'Bearer'|'X-Api-Key'|'none'} [credentialSent] - Auth credential the client sent (auth probe only).
 * @property {string[]} [sourcesTried] - Credential sources attempted (e.g. ['azure-cli', 'api-key']).
 * @property {string|null} [azError] - Reason Azure CLI token resolution failed (auth probe only).
 * @property {MigrationInfo|null} [migration] - Migration info parsed from response headers, if any.
 */

/**
 * Aggregated result returned by lib/service-health.js#checkServiceConnectivity.
 *
 * @typedef {Object} ServiceConnectivityResult
 * @property {boolean} configured - True when serviceUrl is non-empty.
 * @property {boolean} mismatch - True when serviceApiKey is set but serviceUrl is not (warning, not fail).
 * @property {ServiceProbeResult|null} reachability - Result of pingHealth, or null if skipped.
 * @property {ServiceProbeResult|null} auth - Result of pingAuthenticated, or null if skipped.
 * @property {string|null} authSkipReason - Why auth was skipped (e.g. 'transport-level failure on /health').
 * @property {string[]} hints - Human-readable fix-it hints derived from probe results.
 * @property {MigrationInfo|null} migration - Migration info promoted from reachability/auth probes.
 */

module.exports = {};
