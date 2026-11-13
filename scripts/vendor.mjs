// Copies the self-hosted webfonts out of node_modules into public/fonts. The copies are
// committed, so this only needs re-running when a font package is upgraded.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'inter-var.woff2'],
  ['@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2', 'jetbrains-mono-var.woff2'],
  ['@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2', 'barlow-condensed-500.woff2'],
  ['@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2', 'barlow-condensed-600.woff2'],
  ['@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2', 'barlow-condensed-700.woff2'],
];
await mkdir(path.join(root, 'public/fonts'), { recursive: true });
for (const [from, to] of files) {
  await copyFile(path.join(root, 'node_modules', from), path.join(root, 'public/fonts', to));
  console.log('vendored', to);
}
