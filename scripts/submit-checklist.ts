// Writes dist/upload-<version>/ with the ZIP, the store images to upload, and a checklist page.
// The page holds only the dashboard fields that changed since the tag, each with a Copy button.
// Usage: node scripts/submit-checklist.ts <last tag>
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Field {
  tab: string;
  name: string;
  value: string;
  paste: boolean;
  isNew?: boolean;
}

const DASHBOARD_URL = 'https://chrome.google.com/u/1/webstore/devconsole/681f0b71-fedf-41b2-ac38-00175a64170e';
const IMAGE_FIELDS = ['Store icon', 'Screenshots', 'Small promo tile'];

// A "## <name> tab" heading starts a tab. A "**Label:** value" line is a field to set, and a text block or a table row is a field to paste.
export function parseListing(text: string): Field[] {
  const fields: Field[] = [];
  const lines = text.split('\n');
  let tab = '';
  let label = '';
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^## (.+) tab$/);
    const bold = lines[i].match(/^\*\*(.+?):\*\*\s*(.*)$/);
    const row = lines[i].match(/^\| (.+?) \| (.+) \|$/);
    if (heading) {
      tab = label = heading[1];
    } else if (bold) {
      label = bold[1];
      if (bold[2]) {
        fields.push({ tab, name: label, value: bold[2], paste: false });
      }
    } else if (row && row[1] !== 'Permission' && row[1] !== '---') {
      fields.push({ tab, name: `Justification: ${row[1].replaceAll('`', '')}`, value: row[2], paste: true });
    } else if (lines[i] === '```text') {
      const end = lines.indexOf('```', i + 1);
      fields.push({ tab, name: label, value: lines.slice(i + 1, end).join('\n'), paste: true });
      i = end;
    }
  }
  return fields;
}

const filesOf = (value: string) => [...value.matchAll(/`([^`]+)`/g)].map(([, file]) => file);

export function changedFields(before: string, after: string, changedFiles: string[]): Field[] {
  const earlier = new Map(parseListing(before).map((field) => [`${field.tab}/${field.name}`, field.value]));
  return parseListing(after)
    .filter(
      ({ tab, name, value }) =>
        earlier.get(`${tab}/${name}`) !== value ||
        (IMAGE_FIELDS.includes(name) && filesOf(value).some((file) => changedFiles.includes(file))),
    )
    .map((field) => (earlier.has(`${field.tab}/${field.name}`) ? field : { ...field, isNew: true }));
}

const escape = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
const inlineCode = (text: string) => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>');

function fieldHtml(field: Field, id: string) {
  const label = `${escape(field.name)}${field.isNew ? ' (new field)' : ''}`;
  if (IMAGE_FIELDS.includes(field.name)) {
    const files = filesOf(field.value).map((file) => path.basename(file));
    return `<p class="pick"><span>${label}: remove the earlier images, and upload</span> <code>${files.join(', ')}</code></p>`;
  }
  if (!field.paste) {
    return `<p class="pick"><span>${label}</span> ${inlineCode(field.value)}</p>`;
  }
  const rows = Math.min(24, field.value.split('\n').length + Math.ceil(field.value.length / 90));
  return `<label for="${id}">${label}</label><div class="field"><textarea id="${id}" rows="${rows}" readonly>${escape(field.value)}</textarea><button type="button" data-copy="${id}">Copy</button></div>`;
}

const section = (title: string, body: string) =>
  `<section><label class="done"><input type="checkbox"><h2>${title}</h2></label>${body}</section>`;

const STYLE = `:root { color-scheme: light dark; --surface: light-dark(#fff,#191919); --text: light-dark(#37352f,#d4d4d4); --muted: light-dark(#787774,#9b9b9b); --line: light-dark(#37352f24,#ffffff24); --accent:#2383e2; }
body { margin:0 auto; max-width:760px; padding:28px 22px 80px; background:var(--surface); color:var(--text); font:14px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
h1 { font-size:22px; margin:0 0 4px; } h2 { display:inline; font-size:16px; margin:0; } section { padding:16px 0; border-top:1px solid var(--line); }
.done { display:flex; gap:8px; align-items:center; margin-bottom:8px; cursor:pointer; } section:has(.done input:checked) > :not(.done) { display:none; } section:has(.done input:checked) h2 { color:var(--muted); text-decoration:line-through; }
.field { display:flex; gap:8px; align-items:flex-start; margin:2px 0 12px; } textarea { flex:1; box-sizing:border-box; padding:6px 8px; font:13px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:inherit; background:transparent; border:1px solid var(--line); border-radius:4px; resize:vertical; }
label[for] { display:block; font-weight:600; font-size:13px; } button { min-width:70px; padding:4px 10px; font:inherit; font-size:12px; color:#fff; background:var(--accent); border:0; border-radius:4px; cursor:pointer; } button.copied { background:#2e8b57; }
.pick { margin:4px 0; } .pick span { color:var(--muted); } .note { color:var(--muted); font-size:13px; } a { color:var(--accent); } code { font-size:13px; }`;

const COPY_SCRIPT = `document.addEventListener('click', async (event) => { const id = event.target.dataset?.copy; if (!id) return; const box = document.getElementById(id); box.select(); try { await navigator.clipboard.writeText(box.value); } catch { document.execCommand('copy'); } event.target.textContent = 'Copied'; event.target.classList.add('copied'); setTimeout(() => { event.target.textContent = 'Copy'; event.target.classList.remove('copied'); }, 1500); });`;

function packageNotes(manifest: any, earlier: any) {
  const added = manifest.permissions.filter((permission: string) => !earlier.permissions.includes(permission));
  const addedHosts = manifest.host_permissions.filter((host: string) => !earlier.host_permissions.includes(host));
  return [
    manifest.name !== earlier.name && `The dashboard takes the new name, ${manifest.name}, from the ZIP.`,
    manifest.description !== earlier.description && 'The dashboard takes the new summary from the ZIP.',
    added.length && `The ZIP adds the ${added.join(', ')} permission. When Chrome shows a warning for it, current users must accept it before the extension turns on again.`,
    addedHosts.length && `The ZIP adds access to ${addedHosts.join(', ')}. Current users must accept it before the extension turns on again.`,
  ].filter(Boolean);
}

if (import.meta.main) {
  const [lastTag] = process.argv.slice(2);
  if (!lastTag) {
    throw new Error('Usage: node scripts/submit-checklist.ts <last tag>');
  }
  process.chdir(path.join(import.meta.dirname, '..'));
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  const earlier = JSON.parse(git('show', `${lastTag}:manifest.json`));
  const changedFiles = git('diff', '--name-only', lastTag, 'HEAD', '--', 'store', 'icons').split('\n').filter(Boolean);
  const fields = changedFields(git('show', `${lastTag}:store/listing.md`), readFileSync('store/listing.md', 'utf8'), changedFiles);
  const zip = `enhanced-notion-${manifest.version}.zip`;
  const folder = `dist/upload-${manifest.version}`;
  mkdirSync(folder, { recursive: true });
  copyFileSync(`dist/${zip}`, `${folder}/${zip}`);
  fields
    .filter(({ name }) => IMAGE_FIELDS.includes(name))
    .flatMap(({ value }) => filesOf(value))
    .forEach((file) => copyFileSync(file, `${folder}/${path.basename(file)}`));
  const version = manifest.version;
  const tabs = [...new Set(fields.map(({ tab }) => tab))];
  const sections = [
    section('Check the status of the current version', `<p><a href="${DASHBOARD_URL}" target="_blank">Open the dashboard</a>, and select the extension. If a version is still in review, wait for the result or select "Cancel review". ${version} contains everything in ${escape(lastTag)}.</p>`),
    section('Package tab', `<p>Select "Upload new package".</p><p class="pick"><span>File</span> <code>${zip}</code></p>${packageNotes(manifest, earlier).map((note) => `<p class="note">${escape(note)}</p>`).join('')}`),
    ...tabs.map((tab) => section(`${escape(tab)} tab`, fields.filter((field) => field.tab === tab).map((field) => fieldHtml(field, `f${fields.indexOf(field)}`)).join(''))),
    section('Submit', '<p>Select "Save draft", and then "Submit for Review".</p>'),
  ];
  const title = `Submit ${escape(manifest.name)} ${version}`;
  writeFileSync(
    `${folder}/submit-checklist.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>\n${STYLE}\n</style></head><body><h1>${title}</h1><p class="note">This list holds only the fields that changed since ${escape(lastTag)}. The ZIP and the images are in the folder beside this page. Tick a step to collapse it.</p>\n${sections.join('\n')}\n<script>${COPY_SCRIPT}</script>\n</body></html>\n`,
  );
  console.log(`${folder}/submit-checklist.html`);
}
