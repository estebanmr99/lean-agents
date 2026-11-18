// install.sh embeds the Homebrew installer URL and sha256; they must equal core/pins.json so a bump cannot desync.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PINS } from '../scripts/lib/pins.mjs';

const sh = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
const get = (name) => sh.match(new RegExp(`^${name}="([^"]+)"$`, 'm'))?.[1];

test('install.sh Homebrew installer pin equals core/pins.json', () => {
  const pin = PINS['homebrew-installer'];
  assert.match(get('BREW_INSTALL_URL'), /^https:\/\/raw\.githubusercontent\.com\/Homebrew\/install\/[0-9a-f]{40}\/install\.sh$/);
  assert.equal(get('BREW_INSTALL_URL'), pin.url);
  assert.equal(get('BREW_INSTALL_SHA256'), pin.sha256);
});
