import { spawn } from 'node:child_process';
// curl preserves the managed HTTPS proxy and CA trust. No redirects or retries.
// The key is passed via stdin config, never arguments, environment dumps or files.
export function decodeResponse(output, code, oversized = false, key = '') {
  const split = output.lastIndexOf('\n');
  const status = Number(output.slice(split + 1));
  if (oversized) throw new Error('Anthropic response size exceeded');
  if (code && code !== 22) throw new Error(`Anthropic transport failed (curl ${code})`);
  let body;
  try { body = JSON.parse(output.slice(0, split)); } catch { throw new Error(`Invalid provider JSON (HTTP ${status})`); }
  if (status < 200 || status >= 300) {
    const kind = ['authentication_error', 'permission_error', 'invalid_request_error', 'not_found_error', 'rate_limit_error', 'overloaded_error'].includes(body.error?.type) ? body.error.type : 'provider_error';
    const error = new Error(`Anthropic HTTP ${status} (${kind})`);
    if (status === 400 && typeof body.error?.message === 'string') {
      let detail = body.error.message;
      if (key) detail = detail.split(key).join('[REDACTED]');
      error.safeDetail = detail.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 800);
    }
    throw error;
  }
  return body;
}
export function workspaceHeader(value) {
  if (!value) return [];
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new Error('Invalid ANTHROPIC_WORKSPACE_ID');
  return [`header = ${JSON.stringify('anthropic-workspace-id: ' + value)}`];
}
export function anthropicRequest(path, body, key, workspace = process.env.ANTHROPIC_WORKSPACE_ID) {
  if (!['/v1/messages', '/v1/messages/count_tokens'].includes(path)) throw new Error('Forbidden API path');
  if (!key || /[\r\n]/.test(key)) throw new Error('Missing or invalid ANTHROPIC_API_KEY');
  const quote = s => JSON.stringify(s);
  const config = [
    'silent', 'show-error', 'fail-with-body', 'request = "POST"',
    'max-time = "45"', 'connect-timeout = "15"', 'retry = "0"', 'proto = "=https"',
    `url = ${quote('https://api.anthropic.com' + path)}`,
    ...workspaceHeader(workspace),
    `header = ${quote('x-api-key: ' + key)}`, 'header = "anthropic-version: 2023-06-01"',
    'header = "content-type: application/json"', 'write-out = "\\n%{http_code}"', `data-binary = ${quote(JSON.stringify(body))}`
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--disable', '--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', length = 0, oversized = false;
    child.stdout.on('data', chunk => { length += chunk.length; if (length > 1024 * 1024) { oversized = true; child.kill(); } else output += chunk; });
    child.stderr.on('data', () => {}); // Never log provider bodies, headers or errors.
    child.on('error', () => reject(new Error('Transport unavailable')));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      try { resolve(decodeResponse(output, code, oversized, key)); } catch (error) { reject(error); }
    });
    child.stdin.end(config);
  });
}
