import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const TS_IMPORT = /(\bfrom\s*['"]\.{1,2}\/[^'"]+)\.ts(['"])/g;

process.chdir(path.join(import.meta.dirname, '..'));
for (const file of readdirSync('src').filter((name) => name.endsWith('.ts'))) {
  const code = stripTypeScriptTypes(readFileSync(`src/${file}`, 'utf8')).replace(TS_IMPORT, '$1.js$2');
  writeFileSync(`src/${file.replace(/\.ts$/, '.js')}`, code);
}
