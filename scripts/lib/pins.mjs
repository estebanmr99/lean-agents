// Known-good versions of everything fetched at run time (core/pins.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'pins.json');
export const PINS = JSON.parse(fs.readFileSync(FILE, 'utf8')).pins;

function pin(key) {
  const p = PINS[key];
  if (!p) throw new Error(`no pin for ${key} in core/pins.json`);
  return p;
}

export const npmSpec = (key) => `${pin(key).source}@${pin(key).version}`;
// owner/repo#tag: `skills add` ignores a trailing @tag (installs HEAD) but honors #tag (verified skills 1.7.4).
export const skillSource = (key) => `${pin(key).source}#${pin(key).version}`;
export const skillsCli = () => npmSpec('skills-cli');
export const pinVersions = () => Object.fromEntries(Object.entries(PINS).map(([k, p]) => [k, p.version]));
