// @ts-check

const fs = require('fs');
const path = require('path');

/**
 * @param {string} repoPath
 * @returns {{ supported: boolean, reason?: string }}
 */
function detectAzurermRepo(repoPath) {
  const goModPath = path.join(repoPath, 'go.mod');
  const makefilePath = path.join(repoPath, 'GNUmakefile');
  if (!fs.existsSync(goModPath)) {
    return { supported: false, reason: 'verify-loop skipped: go.mod not found; only terraform-provider-azurerm is supported.' };
  }
  if (!fs.existsSync(makefilePath)) {
    return { supported: false, reason: 'verify-loop skipped: GNUmakefile not found; only terraform-provider-azurerm is supported.' };
  }
  const goMod = fs.readFileSync(goModPath, 'utf8');
  if (!/^module\s+github\.com\/hashicorp\/terraform-provider-azurerm\s*$/m.test(goMod)) {
    return { supported: false, reason: 'verify-loop skipped: repository is not github.com/hashicorp/terraform-provider-azurerm.' };
  }
  return { supported: true };
}

module.exports = {
  detectAzurermRepo
};
