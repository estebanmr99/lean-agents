// Shell rc files and the marked PATH block a POSIX install writes into them, so a new terminal finds what it installed (#335).
import fs from 'node:fs';
import path from 'node:path';

// An existing .zshrc, .bashrc or .bash_profile, else .zshrc for a zsh user, else .profile.
export const rcFiles = (home, shell, fsx = fs) => {
  const have = ['.zshrc', '.bashrc', '.bash_profile'].filter((f) => fsx.existsSync(path.join(home, f)));
  return (have.length ? have : [/zsh$/.test(shell ?? '') ? '.zshrc' : '.profile']).map((f) => path.join(home, f));
};

// dirs: folders under home (e.g. '.local/bin'); brew: the Homebrew prefix this run installs; privateNode: install.sh's own Node.
// The private Node goes last, so a Node the user already has stays the default.
export function posixPathBlock({ home, platform, envPath = '', dirs = [], brew = null, privateNode = false, shell, fsx = fs }) {
  if (platform === 'win32') return [];
  const have = new Set(envPath.split(':').map((d) => d.replace(/\/+$/, '')));
  const lines = [];
  if (brew && !have.has(`${brew}/bin`)) lines.push(`[ -x ${brew}/bin/brew ] && eval "$(${brew}/bin/brew shellenv)"`); // a failed Homebrew install must not break every shell
  const add = dirs.filter((d) => !have.has(path.join(home, d)));
  if (add.length) lines.push(`export PATH="${add.map((d) => `$HOME/${d}`).join(':')}:$PATH"`);
  if (privateNode) lines.push('export PATH="$PATH:$HOME/.config/lean-agents/node/bin"');
  return lines.length ? rcFiles(home, shell, fsx).map((p) => ({ kind: 'block', id: 'path', path: p, body: lines.join('\n') })) : [];
}
