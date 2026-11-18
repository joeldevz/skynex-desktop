import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as vite8 from 'vite';

const [mode, pass] = process.argv.slice(2);
if (!['current', 'serial', 'parallel'].includes(mode) || !['1', '2'].includes(pass)) {
  throw new Error('Expected current, serial, or parallel and trial 1 or 2');
}
const scratch = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve('packages/web');
const baseline = path.join(web, 'vite.config.ts');
const outDir = path.join(scratch, `${mode}-${pass}`);
let configFile = baseline;
let vite = vite8;
if (mode === 'current') {
  const requireFromWeb = createRequire(path.join(web, 'package.json'));
  vite = await import(pathToFileURL(requireFromWeb.resolve('vite/package.json')).href.replace(/package\.json$/, 'dist/node/index.js'));
} else {
  const source = fs.readFileSync(baseline, 'utf8').replaceAll('\r\n', '\n');
  const compiler = /    react\(\{\n      babel: \{\n        plugins: \['babel-plugin-react-compiler'\],\n      \},\n    \}\),/;
  if (!compiler.test(source)) throw new Error('Expected the baseline Babel React Compiler');
  configFile = path.join(scratch, `${mode}.config.mts`);
  fs.writeFileSync(configFile, source
    .replace("import react from '@vitejs/plugin-react';", "import react, { reactCompilerPreset } from '@vitejs/plugin-react';\nimport babel from '@rolldown/plugin-babel';")
    .replace("from '../../vite-theme-plugin'", "from '../vite-theme-plugin'")
    .replace('path.dirname(fileURLToPath(import.meta.url))', JSON.stringify(web))
    .replace(compiler, `    react(),\n    babel({ presets: [reactCompilerPreset()], parallel: ${mode === 'parallel' ? 4 : 'false'} }),`));
}

const started = performance.now();
const build = { outDir };
if (mode !== 'current') build.target = ['chrome107', 'edge107', 'firefox104', 'safari16'];
await vite.build({
  root: web,
  configFile,
  cacheDir: path.join(scratch, 'cache', mode),
  build,
});
const seconds = (performance.now() - started) / 1000;

for (const page of ['index.html', 'mobile.html', 'mini-chat.html']) {
  const html = fs.readFileSync(path.join(outDir, page), 'utf8');
  const refs = Array.from(html.matchAll(/\b(?:src|href)=["'](?:\.\/|\/)?(assets\/[^"']+)["']/g), (match) => match[1]);
  const entry = /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["'](?:\.\/|\/)?(assets\/[^"']+\.js)["'][^>]*>/i.exec(html)?.[1];
  if (!entry || !refs.includes(entry) || refs.some((file) => !fs.statSync(path.join(outDir, file)).size)) {
    throw new Error(`Broken bundle references in ${page}`);
  }
}
if (!fs.statSync(path.join(outDir, 'sw.js')).size) throw new Error('Missing service worker');
const assets = fs.readdirSync(outDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath, entry.name));
const compilerProof = assets.find((file) => /^OnboardingScreen-.+\.js$/.test(path.basename(file))
  && fs.readFileSync(file, 'utf8').includes('react.memo_cache_sentinel'));
if (!compilerProof) throw new Error('Missing React Compiler memoization in OnboardingScreen');
const bytes = assets.reduce((total, file) => total + fs.statSync(file).size, 0);
console.log(`VITE_BENCHMARK ${JSON.stringify({ mode, pass, vite: vite.version, seconds, files: assets.length, bytes, compilerProof: path.basename(compilerProof) })}`);
