/**
 * Tests for lib/display-helpers.js
 */

const { STATUS_STYLE, RECOMMENDATION_STYLE } = require('../lib/display-helpers');

describe('display-helpers', () => {
  describe('STATUS_STYLE', () => {
    it('should define all pipeline statuses', () => {
      const expectedStatuses = ['triaged', 'queued', 'solving', 'solved', 'pr_created', 'rejected', 'failed'];
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
});
