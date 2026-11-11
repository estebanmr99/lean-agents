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
// owner/repo#ref: `skills add` ignores a trailing @tag (installs HEAD) but honors #tag and #<commit sha> (verified skills 1.5.18 and 1.7.4).
// A pin without `sha` (lean-update until its tag exists) falls back to the tag.
export const skillSource = (key) => `${pin(key).source}#${pin(key).sha ?? pin(key).version}`;
// `claude plugin marketplace add owner/repo#<sha>` fails (checked 2026-11-10), so marketplaces pin by tag only.
export const marketplaceSource = (key) => `${pin(key).source}#${pin(key).version}`;
// What `uvx --from` takes: the commit SHA, so a moved tag cannot change what runs.
export const gitSpec = (key) => `git+https://github.com/${pin(key).source}@${pin(key).sha}`;
// npm or git spec for a {pin:key} placeholder in core/mcp.json.
export const pinSpec = (key) => (pin(key).kind === 'git' ? gitSpec(key) : npmSpec(key));
export const bunPin = () => pin('bun');
export const skillsCli = () => npmSpec('skills-cli');
// `download` pins (Bun) are verified by SHA256 at install time and not tracked in state.json.
const tracked = (p) => !p.ciOnly && p.kind !== 'download';
export const pinVersions = () => Object.fromEntries(Object.entries(PINS).filter(([, p]) => tracked(p)).map(([k, p]) => [k, p.version]));

// Pin keys that differ from the tool name lean-agents saves in state.json options.tools.
const PIN_TOOL = { 'playwright-mcp': 'playwright', 'gsd-core': 'gsd', 'opencode-dcp': 'dcp', 'ponytail-plugin': 'ponytail', 'context-mode-plugin': 'context-mode' };
export const pinTool = (key) => PIN_TOOL[key] ?? key;
// True when the saved options use this pin; the Skills CLI and the lean-update skill ride along with every install.
export const pinInUse = (key, options) => key === 'skills-cli' || key === 'lean-update'
  || (key === 'orca-cli' ? (options.terminals ?? []).includes('orca')
    : key === 'warp-opencode' ? (options.terminals ?? []).includes('warp')
      : (options.tools ?? []).includes(PIN_TOOL[key] ?? key));

// [{ tool, installed, pinned }] for pins in use whose saved version differs from core/pins.json now.
export function behindPins(saved) {
  return Object.entries(saved.pins ?? {})
    .filter(([k, v]) => PINS[k] && tracked(PINS[k]) && PINS[k].version !== v && pinInUse(k, saved.options))
    .map(([tool, installed]) => ({ tool, installed, pinned: PINS[tool].version }));
}
