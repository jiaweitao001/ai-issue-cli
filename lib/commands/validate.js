/**
 * Validate command implementation
 * Validates report format against mandatory templates
 */

const fs = require('fs');
const path = require('path');
const { log, error, success, warning, info, chalk } = require('../logger');
const { validateReport, formatValidationResult } = require('../report-validator');
const { loadConfig } = require('../config');

/**
 * Find report files in workspace directory
 * @param {string} workDir - Workspace directory path
 * @param {string} issueNumber - Optional issue number to filter
 * @returns {string[]} Array of report file paths
 */
function findReportFiles(workDir, issueNumber = null) {
  if (!fs.existsSync(workDir)) {
    return [];
  }

  const files = fs.readdirSync(workDir);
  const reportFiles = files.filter(f => {
    const isReport = f.endsWith('-research.md') || 
                     f.endsWith('-analysis-and-solution.md') ||
                     f.endsWith('-solution.md');
    
    if (!isReport) return false;
    if (issueNumber) {
      return f.includes(`issue-${issueNumber}`);
    }
    return true;
  });

  return reportFiles.map(f => path.join(workDir, f));
}

/**
 * Validate a single report file
 * @param {string} filePath - Path to report file
 * @returns {{ valid: boolean, type: string, errors: string[], warnings: string[], filePath: string }}
 */
function validateReportFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);
  const result = validateReport(content, filename);
  return {
    ...result,
    filePath
  };
}

/**
 * Command: validate
 * Validates report files against mandatory templates
 * @param {string} target - Issue number or file path
 * @param {object} options - Command options
 */
async function cmdValidate(target, options = {}) {
  log('');
  log(chalk.bold.cyan('📋 Report Format Validation'));
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');

  let filesToValidate = [];

  // Determine what to validate
  if (target && fs.existsSync(target) && fs.statSync(target).isFile()) {
    // Direct file path provided
    filesToValidate = [target];
  } else {
    // Try to find reports in workspace
    const config = loadConfig();
    const workDir = config.workDir || process.cwd();
    
    if (target) {
      // Issue number provided
      filesToValidate = findReportFiles(workDir, target);
      if (filesToValidate.length === 0) {
        error(`No report files found for issue #${target}`);
        info(`Expected files like: issue-${target}-research.md or issue-${target}-analysis-and-solution.md`);
        process.exit(1);
      }
    } else {
      // Validate all reports in workspace
      filesToValidate = findReportFiles(workDir);
      if (filesToValidate.length === 0) {
        warning('No report files found in workspace');
        info('Report files should end with -research.md or -analysis-and-solution.md');
        process.exit(0);
      }
    }
  }

  info(`Found ${filesToValidate.length} report file(s) to validate\n`);

  let allValid = true;
  const results = [];

  for (const filePath of filesToValidate) {
    const result = validateReportFile(filePath);
    results.push(result);

    const filename = path.basename(filePath);
    log(chalk.bold(`📄 ${filename}`));
    log(chalk.grey(`   Type: ${result.type}`));

    if (result.valid) {
      success(`   Status: ✅ VALID`);
    } else {
      error(`   Status: ❌ INVALID`);
      allValid = false;
    }

    if (result.errors.length > 0) {
      log(chalk.red('   Errors:'));
      result.errors.forEach(err => {
        log(chalk.red(`     • ${err}`));
      });
    }

    if (result.warnings.length > 0 && options.showWarnings !== false) {
      log(chalk.yellow('   Warnings:'));
      result.warnings.forEach(warn => {
        log(chalk.yellow(`     • ${warn}`));
      });
    }

    log('');
  }

  // Summary
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  const validCount = results.filter(r => r.valid).length;
  const totalCount = results.length;

  if (allValid) {
    success(`✅ All ${totalCount} report(s) passed validation`);
  } else {
    error(`❌ ${totalCount - validCount} of ${totalCount} report(s) failed validation`);
  }

  log('');

  // Return results for programmatic use
  return {
    allValid,
    results
  };
}

module.exports = {
  cmdValidate,
  findReportFiles,
  validateReportFile
};
