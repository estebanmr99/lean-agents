import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

const ROTATE_SIZE = 1024 * 1024; // 1 MB
const MAX_LINES = 50;
const MAX_LINE_LEN = 2048;

const SECRET_VALUE = /:\/\/[^/\s@]+@|\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}|\bnpm_[A-Za-z0-9]{20,}/g;
const SECRET_KV = /\b([\w-]*(?:api[_-]?key|password|passwd|secret|token)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi;

export function redact(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(SECRET_VALUE, '<redacted-token>')
    .replace(SECRET_KV, '$1<redacted>');
}

export class AuditLog {
  constructor(logPath, logArgs = false) {
    this.logPath = logPath;
    this.logArgs = logArgs;
    this.stream = null;
    this.size = 0;
    this.stderrLines = new Map(); // upstream -> count
  }

  async init() {
    try {
      const stats = await fsPromises.stat(this.logPath);
      this.size = stats.size;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.size = 0;
    }
    
    // We append. Open with 0600. 
    // fs.createWriteStream doesn't easily create with 0600 if it exists, but we pass mode.
    this.stream = fs.createWriteStream(this.logPath, { flags: 'a', mode: 0o600 });
  }

  async rotate() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    try {
      await fsPromises.rename(this.logPath, this.logPath + '.1');
    } catch (e) {
      // ignore
    }
    this.size = 0;
    this.stream = fs.createWriteStream(this.logPath, { flags: 'a', mode: 0o600 });
  }

  logCall(record) {
    const entry = {
      time: new Date().toISOString(),
      scriptSha256: record.scriptSha256,
      count: record.count,
      server: record.server,
      tool: record.tool,
      duration: record.duration,
      ok: record.ok,
      blocked: record.blocked
    };
    
    if (this.logArgs) {
      entry.args = record.args;
      entry.result = record.result;
    }
    if (record.error) {
      entry.error = redact(record.error);
    }
    
    const line = JSON.stringify(entry) + '\n';
    this.writeLine(line);
  }

  logStderr(server, text) {
    let count = this.stderrLines.get(server) || 0;
    if (count >= MAX_LINES) return;

    let line = redact(text);
    if (line.length > MAX_LINE_LEN) {
      line = line.slice(0, MAX_LINE_LEN) + '...[truncated]';
    }

    const entry = {
      time: new Date().toISOString(),
      server,
      stderr: line
    };

    this.writeLine(JSON.stringify(entry) + '\n');
    this.stderrLines.set(server, count + 1);
  }

  writeLine(line) {
    const buf = Buffer.from(line, 'utf8');
    this.size += buf.length;
    if (this.stream) {
      this.stream.write(buf);
    }
    if (this.size >= ROTATE_SIZE) {
      this.rotate().catch(() => {});
    }
  }

  close() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
