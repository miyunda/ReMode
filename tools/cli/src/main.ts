#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { runCli } from './cli.js';

process.exitCode = runCli(process.argv.slice(2), {
  readFile: (path) => new Uint8Array(readFileSync(path)),
  writeFile: (path, bytes) => writeFileSync(path, bytes),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
