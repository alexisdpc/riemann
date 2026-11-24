import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const extractIds = html => [...html.matchAll(/\sid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)].map(match => match[1] || match[2]);
const extractEquations = text => [...text.matchAll(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g)].map(match => match[1] || match[2]);
function decodeHtmlMath(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", AMP: '&', LT: '<', GT: '>', QUOT: '"' };
  // Decode once, as HTML parsing does: &amp;lt; must remain the literal &lt;.
  return text.replace(/&(#(?:[xX][0-9a-fA-F]+|\d+)|amp|lt|gt|quot|apos|AMP|LT|GT|QUOT);/g, (_entity, value) => {
    if (value[0] !== '#') return named[value];
    const hex = value[1].toLowerCase() === 'x';
    const codePoint = Number.parseInt(value.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!codePoint || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\ufffd';
    return String.fromCodePoint(codePoint);
  });
}
assert(decodeHtmlMath('&amp; &lt; &gt; &quot; &apos; &#916; &#x394; &amp;lt;') === '& < > " \' Δ Δ &lt;',
  'HTML math must decode named and numeric entities exactly once');
const pages = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
  .map(entry => {
    const html = readFileSync(resolve(root, entry.name), 'utf8');
    return { name: entry.name, html, ids: extractIds(html), equations: extractEquations(html).map(decodeHtmlMath) };
  });
for (const expected of ['index.html', 'technical.html', 'sources.html']) {
  assert(pages.some(page => page.name === expected), `Missing ${expected}`);
}
const pageIds = new Map(pages.map(page => [resolve(root, page.name), page.ids]));
const cssPaths = new Set(['assets/styles.css', 'assets/vendor/katex/katex.min.css'].map(path => resolve(root, path)));
const mathScripts = [
  'assets/vendor/katex/katex.min.js',
  'assets/vendor/katex/contrib/auto-render.min.js',
  'assets/math.js',
];
for (const page of pages) {
  assert(!/(?:YangMillsMath|hits\.sh\/alexisdpc\.github\.io\/yang-mills|github\.io%2Fyang-mills)/i.test(page.html), `${page.name}: remove inherited Yang–Mills runtime or counter identifiers`);
  // A literal < followed by a letter can start an HTML tag before KaTeX sees it.
  // Compiling the source equation alone cannot detect that loss in the browser.
  for (const equation of extractEquations(page.html)) {
    assert(!/<[A-Za-z!/]/.test(equation), `${page.name}: escape mathematical less-than signs as &lt; to prevent HTML parsing them as tags`);
  }
  const scriptTags = [...page.html.matchAll(/<script\b[^>]*>/gi)].map(match => new Map(
    [...match[0].matchAll(/\s([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
      .map(attribute => [attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? '']),
  ));
  if (page.equations.length || scriptTags.some(attributes => attributes.get('src') === 'assets/math.js')) {
    const mathIndexes = mathScripts.map(path => scriptTags.findIndex(attributes => attributes.get('src') === path));
    assert(mathIndexes.every((position, i) => position >= 0 && (i === 0 || position > mathIndexes[i - 1])), `${page.name}: math dependencies must load in order`);
    mathIndexes.forEach(position => {
      const attributes = scriptTags[position];
      assert(attributes?.has('defer') && !attributes.has('async')
        && ['', 'text/javascript', 'application/javascript'].includes((attributes.get('type') || '').toLowerCase()),
      `${page.name}: math startup must use ordered classic deferred scripts`);
    });
  }
  assert(new Set(page.ids).size === page.ids.length, `${page.name}: duplicate HTML IDs`);
  for (const match of page.html.matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const url = match[1] ?? match[2];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) continue;
    try {
      const target = new URL(url, `https://local.invalid/${page.name}`);
      const pathname = decodeURIComponent(target.pathname);
      const localPath = resolve(root, pathname.slice(1));
      assert(!pathname.startsWith('/alpo-proof/'), `${page.name}: link points into the excluded raw proof archive: ${url}`);
      assert(localPath.startsWith(root + sep), `${page.name}: local link leaves the site root: ${url}`);
      const exists = existsSync(localPath);
      assert(exists, `${page.name}: missing local asset: ${url}`);
      if (!exists) continue;
      if (extname(localPath) === '.css') cssPaths.add(localPath);
      if (target.hash && extname(localPath) === '.html') {
        const targetIds = pageIds.get(localPath) ?? extractIds(readFileSync(localPath, 'utf8'));
        assert(targetIds.includes(decodeURIComponent(target.hash.slice(1))), `${page.name}: missing anchor: ${url}`);
      }
    } catch (error) {
      failures.push(`${page.name}: invalid local link ${url}: ${error.message}`);
    }
  }
}
// The full archive is deliberately not required to build the reading guide.
// Verify the exact curated files that the public-facing source links describe.
let snapshotCount = 0;
let excerptLineCount = 0;
try {
  const provenance = JSON.parse(readFileSync(resolve(root, 'references/provenance.json'), 'utf8'));
  assert(Array.isArray(provenance.files) && provenance.files.length > 0, 'Provenance needs curated source files');
  assert(provenance.archive?.includedInSite === false, 'The full archive must remain excluded from the site');
  for (const entry of (provenance.files || [])) {
    if (!entry?.localPath) { failures.push('Provenance entry is missing localPath'); continue; }
    const localPath = resolve(root, entry.localPath);
    if (!localPath.startsWith(resolve(root, 'references') + sep)) {
      failures.push(`Provenance path leaves references/: ${entry.localPath}`);
      continue;
    }
    const contents = readFileSync(localPath);
    assert(contents.length === entry.bytes, `Snapshot byte count mismatch: ${entry.localPath}`);
    assert(createHash('sha256').update(contents).digest('hex') === entry.sha256?.toLowerCase(), `Snapshot SHA-256 mismatch: ${entry.localPath}`);
    if (entry.id) {
      const sourcePage = pages.find(page => page.name === 'sources.html')?.html || '';
      const escapedId = entry.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const excerpt = new RegExp('<span class="source-line" id="' + escapedId + '-L(\\d+)"><a\\b[^>]*>[^<]*<\\/a>([\\s\\S]*?)<\\/span>', 'g');
      const originalLines = contents.toString('utf8').split(/\r?\n/);
      const shown = [...sourcePage.matchAll(excerpt)];
      assert(shown.length > 0, `Source snapshot has no displayed excerpt: ${entry.id}`);
      for (const line of shown) {
        const number = Number(line[1]);
        assert(decodeHtmlMath(line[2]) === originalLines[number - 1], `Source excerpt differs from snapshot: ${entry.id}, line ${number}`);
      }
      excerptLineCount += shown.length;
    }
    snapshotCount++;
  }
} catch (error) {
  failures.push(`Source provenance: ${error.message}`);
}
for (const fullPath of cssPaths) {
  const css = readFileSync(fullPath, 'utf8');
  for (const [, raw] of css.matchAll(/url\(([^)]+)\)/g)) {
    const url = raw.replace(/^['"]|['"]$/g, '');
    if (!/^(data:|https?:)/.test(url)) assert(existsSync(resolve(dirname(fullPath), url)), `Missing font/image: ${url}`);
  }
}
const katexModule = { exports: {} };
vm.runInNewContext(readFileSync(resolve(root, 'assets/vendor/katex/katex.min.js'), 'utf8'), { module: katexModule, exports: katexModule.exports, console });
const equations = pages.flatMap(page => page.equations.map(equation => ({ source: page.name, equation })));
const app = readFileSync(resolve(root, 'assets/app.js'), 'utf8');
equations.push(...[...app.matchAll(/equation: String\.raw`([^`]+)`/g)].map(match => ({ source: 'assets/app.js', equation: match[1] })));
for (const { source, equation } of equations) {
  try { katexModule.exports.renderToString(equation, { throwOnError: true, strict: 'error' }); }
  catch (error) { failures.push(`${source}: invalid equation: ${error.message}`); }
}

// Execute the real classic bootstrap without the app module. These checks cover
// the lifecycle that previously left raw LaTeX visible after startup failures.
const mathSource = readFileSync(resolve(root, 'assets/math.js'), 'utf8');
function mathStartup({ readyState = 'complete', rendererAvailable = true } = {}) {
  const document = Object.assign(new EventTarget(), {
    readyState, body: readyState === 'loading' ? null : { id: 'body' },
    documentElement: { dataset: {} },
  });
  const dependencies = [new EventTarget(), new EventTarget()];
  document.querySelectorAll = () => dependencies;
  const window = new EventTarget();
  const calls = [];
  const errors = [];
  const installRenderer = () => { window.renderMathInElement = (element, options) => calls.push({ element, options }); };
  if (rendererAvailable) installRenderer();
  vm.runInNewContext(mathSource, { window, document, console: { error: message => errors.push(message) } }, { filename: 'assets/math.js', timeout: 1000 });
  return { window, document, dependencies, calls, errors, installRenderer };
}
try {
  const ready = mathStartup();
  assert(ready.calls.length === 1 && ready.calls[0].element === ready.document.body,
    'Static math must render without loading the interactive app');
  assert(ready.document.documentElement.dataset.mathStatus === 'ready', 'Successful startup must report ready');
  const dynamicRoot = { id: 'route-equation' };
  assert(ready.window.RiemannMath.typeset(dynamicRoot) === true && ready.calls.at(-1).element === dynamicRoot,
    'Updated route equations must render through the shared math entry point');

  const loading = mathStartup({ readyState: 'loading' });
  assert(loading.calls.length === 0, 'Math must wait while the document body is unavailable');
  loading.document.body = { id: 'body' };
  loading.document.readyState = 'interactive';
  loading.document.dispatchEvent(new Event('DOMContentLoaded'));
  assert(loading.calls.length === 1 && loading.calls[0].element === loading.document.body,
    'Math must render when the DOM becomes ready');

  const delayed = mathStartup({ rendererAvailable: false });
  assert(delayed.document.documentElement.dataset.mathStatus === 'unavailable' && delayed.errors.length === 1,
    'Missing math dependencies must be reported instead of silently skipped');
  delayed.installRenderer();
  delayed.dependencies[1].dispatchEvent(new Event('load'));
  assert(delayed.calls.length === 1 && delayed.calls[0].element === delayed.document.body
    && delayed.document.documentElement.dataset.mathStatus === 'ready',
  'Math must recover after a delayed renderer loads');
} catch (error) {
  failures.push(`Math startup regression: ${error.message}`);
}

for (const script of [
  ...readdirSync(resolve(root, 'assets')).filter(name => name.endsWith('.js')).map(name => `assets/${name}`),
  ...readdirSync(resolve(root, 'scripts')).filter(name => name.endsWith('.mjs')).map(name => `scripts/${name}`),
]) {
  try { execFileSync(process.execPath, ['--check', resolve(root, script)], { stdio: 'pipe' }); }
  catch (error) { failures.push(`Syntax error in ${script}: ${error.stderr}`); }
}
try { execFileSync(process.execPath, [resolve(root, 'scripts/sync-dependency-checklist.mjs'), '--check'], { stdio: 'pipe' }); }
catch (error) { failures.push(`Dependency checklist validation: ${error.stderr}`); }
try { execFileSync(process.execPath, [resolve(root, 'scripts/sync-technical-toc.mjs'), '--check'], { stdio: 'pipe' }); }
catch (error) { failures.push(`Complete technical contents validation: ${error.stderr}`); }
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Passed: ${pages.length} HTML pages, local links and cross-page anchors, ${snapshotCount} source snapshots, ${excerptLineCount} exact source lines, font assets, ${equations.length} LaTeX expressions, independent math startup and recovery, dependency checklist consistency, complete technical contents, and JavaScript syntax.`);
