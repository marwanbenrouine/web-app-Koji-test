import { spawn } from 'node:child_process';
// curl preserves the managed HTTPS proxy and CA trust. No redirects or retries.
// The key is passed via stdin config, never arguments, environment dumps or files.
export function anthropicRequest(path, body, key) {
  if (!['/v1/messages', '/v1/messages/count_tokens'].includes(path)) throw new Error('Forbidden API path');
  if (!key || /[\r\n]/.test(key)) throw new Error('Missing or invalid ANTHROPIC_API_KEY');
  const quote = s => JSON.stringify(s);
  const config = [
    'silent', 'show-error', 'fail-with-body', 'request = "POST"',
    'max-time = "45"', 'connect-timeout = "15"', 'retry = "0"', 'proto = "=https"',
    `url = ${quote('https://api.anthropic.com' + path)}`,
    `header = ${quote('x-api-key: ' + key)}`, 'header = "anthropic-version: 2023-06-01"',
    'header = "content-type: application/json"', `data-binary = ${quote(JSON.stringify(body))}`
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--disable', '--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', length = 0, oversized = false;
    child.stdout.on('data', chunk => { length += chunk.length; if (length > 1024 * 1024) { oversized = true; child.kill(); } else output += chunk; });
    child.stderr.on('data', () => {}); // Never log provider bodies, headers or errors.
    child.on('error', () => reject(new Error('Transport unavailable')));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      if (code || oversized) return reject(new Error(`Anthropic transport failed (curl ${code ?? 'terminated'})`));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid provider JSON')); }
    });
    child.stdin.end(config);
  });
}
