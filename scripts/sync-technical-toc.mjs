import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const path = resolve(root, 'technical.html');
const html = readFileSync(path, 'utf8');
const start = '<!-- technical-toc:start -->';
const end = '<!-- technical-toc:end -->';
const a = html.indexOf(start), b = html.indexOf(end);
if (a < 0 || b < a) throw new Error('Technical contents markers are missing');
const article = /<article\b[^>]*class="[^"]*technical-article[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1];
if (!article) throw new Error('Technical article is missing');
const attr = (attributes, name) => new RegExp(`\\b${name}="([^"]+)"`).exec(attributes)?.[1];
const entries = [...article.matchAll(/<h([2-6])\b([^>]*)>\s*<span class="note-number">([\d.]+)<\/span>([\s\S]*?)<\/h\1>/g)]
  .map(([, level, attributes, number, title]) => ({
    level: Number(level), number, id: attr(attributes, 'id'),
    title: attr(attributes, 'data-toc-title') || title.trim().replace(/\.$/, ''), children: [],
  }));
if ([...article.matchAll(/<h[2-6]\b/g)].length !== entries.length) {
  throw new Error('Every article heading must start with a valid note-number span; an unnumbered heading would be missing from the contents');
}
const byNumber = new Map(), ids = new Set(), chapters = [];
for (const entry of entries) {
  if (!entry.id || !/^[a-z][\w-]*$/.test(entry.id)) throw new Error(`Missing or invalid heading ID: ${entry.number}`);
  if (ids.has(entry.id) || byNumber.has(entry.number)) throw new Error(`Duplicate heading: ${entry.number}`);
  const parts = entry.number.split('.');
  if (entry.level !== parts.length + 1) throw new Error(`Heading level disagrees with ${entry.number}`);
  const parent = parts.length > 1 ? byNumber.get(parts.slice(0, -1).join('.')) : null;
  if (parts.length > 1 && !parent) throw new Error(`Missing preceding parent: ${entry.number}`);
  const siblings = parent ? parent.children : chapters;
  if (Number(parts.at(-1)) !== siblings.length + 1) throw new Error(`Out-of-order heading: ${entry.number}`);
  siblings.push(entry); ids.add(entry.id); byNumber.set(entry.number, entry);
}
if (!entries.length) throw new Error('No numbered headings found');
function render(entries, depth = 0, listId = '') {
  return `<ol${listId ? ` id="${listId}"` : ''} class="${depth ? 'toc-children' : 'toc-tree'}">\n${entries.map(entry => {
    const childId = `toc-children-${entry.number.replaceAll('.', '-')}`;
    const toggle = entry.children.length
      ? `<button type="button" class="toc-toggle" hidden aria-expanded="true" aria-controls="${childId}" aria-label="Collapse subsections of ${entry.number}"><span aria-hidden="true">−</span></button>` : '';
    return `<li><div class="toc-row"><a class="toc-numbered" href="#${entry.id}" data-note-number="${entry.number}"><span class="note-nav-number">${entry.number}</span><span>${entry.title}</span></a>${toggle}</div>${entry.children.length ? '\n' + render(entry.children, depth + 1, childId) : ''}</li>`;
  }).join('\n')}\n</ol>`;
}
const section = `${start}
          <nav aria-label="Technical sections">
            <p class="toc-part-label">${chapters.length} chapters · ${entries.length - chapters.length} sections and subsections</p>
            <p class="toc-help">Every numbered section, in reading order.</p>
            <div class="toc-actions" hidden><button type="button" data-toc-action="expand">Expand all</button><button type="button" data-toc-action="collapse">Collapse all</button></div>
            ${render(chapters)}
            <a class="toc-sources" href="sources.html#references">References &amp; source records</a>
          </nav>
          ${end}`;
const updated = html.slice(0, a) + section + html.slice(b + end.length);
if (process.argv.includes('--check')) {
  if (html !== updated) throw new Error('Technical contents are stale. Run node scripts/sync-technical-toc.mjs');
} else writeFileSync(path, updated);
console.log(`Technical contents: all ${entries.length} numbered headings, across ${chapters.length} chapters, in a complete hierarchy.`);
