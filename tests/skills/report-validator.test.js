const path = require('path');

// Mock MCP SDK so requiring the skill module does not blow up.
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  })),
}), { virtual: true });
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}), { virtual: true });
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
}), { virtual: true });

const SKILL_PATH = path.resolve(__dirname, '../../skills/report-validator/index.js');

describe('report-validator skill', () => {
  let validatePhase1Report;
  let validatePhase2Report;
  let handleToolRequest;
  let __sections;

  beforeAll(() => {
    ({ validatePhase1Report, validatePhase2Report, handleToolRequest, __sections } = require(SKILL_PATH));
  });

  describe('shared data file', () => {
    it('reads the same data/report-sections.json that lib/report-validator.js consumes', () => {
      const libExports = require('../../lib/report-validator');
      expect(__sections.PHASE1_REQUIRED_SECTIONS).toEqual(libExports.PHASE1_REQUIRED_SECTIONS);
      expect(__sections.PHASE2_REQUIRED_SECTIONS).toEqual(libExports.PHASE2_REQUIRED_SECTIONS);
      expect(__sections.FORBIDDEN_SECTIONS).toEqual(libExports.FORBIDDEN_SECTIONS);
    });
  });

  describe('validatePhase1Report', () => {
    function buildValidPhase1() {
      return __sections.PHASE1_REQUIRED_SECTIONS.map(
        (s, i) => `${s}\n\nSection body number ${i}.\n`
      ).join('\n');
    }

    it('returns valid=true when all required sections present and no forbidden', () => {
      const result = validatePhase1Report(buildValidPhase1());
      expect(result).toEqual({
        valid: true,
        missing_sections: [],
        forbidden_sections: [],
      });
    });

    it('flags missing required section', () => {
      const content = buildValidPhase1().replace('## Code Location\n', '');
      const result = validatePhase1Report(content);
      expect(result.valid).toBe(false);
      expect(result.missing_sections).toContain('## Code Location');
      expect(result.forbidden_sections).toEqual([]);
    });

    it('flags multiple missing sections at once', () => {
      const result = validatePhase1Report('# Issue #123\n\nempty body');
      expect(result.valid).toBe(false);
      expect(result.missing_sections.length).toBe(__sections.PHASE1_REQUIRED_SECTIONS.length);
    });

    it('flags forbidden section', () => {
      const content = buildValidPhase1() + '\n## Solution Summary\n\nshould not be here\n';
      const result = validatePhase1Report(content);
      expect(result.valid).toBe(false);
      expect(result.forbidden_sections).toContain('## Solution Summary');
      expect(result.missing_sections).toEqual([]);
    });

    it('handles null/undefined/empty content gracefully', () => {
      expect(validatePhase1Report(null).valid).toBe(false);
      expect(validatePhase1Report(undefined).valid).toBe(false);
      expect(validatePhase1Report('').valid).toBe(false);
    });
  });

  describe('validatePhase2Report', () => {
    function buildValidPhase2() {
      return __sections.PHASE2_REQUIRED_SECTIONS.map(
        (s, i) => `## ${i + 1}. ${s}\n\nSection body number ${i}.\n`
      ).join('\n');
    }

    it('returns valid=true with numbered headers', () => {
      const result = validatePhase2Report(buildValidPhase2());
      expect(result).toEqual({
        valid: true,
        missing_sections: [],
        forbidden_sections: [],
      });
    });

    it('flags missing numbered section', () => {
      const content = buildValidPhase2().replace(/## \d+\. Problem Analysis[\s\S]*?(?=##|$)/, '');
      const result = validatePhase2Report(content);
      expect(result.valid).toBe(false);
      expect(result.missing_sections).toContain('Problem Analysis');
    });

    it('rejects unnumbered Phase 2 section header', () => {
      // Phase 2 template numbers all sections; an unnumbered header should
      // count as missing because the matcher requires `## <N>.`
      const content = buildValidPhase2().replace('## 1. Problem Analysis', '## Problem Analysis');
      const result = validatePhase2Report(content);
      expect(result.valid).toBe(false);
      expect(result.missing_sections).toContain('Problem Analysis');
    });

    it('flags forbidden section even with valid required sections', () => {
      const content = buildValidPhase2() + '\n## Files Changed\n\nshould not be here\n';
      const result = validatePhase2Report(content);
      expect(result.valid).toBe(false);
      expect(result.forbidden_sections).toContain('## Files Changed');
    });

    it('accepts arbitrary numbering (## 7. Problem Analysis is fine)', () => {
      const content = __sections.PHASE2_REQUIRED_SECTIONS.map(
        (s, i) => `## ${(i + 7) * 3}. ${s}\n\nSection body ${i}.\n`
      ).join('\n');
      const result = validatePhase2Report(content);
      expect(result.valid).toBe(true);
    });
  });

  describe('handleToolRequest (MCP plumbing)', () => {
    function call(name, args) {
      return handleToolRequest({ params: { name, arguments: args } });
    }

    it('routes validate_phase1_report to phase 1 validator', async () => {
      const res = await call('validate_phase1_report', { content: 'empty' });
      expect(res.isError).toBeUndefined();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.valid).toBe(false);
      expect(parsed.missing_sections.length).toBeGreaterThan(0);
    });

    it('routes validate_phase2_report to phase 2 validator', async () => {
      const res = await call('validate_phase2_report', { content: 'empty' });
      expect(res.isError).toBeUndefined();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.valid).toBe(false);
    });

    it('returns isError=true for unknown tool name', async () => {
      const res = await call('not_a_tool', {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/Unknown tool/);
    });

    it('handles missing arguments without throwing (treats as empty content)', async () => {
      const res = await call('validate_phase1_report', undefined);
      expect(res.isError).toBeUndefined();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.valid).toBe(false);
    });
  });
});
