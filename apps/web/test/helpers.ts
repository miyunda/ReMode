import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JIANPU_EXAMPLE } from '../src/components/ImportPanel';
import { loadBytes, loadJianpuText, type LoadedInput } from '../src/lib/loadInput';

// jsdom replaces the global URL, so build file paths with node:path.
const FIXTURES = join(import.meta.dirname, '../../../fixtures/generated');

export const fixtureBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(FIXTURES, name)));

export function loadFixture(name: string): LoadedInput {
  const r = loadBytes(fixtureBytes(name), name);
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.failure)}`);
  return r.input;
}

export function loadExample(): LoadedInput {
  const r = loadJianpuText(JIANPU_EXAMPLE, null);
  if (!r.ok) throw new Error(JSON.stringify(r.failure));
  return r.input;
}
