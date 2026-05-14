const { runWizard } = require('../../../lib/ui/components/wizard');

describe('lib/ui/components/wizard', () => {
  it('collects step values into final state', async () => {
    const result = await runWizard([
      { id: 'agent', prompt: () => 'copilot' },
      { id: 'repoPath', prompt: (state) => `${state.agent}:/repo` },
      { id: 'installKb', prompt: () => true }
    ]);

    expect(result).toEqual({
      cancelled: false,
      values: {
        agent: 'copilot',
        repoPath: 'copilot:/repo',
        installKb: true
      }
    });
  });

  it('starts from initial values', async () => {
    const result = await runWizard([
      { id: 'repoPath', prompt: (state) => state.repoPath }
    ], {
      initialValues: { repoPath: '/existing' }
    });

    expect(result.cancelled).toBe(false);
    expect(result.values.repoPath).toBe('/existing');
  });

  it('returns cancelled when a prompt returns null', async () => {
    const result = await runWizard([
      { id: 'agent', prompt: () => null },
      { id: 'repoPath', prompt: () => '/repo' }
    ]);

    expect(result.cancelled).toBe(true);
    expect(result.cancelledAt).toBe('agent');
    expect(result.values).toEqual({});
  });

  it('returns cancelled when validation fails', async () => {
    const result = await runWizard([
      {
        id: 'repoPath',
        prompt: () => '/missing',
        validate: () => 'missing'
      }
    ]);

    expect(result.cancelled).toBe(true);
    expect(result.cancelledAt).toBe('repoPath');
    expect(result.values).toEqual({});
  });
});
