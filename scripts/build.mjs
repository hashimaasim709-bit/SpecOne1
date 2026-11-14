// Build pipeline: bundles the browser apps with content-hashed filenames (automatic
// cache busting), compiles the service worker with a precache list, and turns the SQL
// migrations into statements the Worker can apply to D1 by itself on first request.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'public/assets');
const generated = path.join(root, 'src/generated');
const dev = process.argv.includes('--dev');

/** Split a .sql file into statements, keeping CREATE TRIGGER ... BEGIN ... END; intact. */
export function splitSql(sql) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      cur += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) cur += sql[++i];
        else quote = null;
      }
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      cur += '\n';
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ';') {
      const isTrigger = /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER/i.test(cur);
      if (isTrigger && !/\bEND\s*$/i.test(cur)) {
        cur += ch;
        continue;
      }
      if (cur.trim()) out.push(cur.trim().replace(/\s*\n\s*/g, ' '));
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim().replace(/\s*\n\s*/g, ' '));
  return out;
}

async function buildMigrations() {
  const dir = path.join(root, 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations = [];
  for (const name of files) {
    migrations.push({ name, statements: splitSql(await readFile(path.join(dir, name), 'utf8')) });
  }
  await writeFile(path.join(generated, 'migrations.json'), JSON.stringify(migrations));
  return migrations.length;
}

async function main() {
  // Empty the output folder in place (keeping the directory itself) so file watchers stay attached.
  await mkdir(outdir, { recursive: true });
  for (const f of await readdir(outdir)) await rm(path.join(outdir, f), { recursive: true, force: true });
  await mkdir(generated, { recursive: true });

  const result = await build({
    absWorkingDir: root,
    entryPoints: {
      site: 'client/site.ts',
      book: 'client/book.tsx',
      track: 'client/track.tsx',
      account: 'client/account.tsx',
      admin: 'client/admin/main.tsx',
      'site-style': 'client/styles/site.css',
      'admin-style': 'client/styles/admin.css',
    },
    outdir,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    assetNames: '[name]-[hash]',
    splitting: true,
    bundle: true,
    format: 'esm',
    target: ['es2020', 'safari15', 'chrome90', 'firefox90'],
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    metafile: true,
    jsx: 'automatic',
    jsxImportSource: 'preact',
    loader: { '.png': 'file', '.svg': 'file', '.woff2': 'file' },
    external: ['/fonts/*', '/icons/*', '/img/*'],
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
    logLevel: 'warning',
  });

  // Map logical names ("book.js", "track.css") to their hashed public URLs.
  const assets = {};
  const all = [];
  for (const [file, meta] of Object.entries(result.metafile.outputs)) {
    const url = '/' + path.relative(path.join(root, 'public'), path.join(root, file)).split(path.sep).join('/');
    all.push(url);
    const ext = path.extname(file);
    if (meta.entryPoint) {
      const name = path.basename(file).replace(/-[A-Z0-9]{8}(\.\w+)$/i, '$1');
      assets[name.replace('-style.css', '.css')] = url;
      if (meta.cssBundle) {
        const cssUrl = '/' + path.relative(path.join(root, 'public'), path.join(root, meta.cssBundle)).split(path.sep).join('/');
        assets[name.replace(ext, '.css')] = cssUrl;
      }
    }
  }
  const buildId = createHash('sha256').update(all.sort().join('|')).digest('hex').slice(0, 10);

  // Service worker: fixed URL, versioned by build id, precaches the app shell.
  const fonts = (await readdir(path.join(root, 'public/fonts')).catch(() => [])).filter((f) => f.endsWith('.woff2')).map((f) => `/fonts/${f}`);
  const precache = [...new Set([assets['site.js'], assets['site.css'], assets['admin.js'], assets['admin.css'], ...fonts, '/icons/icon-192.png', '/offline'])].filter(Boolean);
  await build({
    absWorkingDir: root,
    entryPoints: ['client/sw.ts'],
    outfile: path.join(root, 'public/sw.js'),
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: !dev,
    define: { __BUILD_ID__: JSON.stringify(buildId), __PRECACHE__: JSON.stringify(precache) },
    logLevel: 'warning',
  });

  await writeFile(path.join(generated, 'assets.json'), JSON.stringify({ buildId, assets }, null, 2));
  const count = await buildMigrations();
  console.log(`build ${buildId}: ${all.length} assets, ${count} migration(s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
