#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

/**
 * Provenance guard. Needles are assembled from fragments so this file never
 * spells a forbidden identifier in full.
 */
const denied = [
  ['open', 'card', 'board'],
  ['cut', 'board'],
  ['@', 'cut', 'board'],
  ['cb', 'media', '://'],
  ['cut', 'board', '_'],
].map((parts) => parts.join('').toLowerCase());

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const MAX_BYTES = 2_000_000;
const findings = [];

for (const file of files) {
  let stats;
  try {
    stats = statSync(file);
  } catch {
    continue;
  }

  if (!stats.isFile() || stats.size > MAX_BYTES) {
    continue;
  }

  const buffer = readFileSync(file);
  if (buffer.includes(0)) {
    continue;
  }

  const text = buffer.toString('utf8').toLowerCase();
  for (const needle of denied) {
    const index = text.indexOf(needle);
    if (index === -1) {
      continue;
    }

    const line = text.slice(0, index).split('\n').length;
    findings.push(`${file}:${line}: forbidden identifier`);
    break;
  }
}

if (findings.length > 0) {
  console.error('Provenance audit failed:');
  for (const finding of findings) {
    console.error(`  ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Provenance audit passed (${files.length} tracked files).`);
}
