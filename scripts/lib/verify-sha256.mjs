// Refuses a download whose SHA256 differs from the pinned one: `node verify-sha256.mjs <file> <hex>`.
// A mismatch deletes the file and exits 1, so the install command chain stops before extracting it.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [file, want] = process.argv.slice(2);
  const got = sha256(file);
  if (got !== want.toLowerCase()) {
    fs.rmSync(file, { force: true });
    console.error(`SHA256 mismatch for ${file}: got ${got}, pinned ${want}. Nothing was installed.`);
    process.exit(1);
  }
  console.log(`SHA256 ok: ${file}`);
}
