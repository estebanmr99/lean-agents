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

  const absDir = path.resolve(dir);
  const home = os.homedir();
  const stateDir = process.env.LEAN_STATE_DIR || path.join(home, '.config', 'lean-agents');

  if (!absDir.startsWith(stateDir) || absDir === stateDir) {
    console.error(`Refusing to remove ${absDir}: outside lean data dir`);
    process.exit(1);
  }

  try {
    const stats = fsSync.lstatSync(absDir);
    if (stats.isSymbolicLink()) {
      console.error(`Refusing to remove ${absDir}: it is a symlink`);
      process.exit(1);
    }
    if (!stats.isDirectory()) {
      console.error(`Refusing to remove ${absDir}: not a directory`);
      process.exit(1);
    }
  } catch (err) {
    if (err.code === 'ENOENT') process.exit(0);
    console.error(`Stat failed for ${absDir}: ${err.message}`);
    process.exit(1);
  }

  let markerFound = false;
  try {
    const files = await fs.readdir(absDir);
    for (const f of files) {
      if (f === '.lean-agents-marker' || f === '.managed-by-lean-agents') {
        markerFound = true;
        break;
      }
      try {
        const stats = fsSync.statSync(path.join(absDir, f));
        if (stats.isFile() && stats.size < 1024 * 1024) {
          const text = await fs.readFile(path.join(absDir, f), 'utf8');
          if (text.includes('managed by lean-agents')) {
            markerFound = true;
            break;
          }
        }
      } catch (e) {}
    }
  } catch (err) {
    console.error(`Failed to read dir ${absDir}: ${err.message}`);
    process.exit(1);
  }

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
