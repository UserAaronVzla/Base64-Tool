// Inlines src/*.css and src/*.js into src/index.html -> dist/base64-tool.html.
// Usage: node build.mjs [srcDir] [outFile]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(process.argv[2] || join(root, 'src'));
const outFile = resolve(process.argv[3] || join(root, 'dist', 'base64-tool.html'));

function fail(message) {
  console.error(`build failed: ${message}`);
  process.exit(1);
}

const template = readFileSync(join(srcDir, 'index.html'), 'utf8');
const html = template.replace(/<!--\s*inline:([\w.-]+)\s*-->/g, (_, name) => {
  const file = join(srcDir, name);
  if (!existsSync(file)) fail(`inline marker names missing file "${name}"`);
  const content = readFileSync(file, 'utf8');
  if (name.endsWith('.css')) return `<style>\n${content}\n</style>`;
  if (name.endsWith('.js')) {
    if (/<\/script/i.test(content)) fail(`"${name}" contains "</script", which would break inlining`);
    return `<script>\n${content}\n</script>`;
  }
  fail(`inline marker "${name}" must be a .css or .js file`);
});

if (/<!--\s*inline:/.test(html)) fail('unresolved inline marker left in output');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`built ${outFile}`);
