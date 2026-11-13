// One-step source export (#100): writes the complete project at HEAD to a zip you own.
//   npm run export:source            → specone-source-<date>.zip
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, `specone-source-${new Date().toISOString().slice(0, 10)}.zip`);
try {
  execFileSync('git', ['archive', '--format=zip', '--prefix=specone-auto-labs/', '-o', out, 'HEAD'], { cwd: root, stdio: 'inherit' });
  console.log(`Source exported to ${out}`);
  console.log('Uncommitted changes are not included — commit first if you want them in the archive.');
} catch {
  console.error('git is required for the export (the project is a git repository).');
  process.exit(1);
}
