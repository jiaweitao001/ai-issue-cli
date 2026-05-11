/**
 * Tests for lib/display-helpers.js
 */

// Mock logger (display-helpers now imports it for renderMetrics*)
const { mockCreateLogger } = require('./helpers/mock-logger');
jest.mock('../lib/logger', () => mockCreateLogger());

const { STATUS_STYLE, RECOMMENDATION_STYLE, renderMetricsTable, renderMetricsList } = require('../lib/display-helpers');
const { log } = require('../lib/logger');

describe('display-helpers', () => {
  describe('STATUS_STYLE', () => {
    it('should define all pipeline statuses', () => {
      const expectedStatuses = ['triaged', 'queued', 'solving', 'solved', 'skipped', 'pr_created', 'rejected', 'failed'];
      for (const status of expectedStatuses) {
        expect(STATUS_STYLE[status]).toBeDefined();
        expect(STATUS_STYLE[status].emoji).toBeDefined();
        expect(STATUS_STYLE[status].color).toBeDefined();
      }
    });

    it('should have string emoji values', () => {
      for (const [, style] of Object.entries(STATUS_STYLE)) {
        expect(typeof style.emoji).toBe('string');
        expect(style.emoji.length).toBeGreaterThan(0);
      }
    });

    it('should have string color values', () => {
      for (const [, style] of Object.entries(STATUS_STYLE)) {
        expect(typeof style.color).toBe('string');
        expect(style.color.length).toBeGreaterThan(0);
      }
    });
  });

  describe('RECOMMENDATION_STYLE', () => {
    it('should define all recommendation types', () => {
      const expectedTypes = ['PROCEED', 'SKIP', 'NEEDS_HUMAN'];
      for (const type of expectedTypes) {
        expect(RECOMMENDATION_STYLE[type]).toBeDefined();
        expect(RECOMMENDATION_STYLE[type].emoji).toBeDefined();
        expect(RECOMMENDATION_STYLE[type].color).toBeDefined();
      }
    });

    it('should have distinct emojis for each recommendation', () => {
      const emojis = Object.values(RECOMMENDATION_STYLE).map(s => s.emoji);
      const uniqueEmojis = new Set(emojis);
      expect(uniqueEmojis.size).toBe(emojis.length);
    });

    it('should have string emoji and color values', () => {
      for (const [, style] of Object.entries(RECOMMENDATION_STYLE)) {
        expect(typeof style.emoji).toBe('string');
        expect(typeof style.color).toBe('string');
      }
    });
  });

  describe('renderMetricsTable', () => {
    beforeEach(() => jest.clearAllMocks());

    const engineers = [
      {
        owner: 'alice',
        total_issues: 15,
        solved: 12,
        failed: 1,
        solve_rate: 0.923,
        avg_response_time_hours: 1.8,
        avg_solve_time_hours: 12.5,
      },
      {
        owner: 'bob',
        total_issues: 14,
        solved: 10,
        failed: 2,
        solve_rate: 0.833,
        avg_response_time_hours: 3.1,
        avg_solve_time_hours: 22.0,
      },
    ];

    it('should render header and rows', () => {
      renderMetricsTable(engineers);

      // Header + 2 engineer rows = at least 4 log calls
      expect(log.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('should include engineer names in output', () => {
      renderMetricsTable(engineers);

      const output = log.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('alice');
      expect(output).toContain('bob');
    });

    it('should handle null time values', () => {
      renderMetricsTable([{
        owner: 'carol',
        total_issues: 3,
        solved: 0,
        failed: 0,
        solve_rate: 0,
        avg_response_time_hours: null,
        avg_solve_time_hours: null,
      }]);

      const output = log.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('carol');
      // Should not throw, null rendered as '-'
    });
  });

  describe('renderMetricsList', () => {
    beforeEach(() => jest.clearAllMocks());

    it('should render list format for narrow terminals', () => {
      renderMetricsList([{
        owner: 'alice',
        total_issues: 15,
        solved: 12,
        failed: 1,
        solve_rate: 0.923,
        avg_response_time_hours: 1.8,
        avg_solve_time_hours: 12.5,
      }]);

      const output = log.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('alice');
      expect(output).toContain('15');
    });
  });
});
