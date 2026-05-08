const fs = require('fs');
const path = require('path');
const MiniSearch = require('minisearch');
const { loadManifest, verifySha256, kbErrors, makeKbError } = require('./kb-resolver');

const MIN_SCORE = 0.5;

function compareSemver(a, b) {
  const parse = value => String(value || '')
    .split('-')[0]
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const len = Math.max(left.length, right.length, 3);
  for (let i = 0; i < len; i += 1) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(token => token.trim())
    .filter(Boolean);
}

function computeDocFrequency(entries) {
  const df = {};
  for (const entry of entries || []) {
    if (entry.type !== 'resolved_issue') continue;
    const text = [
      ...(Array.isArray(entry.keywords) ? entry.keywords : []),
      entry.title,
      entry.solution_summary
    ].join(' ');
    for (const token of new Set(tokenize(text))) {
      df[token] = (df[token] || 0) + 1;
    }
  }
  return df;
}

function stripStackTraceNoise(query) {
  return String(query || '')
    // Remove Go runtime frames that are common in panic stack traces and rarely useful for KB retrieval.
    .replace(/runtime\.[a-z]+/g, ' ')
    // Remove source locations such as internal/services/foo.go:123 so file paths do not dominate BM25.
    .replace(/[A-Za-z_./-]+\.go:\d+/g, ' ')
    // Remove Terraform/HCL template location tokens that are noisy without surrounding context.
    .replace(/hcl:[^\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeQuery(query) {
  return stripStackTraceNoise(query).replace(/\s+/g, ' ').trim();
}

function toSearchDocument(entry) {
  return {
    id: String(entry.issue_number),
    title: entry.title || '',
    body_summary: entry.body_summary || '',
    solution_summary: entry.solution_summary || '',
    keywords: Array.isArray(entry.keywords) ? entry.keywords.join(' ') : ''
  };
}

function createSearchIndex(entries) {
  const index = new MiniSearch({
    fields: ['title', 'body_summary', 'solution_summary', 'keywords'],
    storeFields: ['id'],
    searchOptions: {
      boost: { title: 2, keywords: 2, solution_summary: 1.5 },
      prefix: true,
      fuzzy: 0.2
    }
  });
  index.addAll(entries.map(toSearchDocument));
  return index;
}

class LocalKnowledgeBase {
  static SCHEMA_VERSION = 1;

  constructor(kbDir, options = {}) {
    this.kbDir = kbDir;
    this.options = {
      cliVersion: require('../package.json').version,
      env: process.env,
      ...options
    };
    this.manifest = null;
    this.entries = null;
    this.df = null;
    this.searchIndex = null;
  }

  async load() {
    if (this.entries && this.searchIndex) return this;

    this.manifest = loadManifest(this.kbDir);
    this.checkSchemaCompat();
    await this.checkSha256();

    const kbPath = path.join(this.kbDir, 'kb.jsonl');
    let content;
    try {
      content = fs.readFileSync(kbPath, 'utf8');
    } catch (error) {
      throw makeKbError(kbErrors.KB_CORRUPTED, `Knowledge base data is missing or unreadable: ${kbPath}`, {
        path: kbPath,
        cause: error
      });
    }

    this.entries = content
      .split('\n')
      .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
      .filter(item => item.line)
      .map(item => {
        try {
          return JSON.parse(item.line);
        } catch (error) {
          throw makeKbError(
            kbErrors.KB_CORRUPTED,
            `Knowledge base data contains invalid JSON at ${kbPath}:${item.lineNumber}`,
            { path: kbPath, lineNumber: item.lineNumber, cause: error }
          );
        }
      });

    if (this.manifest.indexes && this.manifest.indexes.df) {
      const dfPath = path.join(this.kbDir, this.manifest.indexes.df);
      try {
        this.df = JSON.parse(fs.readFileSync(dfPath, 'utf8'));
      } catch (error) {
        throw makeKbError(kbErrors.KB_CORRUPTED, `Knowledge base DF index is missing or invalid: ${dfPath}`, {
          path: dfPath,
          cause: error
        });
      }
    } else {
      this.df = computeDocFrequency(this.entries);
    }

    const resolvedIssues = this.entries.filter(entry => entry.type === 'resolved_issue');
    this.searchIndex = createSearchIndex(resolvedIssues);
    return this;
  }

  checkSchemaCompat() {
    const manifestSchema = this.manifest.schemaVersion;
    const cliSchema = LocalKnowledgeBase.SCHEMA_VERSION;

    if (manifestSchema > cliSchema) {
      throw makeKbError(kbErrors.KB_SCHEMA_TOO_NEW, 'Knowledge base schema is newer than this CLI supports', {
        manifestSchema,
        cliSchema,
        kbDir: this.kbDir
      });
    }
    if (manifestSchema < cliSchema) {
      throw makeKbError(kbErrors.KB_SCHEMA_TOO_OLD, 'Knowledge base schema is older than this CLI supports', {
        manifestSchema,
        cliSchema,
        kbDir: this.kbDir
      });
    }
    if (compareSemver(this.manifest.minCliVersion, this.options.cliVersion) > 0) {
      throw makeKbError(kbErrors.CLI_TOO_OLD, 'Knowledge base requires a newer ai-issue CLI', {
        minCliVersion: this.manifest.minCliVersion,
        cliVersion: this.options.cliVersion,
        kbDir: this.kbDir
      });
    }
  }

  async checkSha256() {
    const expected = this.manifest.kbSha256;
    const kbPath = path.join(this.kbDir, 'kb.jsonl');
    if (!/^[0-9a-f]{64}$/.test(expected)) {
      throw makeKbError(kbErrors.KB_CORRUPTED, `Knowledge base manifest has invalid kbSha256: ${path.join(this.kbDir, 'manifest.json')}`, {
        path: path.join(this.kbDir, 'manifest.json')
      });
    }

    const result = await verifySha256(kbPath, expected);
    if (!result.ok) {
      throw makeKbError(kbErrors.KB_SHA256_MISMATCH, `Knowledge base SHA256 mismatch: ${kbPath}`, {
        expected: result.expected,
        actual: result.actual,
        path: kbPath
      });
    }
    return result;
  }

  shouldPreferLocal() {
    const envValue = this.options.env && this.options.env.AI_ISSUE_KB_PREFER_LOCAL;
    if (envValue === 'true') return true;
    if (envValue === 'false') return false;
    return this.manifest && this.manifest.qualityGate === 'passed';
  }

  async findSimilarIssues(query, opts = {}) {
    await this.load();
    const { resourceType, service, labels, limit = 5 } = opts;
    const queryText = normalizeQuery(query);
    if (!queryText) return [];

    let candidates = this.entries.filter(entry => entry.type === 'resolved_issue');
    const allResolvedCount = candidates.length;
    candidates = candidates.filter(entry => !resourceType || entry.resource_type === resourceType);
    candidates = candidates.filter(entry => !service || entry.service === service);
    if (labels && labels.length) {
      candidates = candidates.filter(entry => {
        const entryLabels = Array.isArray(entry.labels) ? entry.labels : [];
        return labels.some(label => entryLabels.includes(label));
      });
    }
    if (candidates.length === 0) return [];

    const index = candidates.length === allResolvedCount ? this.searchIndex : createSearchIndex(candidates);
    const byId = new Map(candidates.map(entry => [String(entry.issue_number), entry]));
    const results = index.search(queryText).filter(result => byId.has(String(result.id)));
    if (results.length === 0 || results[0].score < MIN_SCORE) return [];

    return results.slice(0, limit).map(result => {
      const entry = byId.get(String(result.id));
      return {
        issue_number: entry.issue_number,
        title: entry.title,
        score: result.score,
        pr_number: entry.pr_number,
        pr_url: entry.pr_url,
        solution_summary: entry.solution_summary,
        resource_type: entry.resource_type,
        service: entry.service
      };
    });
  }

  async checkExistingResearch(title, body) {
    return this.findSimilarIssues(`${title}\n${body || ''}`, { limit: 3 });
  }

  async getResourceInfo(resourceType) {
    await this.load();
    return this.entries.find(entry => entry.type === 'resource_index' && entry.resource_type === resourceType) || null;
  }
}

module.exports = {
  LocalKnowledgeBase,
  _internal: {
    compareSemver,
    computeDocFrequency,
    stripStackTraceNoise,
    tokenize
  }
};
