#!/usr/bin/env node
// @ts-check
/**
 * Report Validator - MCP Server
 *
 * Validates Phase 1 (research) and Phase 2 (solution) report structure against
 * the canonical templates so the agent can self-check before committing.
 *
 * Section/field name lists are sourced from `../../data/report-sections.json`
 * (single source of truth, also consumed by `lib/report-validator.js` on the
 * CLI side). Validation logic is implemented locally — the skill stays a
 * standalone npm package and never reaches into the parent project's lib/.
 */

const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { wrapToolHandler } = require('../../lib/skills-metrics');

const SECTIONS = require(path.join(__dirname, '..', '..', 'data', 'report-sections.json'));

const PHASE1_REQUIRED_SECTIONS = SECTIONS.PHASE1_REQUIRED_SECTIONS;
const PHASE2_REQUIRED_SECTIONS = SECTIONS.PHASE2_REQUIRED_SECTIONS;
const FORBIDDEN_SECTIONS = SECTIONS.FORBIDDEN_SECTIONS;

/**
 * Validate Phase 1 research report structure.
 * Phase 1 sections are matched as literal `## Section Name` headers
 * (no leading number).
 *
 * @param {string} content
 * @returns {{valid: boolean, missing_sections: string[], forbidden_sections: string[]}}
 */
function validatePhase1Report(content) {
  const text = String(content || '');
  const missing = PHASE1_REQUIRED_SECTIONS.filter((section) => !text.includes(section));
  const forbidden = FORBIDDEN_SECTIONS.filter((section) => text.includes(section));
  return {
    valid: missing.length === 0 && forbidden.length === 0,
    missing_sections: missing,
    forbidden_sections: forbidden,
  };
}

/**
 * Validate Phase 2 solution report structure.
 * Phase 2 sections are matched as `## <N>. <Section Name>` headers (the
 * template numbers them) so we accept any leading integer.
 *
 * @param {string} content
 * @returns {{valid: boolean, missing_sections: string[], forbidden_sections: string[]}}
 */
function validatePhase2Report(content) {
  const text = String(content || '');
  const missing = PHASE2_REQUIRED_SECTIONS.filter((section) => {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^##\\s+\\d+\\.\\s*${escaped}`, 'm');
    return !pattern.test(text);
  });
  const forbidden = FORBIDDEN_SECTIONS.filter((section) => text.includes(section));
  return {
    valid: missing.length === 0 && forbidden.length === 0,
    missing_sections: missing,
    forbidden_sections: forbidden,
  };
}

const server = new Server(
  {
    name: 'report-validator',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'validate_phase1_report',
        description: `Validate Phase 1 research report structure against the canonical template.

Returns:
  { valid: boolean, missing_sections: string[], forbidden_sections: string[] }

Use this to self-check the research report before writing it to disk so any
missing required sections (e.g. "## Code Location") or forbidden sections
(e.g. "## Solution Summary") are caught early.`,
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Full markdown content of the Phase 1 research report',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'validate_phase2_report',
        description: `Validate Phase 2 solution report structure against the canonical template.

Returns:
  { valid: boolean, missing_sections: string[], forbidden_sections: string[] }

Phase 2 section headers are expected to be numbered (e.g. "## 1. Problem
Analysis"). Forbidden sections (e.g. "## Technical Implementation",
"## Files Changed") are flagged regardless of numbering.`,
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Full markdown content of the Phase 2 solution report',
            },
          },
          required: ['content'],
        },
      },
    ],
  };
});

async function handleToolRequest(request) {
  const { name, arguments: args } = request.params;
  try {
    let result;
    if (name === 'validate_phase1_report') {
      result = validatePhase1Report(args && args.content);
    } else if (name === 'validate_phase2_report') {
      result = validatePhase2Report(args && args.content);
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error validating report: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

server.setRequestHandler(CallToolRequestSchema, wrapToolHandler(handleToolRequest, 'report-validator'));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Report Validator MCP Server running on stdio');
}

if (require.main === module) {
  main().catch(console.error);
}

// Exports for unit tests (not used by MCP runtime)
module.exports = {
  validatePhase1Report,
  validatePhase2Report,
  handleToolRequest,
  __sections: SECTIONS,
};
