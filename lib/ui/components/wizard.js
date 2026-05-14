// @ts-check

/**
 * Minimal wizard state machine for command flows that collect multiple fields
 * before writing anything to disk.
 */

/**
 * @typedef {Object} WizardStep
 * @property {string} id
 * @property {(state: Record<string, any>) => Promise<any>|any} prompt
 * @property {(value: any, state: Record<string, any>) => string|null|undefined} [validate]
 */

/**
 * @typedef {Object} WizardResult
 * @property {boolean} cancelled
 * @property {Record<string, any>} values
 * @property {string} [cancelledAt]
 */

/**
 * @param {WizardStep[]} steps
 * @param {{ initialValues?: Record<string, any> }} [opts]
 * @returns {Promise<WizardResult>}
 */
async function runWizard(steps, opts) {
  const values = { ...((opts && opts.initialValues) || {}) };
  for (const step of steps || []) {
    const value = await step.prompt(values);
    if (value == null) {
      return { cancelled: true, values, cancelledAt: step.id };
    }
    const validationError = step.validate ? step.validate(value, values) : null;
    if (validationError) {
      return { cancelled: true, values, cancelledAt: step.id };
    }
    values[step.id] = value;
  }
  return { cancelled: false, values };
}

module.exports = {
  runWizard
};
