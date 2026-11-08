import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const OUT = 'build';
const COPIED = ['manifest.json', 'sidepanel.html', 'icons'];
const TS_IMPORT = /(\bfrom\s*['"]\.{1,2}\/[^'"]+)\.ts(['"])/g;

process.chdir(path.join(import.meta.dirname, '..'));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/src`, { recursive: true });
for (const file of readdirSync('src').filter((name) => name.endsWith('.ts'))) {
  const code = stripTypeScriptTypes(readFileSync(`src/${file}`, 'utf8')).replace(TS_IMPORT, '$1.js$2');
  writeFileSync(`${OUT}/src/${file.replace(/\.ts$/, '.js')}`, code);
}
COPIED.forEach((entry) => cpSync(entry, `${OUT}/${entry}`, { recursive: true }));
