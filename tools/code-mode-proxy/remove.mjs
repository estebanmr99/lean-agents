import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node remove.mjs <dir>');
    process.exit(1);
  }

  let absDir;
  try {
    const rawAbs = path.resolve(dir);
    const stats = fsSync.lstatSync(rawAbs);
    if (stats.isSymbolicLink()) {
      console.error(`Refusing to remove ${rawAbs}: it is a symlink`);
      process.exit(1);
    }
    absDir = fsSync.realpathSync(rawAbs);
  } catch (err) {
    if (err.code === 'ENOENT') process.exit(0);
    console.error(`Stat failed for ${dir}: ${err.message}`);
    process.exit(1);
  }

  const home = os.homedir();
  const stateDir = process.env.LEAN_STATE_DIR || path.join(home, '.config', 'lean-agents');
  
  let realStateDir;
  try {
    realStateDir = fsSync.realpathSync(stateDir);
  } catch(e) {
    realStateDir = path.resolve(stateDir);
  }

  if (!absDir.startsWith(realStateDir + path.sep)) {
    console.error(`Refusing to remove ${absDir}: outside lean data dir (${realStateDir})`);
    process.exit(1);
  }

  let markerFound = false;
  try {
    const markerPath = path.join(absDir, '.lean-agents-code-mode-proxy');
    const stats = fsSync.statSync(markerPath);
    if (stats.isFile()) {
      const content = await fs.readFile(markerPath, 'utf8');
      if (content.trim() === 'managed by lean-agents') {
        markerFound = true;
      }
    }
  } catch(e) {}

  if (!markerFound) {
    console.error(`Refusing to remove ${absDir}: marker file missing`);
    process.exit(1);
  }

  try {
    await fs.rm(absDir, { recursive: true, force: true });
    console.log(`Removed ${absDir}`);
  } catch (err) {
    console.error(`Failed to remove ${absDir}: ${err.message}`);
    process.exit(1);
  }
}
main();
