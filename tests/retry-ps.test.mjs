// The PowerShell download retry against a local server: a 5xx is retried, a 4xx is requested once.
// Covers install.ps1's Invoke-Download and tests/Invoke-RetryDownload.ps1 on pwsh 7 and, on Windows, PowerShell 5.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const serve = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
};
const stop = (server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });

// Loads one function, then downloads $env:LA_URL with it; exit 0 on success, 1 on a throw.
const driver = `
$ErrorActionPreference = 'Stop'
if ($env:LA_FN -eq 'Invoke-RetryDownload') { . (Join-Path $env:LA_ROOT 'tests/Invoke-RetryDownload.ps1') }
else {
  $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $env:LA_ROOT 'install.ps1'), [ref]$null, [ref]$null)
  foreach ($n in 'Test-NoProxy', 'Get-ProxyUrl', 'Invoke-Download') {
    $f = $ast.Find({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $n }, $true)
    . ([scriptblock]::Create($f.Extent.Text))
  }
}
try { & $env:LA_FN $env:LA_URL $env:LA_OUT; exit 0 } catch { [Console]::Error.WriteLine($_); exit 1 }
`;

const TIMEOUT_MS = 60000;

const run = (shell, fn, url, out) => new Promise((resolve) => {
  const env = { ...process.env, LA_ROOT: root, LA_FN: fn, LA_URL: url, LA_OUT: out };
  delete env.HTTPS_PROXY; delete env.NO_PROXY;
  const child = spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', driver], { env });
  let stderr = '';
  const timer = setTimeout(() => {
    child.kill();
    resolve({ status: null, timedOut: true, stderr: `${shell} did not exit within ${TIMEOUT_MS / 1000}s` });
  }, TIMEOUT_MS);
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (err) => { clearTimeout(timer); resolve({ status: null, stderr: String(err) }); });
  child.on('close', (status) => { clearTimeout(timer); resolve({ status, stderr }); });
});

const shells = ['pwsh', ...(process.platform === 'win32' ? ['powershell.exe'] : [])];
for (const shell of shells) {
  const missing = spawnSync(shell, ['-NoProfile', '-Command', '1'], { stdio: 'ignore' }).error;
  const skip = missing && `${shell} not found on PATH`;
  if (skip) console.log(`# skipping ${shell}: ${skip}`);
  for (const fn of ['Invoke-Download', 'Invoke-RetryDownload']) {
    const tmp = () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-ps-'));
      return { dir, out: path.join(dir, 'out.txt') };
    };

    test(`${shell} ${fn}: a 503 once, then 200: two requests and success`, { skip }, async () => {
      let hits = 0;
      const { server, url } = await serve((req, res) => {
        hits += 1;
        res.statusCode = hits === 1 ? 503 : 200;
        res.end(hits === 1 ? 'busy' : 'ok');
      });
      const { dir, out } = tmp();
      try {
        const result = await run(shell, fn, url, out);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(hits, 2);
        assert.equal(fs.readFileSync(out, 'utf8'), 'ok');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        await stop(server);
      }
    });

    test(`${shell} ${fn}: a 404 is requested once and fails`, { skip }, async () => {
      let hits = 0;
      const { server, url } = await serve((req, res) => {
        hits += 1;
        res.statusCode = 404;
        res.end('missing');
      });
      const { dir, out } = tmp();
      try {
        const result = await run(shell, fn, url, out);
        assert.equal(result.status, 1, result.stderr || 'the download fails');
        assert.equal(hits, 1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        await stop(server);
      }
    });
  }
}
