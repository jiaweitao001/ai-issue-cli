const { renderDashboardLines } = require('../../../lib/ui/components/dashboard');

describe('lib/ui/components/dashboard', () => {
  it('renders issue dashboard rows', () => {
    const lines = renderDashboardLines({
      order: ['issue-1', 'issue-2', 'issue-3'],
      rows: {
        'issue-1': { taskId: 'issue-1', issue: '1', label: 'Issue #1', status: 'running', agent: 'copilot', lastStep: 'Phase 2' },
        'issue-2': { taskId: 'issue-2', issue: '2', label: 'Issue #2', status: 'success', durationMs: 2500, agent: 'claude-code', lastStep: 'Evaluation' },
        'issue-3': { taskId: 'issue-3', issue: '3', label: 'Issue #3', status: 'failure', durationMs: 500, lastStep: 'Phase 1' }
      }
    });

    expect(lines).toEqual([
      '▶ #1  running  -  copilot  Phase 2',
      '✓ #2  success  2.5s  claude-code  Evaluation',
      '✗ #3  failure  0.5s  -  Phase 1'
    ]);
  });

  it('returns empty lines for missing state', () => {
    expect(renderDashboardLines(null)).toEqual([]);
  });
});
