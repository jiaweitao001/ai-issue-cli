// @ts-check
const PII_PATTERNS = {
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  githubToken: /\bgh[ps]_[A-Za-z0-9]{20,}/g,
  awsAccessKey: /\bAKIA[0-9A-Z]{16}\b/g,
  awsSecret: /\b[A-Za-z0-9/+=]{40}\b/g,
  azureConnString: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[^;]+/gi,
  gcpServiceAccount: /"type"\s*:\s*"service_account"[\s\S]*?"private_key"\s*:\s*"[^"]+"/g,
  privateKey: /-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END .*?PRIVATE KEY-----/g,
  internalUrl: /https?:\/\/[^\s)\]>]*?(internal|corp|local)[^\s)\]>]*/gi,
  inlineSecret: /\b(?:bearer|token|password|secret|api[_-]?key)\s*[:=]\s*\S+/gi
};

const REDACTIONS = {
  email: '[email-redacted]',
  githubToken: '[token-redacted]',
  awsAccessKey: '[aws-key-redacted]',
  awsSecret: '[aws-secret-redacted]',
  azureConnString: '[azure-connection-redacted]',
  gcpServiceAccount: '[gcp-service-account-redacted]',
  privateKey: '[private-key-redacted]',
  internalUrl: '[internal-url-redacted]',
  inlineSecret: '$1 [redacted]'
};

function sanitize(text) {
  if (!text) return text;
  let result = String(text);
  for (const [name, pattern] of Object.entries(PII_PATTERNS)) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, REDACTIONS[name]);
  }
  return result;
}

module.exports = { sanitize, PII_PATTERNS, REDACTIONS };
