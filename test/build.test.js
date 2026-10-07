const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const buildScript = path.join(root, 'build.mjs');

function runBuild(srcDir, outFile) {
  return spawnSync(process.execPath, [buildScript, srcDir, outFile], { encoding: 'utf8' });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'b64-build-'));
}

test('build produces a single self-contained file with CSP', () => {
  const out = path.join(tempDir(), 'out.html');
  const res = runBuild(path.join(root, 'src'), out);
  assert.equal(res.status, 0, res.stderr);
  const html = fs.readFileSync(out, 'utf8');
  assert.doesNotMatch(html, /<!--\s*inline:/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:">/);
  assert.doesNotMatch(html, /\b(src|href)\s*=\s*["']?\s*(https?:)?\/\//i);
  assert.doesNotMatch(html, /url\(\s*["']?\s*(https?:)?\/\//i);
  assert.doesNotMatch(html, /@import/i);
  assert.match(html, /<style>[\s\S]*<\/style>/);
  assert.match(html, /root\.B64 = api/);
});

test('build fails on a marker naming a missing file', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><!-- inline:missing.js --></html>');
  const res = runBuild(dir, path.join(dir, 'out.html'));
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /missing file "missing\.js"/);
});

test('build fails on a malformed marker', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><!-- inline: --></html>');
  const res = runBuild(dir, path.join(dir, 'out.html'));
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /unresolved inline marker/);
});

test('build refuses JS containing a closing script tag', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><!-- inline:bad.js --></html>');
  fs.writeFileSync(path.join(dir, 'bad.js'), 'const s = "</script>";');
  const res = runBuild(dir, path.join(dir, 'out.html'));
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /contains "<\/script"/);
});

test('every textarea and text input opts out of autocomplete/form-state saving', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const fields = html.match(/<(?:textarea|input type="text")(?=[\s>])[^>]*>/g);
  assert.equal(fields.length, 10, `expected the page's text fields, found ${fields.length}`);
  for (const tag of fields) assert.match(tag, /\bautocomplete="off"/, tag);
});
