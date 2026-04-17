/**
 * Shared type definitions for ai-issue-cli.
 * These are used via JSDoc @typedef / @type annotations across the codebase.
 *
 * Usage in other files:
 *   /** @typedef {import('./types').Config} Config *​/
 */

/**
 * @typedef {Object} Config
 * @property {string} repoPath - Path to the target repository
 * @property {string} reportPath - Path to store generated reports
 * @property {string} issueBaseUrl - Base URL for issues (e.g. https://github.com/owner/repo/issues)
 * @property {string} model - AI model identifier (e.g. 'gpt-4', 'claude-sonnet-4.5')
 * @property {string} logLevel - Logging level ('info', 'debug', 'error')
 * @property {string} [repo] - GitHub owner/name (e.g. 'owner/repo')
 * @property {string} [serviceUrl] - Pipeline service URL
 * @property {string} [serviceApiKey] - Pipeline service API key
 * @property {string} [forkRemote] - Git remote name for fork pushes
 * @property {string} [reviewToolRepoUrl] - URL for the review tool installer repo
 */

/**
 * @typedef {Object} SolveOptions
 * @property {string} [model] - Override config model
 * @property {boolean} [debug] - Enable debug output
 * @property {boolean} [silent] - Suppress all output
 * @property {boolean} [noEval] - Skip evaluation phase
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
 * @typedef {Object} BatchOptions
 * @property {string} [model] - Override config model
 * @property {boolean} [debug] - Enable debug output
 * @property {number} [concurrency] - Max parallel issue processing (default: 3)
 */

/**
 * @typedef {'GUIDANCE'|'CODE_CHANGE'} IssueType
 */

/**
 * @typedef {'triaged'|'queued'|'solving'|'solved'|'failed'} PipelineStatus
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

module.exports = {};
