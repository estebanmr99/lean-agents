// Refuses a git checkout whose HEAD is not the pinned commit: `node verify-commit.mjs <dir> <sha>`.
// A moved tag removes the checkout and exits 1. A script file, not `node -e`, so no shell can split its arguments.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, want] = process.argv.slice(2);
  const got = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (got !== want) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.error(`${dir}: tag moved, HEAD is ${got}, pinned ${want}. The checkout was removed.`);
    process.exit(1);
  }
  console.log(`commit ok: ${dir}`);
}
