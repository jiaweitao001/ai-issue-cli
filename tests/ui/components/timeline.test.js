const { renderTimelineLines } = require('../../../lib/ui/components/timeline');

describe('lib/ui/components/timeline', () => {
  it('renders running, success, and failure lines', () => {
    const lines = renderTimelineLines({
      order: ['phase1', 'phase2', 'review'],
      tasks: {
        phase1: { taskId: 'phase1', label: 'Phase 1', status: 'success', durationMs: 1500 },
        phase2: { taskId: 'phase2', label: 'Phase 2', status: 'running' },
        review: { taskId: 'review', label: 'Review', status: 'failure', durationMs: 250 }
      }
    });

    expect(lines).toEqual([
      '✓ Phase 1 (1.5s)',
      '▶ Phase 2',
      '✗ Review (0.3s)'
    ]);
  });

  it('returns empty lines for missing state', () => {
    expect(renderTimelineLines(null)).toEqual([]);
  });
});
