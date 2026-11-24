import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, 'references/dependency-checklist.json'), 'utf8'));
const pagePath = resolve(root, 'technical.html');
const html = readFileSync(pagePath, 'utf8');
const start = '<!-- dependency-checklist:start -->';
const end = '<!-- dependency-checklist:end -->';
const a = html.indexOf(start), b = html.indexOf(end);
if (a < 0 || b < a) throw new Error('Dependency-checklist markers are missing');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses = { explained: 'Fully explained', summarized: 'Summarized', missing: 'Missing explanation' };
const sourceKinds = { proof: 'Proof body inspected', 'conditional-proof': 'Proof with explicit inputs', interface: 'Input interface inspected' };
const rows = manifest.entries;
const ids = new Set(rows.map(row => row.id));
if (ids.size !== rows.length) throw new Error('Duplicate checklist IDs');
const byId = new Map(rows.map(row => [row.id, row]));
const pageIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const branches = new Set(manifest.branches.map(branch => branch.id));
for (const row of rows) {
  if (!/^coverage-[a-z0-9-]+$/.test(row.id) || !statuses[row.status] || !branches.has(row.branch)) throw new Error(`Invalid row: ${row.id}`);
  for (const key of ['title', 'scope', 'coverage', 'next']) if (!row[key]?.trim()) throw new Error(`${row.id}: missing ${key}`);
  if (!['traced', 'partial'].includes(row.confidence) || !['next', 'later', 'covered'].includes(row.priority)) throw new Error(`${row.id}: invalid review fields`);
  if (!row.sources?.length || !row.notes?.length) throw new Error(`${row.id}: source and note evidence required`);
  for (const note of row.notes) if (!pageIds.has(note.anchor)) throw new Error(`${row.id}: missing note anchor ${note.anchor}`);
  for (const id of row.dependsOn) if (!ids.has(id) || id === row.id) throw new Error(`${row.id}: invalid dependency ${id}`);
  for (const source of row.sources) {
    if (!sourceKinds[source.kind] || !Number.isInteger(source.line) || source.line < 1 || !source.path.endsWith('.lean') || source.path.includes('..')) throw new Error(`${row.id}: invalid source`);
    if (!source.declaration || !source.inputs || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error(`${row.id}: incomplete source evidence`);
    if (process.argv.includes('--verify-source')) {
      const path = resolve(root, 'alpo-proof/extracted/lean/src', source.path);
      if (!existsSync(path)) throw new Error(`Original source missing: ${source.path}`);
      const bytes = readFileSync(path);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== source.sha256 || bytes.toString('utf8').split(/\r?\n/)[source.line - 1] !== source.lineText) throw new Error(`Source evidence changed: ${source.path}:${source.line}`);
    }
  }
}
const visiting = new Set(), visited = new Set();
function visit(id) {
  if (visiting.has(id)) throw new Error(`Cycle in explanatory dependency links: ${id}`);
  if (visited.has(id)) return;
  visiting.add(id);
  byId.get(id).dependsOn.forEach(visit);
  visiting.delete(id); visited.add(id);
}
rows.forEach(row => visit(row.id));
for (const priority of manifest.priorities) {
  if (!priority.items.length || priority.items.some(id => !ids.has(id) || byId.get(id).status === 'explained')) throw new Error(`Invalid priority: ${priority.title}`);
}
const rowLink = id => `<a href="#${escape(id)}">${escape(byId.get(id).title)}</a>`;
const counts = Object.fromEntries(Object.keys(statuses).map(status => [status, rows.filter(row => row.status === status).length]));
const sourceUrl = source => manifest.sourceMirror + source.path.split('/').map(encodeURIComponent).join('/') + '#L' + source.line;
function renderRow(row) {
  const notes = row.notes.map(note => `<a href="#${escape(note.anchor)}">${escape(note.label)}</a>`).join(' · ');
  const dependencies = row.dependsOn.length ? `<p class="coverage-dependencies"><strong>Related inputs:</strong> ${row.dependsOn.map(rowLink).join('; ')}.</p>` : '';
  const sources = row.sources.map(source => `<li><a href="${escape(sourceUrl(source))}">${escape(source.path.split('/').at(-1))}:${source.line}</a> — ${sourceKinds[source.kind]}.<p><code>${escape(source.declaration)}</code></p><p>${escape(source.inputs)}</p></li>`).join('\n');
  return `<tr id="${row.id}" data-coverage="${row.status}">
    <th scope="row"><span class="coverage-row-title">${escape(row.title)}</span><p class="coverage-scope">${escape(row.scope)}</p><p class="coverage-note-links">${notes}</p></th>
    <td><span class="coverage-status coverage-${row.status}">${statuses[row.status]}</span>${row.priority === 'next' ? '<span class="coverage-next">Priority for expansion</span>' : ''}</td>
    <td><p>${escape(row.coverage)}</p><p><strong>${row.status === 'explained' ? 'Scope boundary' : 'Next expansion'}:</strong> ${escape(row.next)}</p>${dependencies}
    <details class="coverage-evidence"><summary>Lean evidence and input boundary</summary><ul>${sources}</ul>${row.confidence === 'partial' ? '<p>The source trace stops at some supplying results. Their deeper proof chains have not been fully followed in this review.</p>' : '<p>The cited proof steps and their immediate inputs were inspected; this is not a full transitive proof or axiom audit.</p>'}</details></td>
  </tr>`;
}
const groups = manifest.branches.map((branch, i) => {
  const group = rows.filter(row => row.branch === branch.id);
  return `<h4 id="coverage-branch-${branch.id}"><span class="note-number">13.3.${i + 1}</span> ${escape(branch.title)}</h4>
  <p>${escape(branch.description)}</p>
  <div class="table-scroll coverage-table-wrap" tabindex="0" role="region" aria-label="${escape(branch.title)} dependency checklist">
  <table class="coverage-table"><caption>${group.length} reviewed components · ${group.filter(r => r.status === 'explained').length} fully explained · ${group.filter(r => r.status === 'summarized').length} summarized · ${group.filter(r => r.status === 'missing').length} missing explanations</caption>
    <thead><tr><th scope="col">Argument and reading link</th><th scope="col">Coverage</th><th scope="col">Assessment and remaining work</th></tr></thead>
    <tbody>${group.map(renderRow).join('\n')}</tbody>
  </table></div>`;
}).join('\n\n');
const priorities = manifest.priorities.map(priority => `<li><strong>${escape(priority.title)}</strong><p>${escape(priority.why)}</p><p>${priority.items.map(rowLink).join(' · ')}</p></li>`).join('\n');
const section = `${start}
<section class="technical-section dependency-checklist" id="dependency-checklist" aria-labelledby="dependency-checklist-title">
  <p class="technical-kicker">Exposition coverage · reviewed ${escape(manifest.reviewDate)}</p>
  <h2 id="dependency-checklist-title" data-toc-title="Dependency checklist"><span class="note-number">13</span> What is explained, and what remains.</h2>
  <p>This checklist compares the notes with selected proof bodies and input packages in the downloaded Lean source. Each row concerns a specific mathematical argument. It records the explanation available here, the inputs still needed, and a concrete next expansion. A missing explanation means missing from this guide; it does not mean a theorem or proof is absent from the Lean files.</p>
  <div class="coverage-counts" aria-label="Counts of reviewed components">${Object.entries(statuses).map(([status, label]) => `<p><strong>${counts[status]}</strong><span>${label}</span></p>`).join('')}</div>
  <p class="coverage-count-note">${rows.length} reviewed components, of very different sizes. These counts are not a percentage of the full proof. The checklist follows the main paths inspected so far; it is not an exhaustive inventory of every declaration or imported library.</p>

  <h3 id="coverage-status-guide"><span class="note-number">13.1</span> Read each status at the stated scope.</h3>
  <dl class="coverage-legend">
    <dt><span class="coverage-status coverage-explained">Fully explained</span></dt><dd>The bounded argument has definitions, hypotheses, and the essential intermediate reasoning in the notes. It may use explicitly named inputs whose own proofs receive separate ratings.</dd>
    <dt><span class="coverage-status coverage-summarized">Summarized</span></dt><dd>The statement, role, or main mechanism is described, but important constructions or deductions are still compressed into an invocation.</dd>
    <dt><span class="coverage-status coverage-missing">Missing explanation</span></dt><dd>The guide does not yet explain the argument itself. A theorem may be named or used while its proof remains unpresented.</dd>
  </dl>
  <p>Source evidence is folded under each entry. It distinguishes a proof body, a proof conditional on explicit inputs, and an input interface. The presence of a proposition or a record field is not itself evidence that its hypotheses have been discharged. “Fully explained” rates the exposition of the specified implication; it does not certify the underlying mathematics or a Lean compilation.</p>

  <h3 id="coverage-priorities"><span class="note-number">13.2</span> Fill the highest-impact gaps next.</h3>
  <p>The order below prioritizes missing links that make several later arguments depend on an unexplained input. It is a reading and writing plan, not a ranking by line count. The first tasks reconstruct specific bridges; the deeper analytic and geometric theories require a longer program.</p>
  <ol class="coverage-priorities">${priorities}</ol>

  <h3 id="coverage-by-branch"><span class="note-number">13.3</span> Follow the checklist by mathematical branch.</h3>
  <nav class="coverage-branch-nav" aria-label="Dependency checklist branches">${manifest.branches.map(branch => `<a href="#coverage-branch-${branch.id}">${escape(branch.title)}</a>`).join('')}</nav>
  ${groups}

  <h3 id="coverage-review-boundary"><span class="note-number">13.4</span> Keep the review boundary visible.</h3>
  <p>The review uses the archive identified in <a href="sources.html#provenance">the provenance record</a> and compares it with the notes based on repository revision <code>${escape(manifest.notesBaseCommit.slice(0, 7))}</code>. It records selected mathematical handoffs, not an automatically extracted call graph. Related-input links indicate inspected dependencies at the level of this exposition; unlisted inputs remain in the source descriptions.</p>
  <p>There are two further tasks beyond expanding the prose: continue tracing the unreviewed prerequisites, and independently compile and audit the final theorem dependencies. Neither task is claimed complete by this checklist. A fully explained local calculation can still sit inside a largely summarized branch.</p>
  <p>The <a href="references/dependency-checklist.json">downloadable checklist and source-evidence record</a> includes the classifications, priorities, note anchors, declaration locations and fingerprints of the inspected files. It contains no new Lean snapshots.</p>
</section>
${end}`;
const updated = html.slice(0, a) + section + html.slice(b + end.length);
if (process.argv.includes('--check')) {
  if (html !== updated) throw new Error('Dependency checklist is stale. Run node scripts/sync-dependency-checklist.mjs');
} else writeFileSync(pagePath, updated);
console.log(`Dependency checklist: ${rows.length} entries, ${counts.explained} explained, ${counts.summarized} summarized, ${counts.missing} missing explanations${process.argv.includes('--verify-source') ? '; original source fingerprints and line locations verified' : ''}.`);
