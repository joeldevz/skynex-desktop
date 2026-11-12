#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageCliRuntime } from './package-cli-runtime.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--output' || arg === '--version') {
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    if (arg === '--output') options.outputDir = path.resolve(value);
    else options.version = value;
  } else throw new Error(`Unknown argument: ${arg}`);
}

const runtimeOptions = {
  webRoot,
  outputDir: options.outputDir ?? path.resolve(webRoot, '../../artifacts/cli'),
};
if (options.version) runtimeOptions.version = options.version;
const result = await packageCliRuntime(runtimeOptions);
console.log(`Packaged ${result.archivePath}`);
console.log(`SHA-256 ${result.checksumPath}`);
