#!/usr/bin/env node
/**
 * Terraform Validator - MCP Server
 *
 * Pre-commit static checks for hashicorp/terraform-provider-azurerm style
 * Go code (B-MVP: field-naming consistency between Schema declarations and
 * ResourceData accessors).
 *
 * Public tool: validate_terraform_changes({repoPath, files[]})
 *   → {findings: [{rule, file, line, severity, message}], summary: string}
 *
 * Hard input contract (rubber-duck v5 — see SKILLS_ENHANCEMENT_PLAN §B-MVP):
 *   - repoPath: required, must be an existing directory
 *   - files[]: required and non-empty (no whole-repo scan)
 *   - each file in files[] must resolve under repoPath (no `../escape`)
 *   - any input violation → MCP error with `INVALID_INPUT` style message
 *
 * Self-skip: if files[] contains no terraform-provider files
 * (`*_resource.go` / `*_resource_gen.go` / `*_data_source.go`), the validator
 * returns `{findings: [], summary: "no terraform provider files in scope,
 * validator skipped"}` so non-Terraform repos see a clean no-op.
 *
 * Skipped on purpose in B-MVP (documented limitations — see README):
 *   - dot-navigation keys like `d.Get("network_rule_set.0.bypass")`
 *   - functions that take multiple `*ResourceData` parameters
 *   - cross-SDK struct field validation (LLM uses grep_search instead)
 */

const fs = require('fs');
const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const TERRAFORM_FILE_SUFFIXES = ['_resource.go', '_resource_gen.go', '_data_source.go'];

/**
 * Walk forward from `text[openIdx]` (which must be `{`) and find the index
 * of the matching `}`. Skips Go string literals (double-quoted with escapes,
 * raw backtick strings) and both line/block comments so braces inside those
 * don't unbalance the parser.
 */
function findMatchingBrace(text, openIdx) {
  if (text[openIdx] !== '{') return -1;
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const eol = text.indexOf('\n', i);
      i = eol === -1 ? text.length : eol + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '"') { i++; break; }
        if (text[i] === '\n') break;
        i++;
      }
      continue;
    }
    if (c === '`') {
      const close = text.indexOf('`', i + 1);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

/**
 * Inside a Schema block (text[0]==='{', text[end]==='}'), extract the keys
 * defined at depth 1 only — any nested `{...}` block is brace-skipped so
 * fields of a nested `Elem: &pluginsdk.Resource{Schema: ...}` do NOT bleed
 * up into the outer schema's key list.
 */
function extractSchemaKeysFromBlock(blockText) {
  const keys = [];
  let i = 1; // step past outer {
  const end = blockText.length - 1;
  while (i < end) {
    const c = blockText[i];
    if (c === '/' && blockText[i + 1] === '/') {
      const eol = blockText.indexOf('\n', i);
      i = eol === -1 ? end : eol + 1;
      continue;
    }
    if (c === '/' && blockText[i + 1] === '*') {
      const close = blockText.indexOf('*/', i + 2);
      i = close === -1 ? end : close + 2;
      continue;
    }
    if (c === '`') {
      const close = blockText.indexOf('`', i + 1);
      i = close === -1 ? end : close + 1;
      continue;
    }
    if (c === '{') {
      const close = findMatchingBrace(blockText, i);
      i = close === -1 ? end : close + 1;
      continue;
    }
    if (c === '"') {
      const m = blockText.slice(i).match(/^"([^"]+)"\s*:/);
      if (m) {
        keys.push(m[1]);
        i += m[0].length;
        continue;
      }
      i++;
      while (i < end) {
        if (blockText[i] === '\\') { i += 2; continue; }
        if (blockText[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return keys;
}

/**
 * Find every `Schema: map[string]*<schema|pluginsdk>.Schema {...}` literal
 * in the file and return their byte ranges plus their direct-child keys.
 * Top-level vs nested distinction is computed by the caller via range
 * containment.
 */
function findSchemaLiterals(content) {
  const literals = [];
  const re = /Schema\s*:\s*map\[string\]\*(?:schema|pluginsdk)\.Schema\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const openIdx = content.indexOf('{', m.index);
    if (openIdx === -1) continue;
    const closeIdx = findMatchingBrace(content, openIdx);
    if (closeIdx === -1) continue;
    const block = content.slice(openIdx, closeIdx + 1);
    literals.push({
      start: openIdx,
      end: closeIdx,
      keys: extractSchemaKeysFromBlock(block),
    });
  }
  return literals;
}

/**
 * Top-level Schema literals are those NOT contained inside the byte range
 * of any other Schema literal — i.e. they are not nested under an outer
 * Schema's `Elem: &pluginsdk.Resource{Schema: ...}`.
 */
function topLevelSchemas(literals) {
  return literals.filter(s =>
    !literals.some(other => other !== s && other.start < s.start && other.end > s.end)
  );
}

/**
 * Collect all parameter names whose declared type is `*schema.ResourceData`
 * or `*pluginsdk.ResourceData`. The set is global to the file because
 * azurerm convention is `d` everywhere; per-function scoping is a known
 * B-MVP limitation (see README).
 */
function findResourceDataVarnames(content) {
  const set = new Set();
  const re = /\b(\w+)\s+\*(?:schema|pluginsdk)\.ResourceData\b/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    set.add(m[1]);
  }
  return set;
}

/**
 * Find every `<varname>.(Set|Get|GetOk|GetOkExists)("<key>"` call site.
 * Line number is derived by counting `\n` up to the match.
 */
function findSetGetCalls(content) {
  const calls = [];
  const re = /\b(\w+)\.(Set|Get|GetOk|GetOkExists)\(\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const line = (content.slice(0, m.index).match(/\n/g) || []).length + 1;
    calls.push({
      varname: m[1],
      method: m[2],
      key: m[3],
      line,
    });
  }
  return calls;
}

function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function camelToSnake(s) {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase();
}
/** Toggle snake_case ↔ camelCase if applicable; returns null if neither shape. */
function toggleNamingStyle(key) {
  if (key.includes('_')) return snakeToCamel(key);
  if (/[A-Z]/.test(key)) return camelToSnake(key);
  return null;
}

/**
 * Run the field-naming consistency checks on a single file's text.
 * Returns an array of finding objects (without `file` — caller injects it).
 */
function checkFieldNamingForFile(content) {
  const findings = [];
  const literals = findSchemaLiterals(content);
  const tops = topLevelSchemas(literals);
  const topKeys = new Set();
  for (const s of tops) {
    for (const k of s.keys) topKeys.add(k);
  }

  // No Schema literal at all → not a resource-defining file, skip
  if (literals.length === 0) return findings;

  const rdVars = findResourceDataVarnames(content);
  if (rdVars.size === 0) return findings;

  const calls = findSetGetCalls(content);
  for (const c of calls) {
    if (!rdVars.has(c.varname)) continue;
    if (c.key.includes('.')) continue; // dot-nav skipped per plan
    if (topKeys.has(c.key)) continue;

    const alt = toggleNamingStyle(c.key);
    if (alt && topKeys.has(alt)) {
      findings.push({
        rule: 'field-naming-case',
        line: c.line,
        severity: 'medium',
        message:
          `Schema declares "${alt}" but ${c.varname}.${c.method}() uses ` +
          `"${c.key}". Naming style drift — align the accessor with the schema key.`,
      });
    } else {
      findings.push({
        rule: 'field-naming-undeclared',
        line: c.line,
        severity: 'high',
        message:
          `${c.varname}.${c.method}("${c.key}") references a key not declared ` +
          `in any top-level Schema in this file. Either add it to Schema or ` +
          `correct the spelling.`,
      });
    }
  }
  return findings;
}

/**
 * Resolve a possibly-relative file path under repoPath and verify it does
 * not escape via `..` segments. Throws if the path is outside repoPath.
 * Returns the absolute path.
 */
function resolveUnderRepo(repoPath, file) {
  const abs = path.isAbsolute(file) ? file : path.resolve(repoPath, file);
  const repoReal = path.resolve(repoPath);
  const rel = path.relative(repoReal, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`INVALID_INPUT: file "${file}" resolves outside repoPath`);
  }
  return abs;
}

function isTerraformProviderFile(filePath) {
  return TERRAFORM_FILE_SUFFIXES.some(suffix => filePath.endsWith(suffix));
}

/**
 * Top-level entry point invoked by the MCP tool.
 */
async function validateTerraformChanges(args) {
  if (!args || typeof args !== 'object') {
    throw new Error('INVALID_INPUT: arguments object required');
  }
  const { repoPath, files } = args;
  if (!repoPath || typeof repoPath !== 'string') {
    throw new Error('INVALID_INPUT: repoPath required (string)');
  }
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw new Error(`INVALID_INPUT: repoPath does not exist or is not a directory: ${repoPath}`);
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('INVALID_INPUT: files[] required (non-empty array of modified file paths)');
  }
  for (const f of files) {
    if (typeof f !== 'string' || !f) {
      throw new Error('INVALID_INPUT: each file in files[] must be a non-empty string');
    }
  }

  // Resolve paths up-front so `../escape` attempts fail fast
  const resolved = files.map(f => ({ original: f, abs: resolveUnderRepo(repoPath, f) }));

  const tfFiles = resolved.filter(r => isTerraformProviderFile(r.abs));
  if (tfFiles.length === 0) {
    return {
      findings: [],
      summary: 'no terraform provider files in scope, validator skipped',
    };
  }

  const findings = [];
  for (const { original, abs } of tfFiles) {
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      findings.push({
        rule: 'io-error',
        file: original,
        line: 0,
        severity: 'high',
        message: `Failed to read file: ${err.message}`,
      });
      continue;
    }
    const fileFindings = checkFieldNamingForFile(content);
    for (const f of fileFindings) findings.push({ ...f, file: original });
  }

  const counts = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});
  const summary =
    `Validated ${tfFiles.length} terraform file(s); ` +
    `found ${findings.length} finding(s) ` +
    `(high=${counts.high || 0}, medium=${counts.medium || 0}).`;

  return { findings, summary };
}

const server = new Server(
  {
    name: 'terraform-validator',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'validate_terraform_changes',
      description: `Pre-commit validator for terraform-provider-azurerm style Go changes (B-MVP: field-naming consistency).

Use this in Phase 2 (and rubber-duck) BEFORE committing if the changeset includes \`*_resource.go\` / \`*_resource_gen.go\` / \`*_data_source.go\` files. Non-terraform-provider repos can safely skip the call — the validator self-skips when no matching files are present.

Input:
  - repoPath (string, required): absolute path to the repo root
  - files (string[], required, non-empty): list of modified files (paths
    relative to repoPath are accepted)

Output:
  {
    findings: [
      {
        rule: 'field-naming-undeclared' | 'field-naming-case',
        file: string,
        line: number,
        severity: 'high' | 'medium',
        message: string
      }
    ],
    summary: string
  }

Findings:
  - field-naming-undeclared (high): \`d.Set/Get("key")\` references a key
    not declared in any top-level Schema in the file. Likely a typo or a
    forgotten Schema entry; must be fixed before commit.
  - field-naming-case (medium): The schema declares the snake_case
    counterpart but the accessor uses camelCase (or vice versa). Fix to
    align with the schema spelling.

Known B-MVP limitations (documented in README):
  - dot-navigation keys (e.g. "network_rule_set.0.bypass") are skipped
  - functions with multiple *ResourceData parameters not handled
  - cross-SDK struct field validation is out of scope (use grep_search)`,
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: {
            type: 'string',
            description: 'Absolute path to repository root',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Modified file paths (relative to repoPath or absolute under it)',
          },
        },
        required: ['repoPath', 'files'],
      },
    },
  ],
}));

async function handleToolRequest(request) {
  const { name, arguments: args } = request.params;
  if (name !== 'validate_terraform_changes') {
    return {
      content: [{ type: 'text', text: `Error: unknown tool ${name}` }],
      isError: true,
    };
  }
  try {
    const result = await validateTerraformChanges(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error validating terraform changes: ${err.message}` }],
      isError: true,
    };
  }
}

server.setRequestHandler(CallToolRequestSchema, handleToolRequest);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Terraform Validator MCP Server running on stdio');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  validateTerraformChanges,
  handleToolRequest,
  // Internals exported for unit tests
  __internal: {
    findMatchingBrace,
    extractSchemaKeysFromBlock,
    findSchemaLiterals,
    topLevelSchemas,
    findResourceDataVarnames,
    findSetGetCalls,
    checkFieldNamingForFile,
    resolveUnderRepo,
    isTerraformProviderFile,
    toggleNamingStyle,
  },
};
