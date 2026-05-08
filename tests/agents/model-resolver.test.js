const {
  DEFAULT_MODELS,
  getAgentDefaultModel,
  resolveModelForAgent
} = require('../../lib/agents/model-resolver');

describe('model-resolver', () => {
  it('uses explicit override first', () => {
    const config = {
      model: 'copilot-top-level',
      agents: { 'claude-code': { model: 'claude-configured' } }
    };

    expect(resolveModelForAgent(config, 'claude-code', 'cli-model')).toBe('cli-model');
  });

  it('uses per-agent model before top-level model', () => {
    const config = {
      model: 'copilot-top-level',
      agents: { copilot: { model: 'copilot-agent-model' } }
    };

    expect(resolveModelForAgent(config, 'copilot')).toBe('copilot-agent-model');
  });

  it('uses top-level model only for copilot', () => {
    const config = { model: 'copilot-top-level' };

    expect(resolveModelForAgent(config, 'copilot')).toBe('copilot-top-level');
    expect(resolveModelForAgent(config, 'claude-code')).toBe(DEFAULT_MODELS['claude-code']);
  });

  it('falls back to agent default model', () => {
    expect(resolveModelForAgent({}, 'copilot')).toBe(DEFAULT_MODELS.copilot);
    expect(resolveModelForAgent({}, 'claude-code')).toBe(DEFAULT_MODELS['claude-code']);
  });

  it('throws for unknown default agent', () => {
    expect(() => getAgentDefaultModel('unknown')).toThrow('Unknown agent');
  });
});
