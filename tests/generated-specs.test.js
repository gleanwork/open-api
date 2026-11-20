import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { writeGeneratedSpecs } from '../src/index.js';

const sourceDir = path.join(process.cwd(), 'source_specs');
const sourceSpecFiles = fs
  .readdirSync(sourceDir)
  .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'));

function loadSourceSpec(file) {
  return yaml.load(fs.readFileSync(path.join(sourceDir, file), 'utf8'));
}

function operationIdsOf(spec) {
  return Object.values(spec.paths ?? {}).flatMap((pathItem) =>
    Object.values(pathItem ?? {})
      .map((operation) => operation?.operationId)
      .filter(Boolean),
  );
}

// Returns the JSON pointer of every node that matches, so a failure names it.
function findNodes(node, matches, pointer = '', found = []) {
  if (!node || typeof node !== 'object') return found;
  if (matches(node)) found.push(pointer || '/');
  for (const [key, value] of Object.entries(node)) {
    findNodes(value, matches, `${pointer}/${key}`, found);
  }
  return found;
}

function releaseStages(node) {
  const release = node['x-glean-release'];
  if (Array.isArray(release)) return release.map((entry) => entry?.stage);
  return release ? [release.stage] : [];
}

describe('source specs', () => {
  // The upstream bundle removes unreleased nodes and gated-by. open-api
  // has no strip step of its own, so anything left here is published.
  test.each(sourceSpecFiles)('%s has no unreleased nodes', (file) => {
    expect(
      findNodes(loadSourceSpec(file), (node) =>
        releaseStages(node).includes('unreleased'),
      ),
    ).toEqual([]);
  });

  test.each(sourceSpecFiles)('%s names no feature flags', (file) => {
    expect(
      findNodes(
        loadSourceSpec(file),
        (node) =>
          Object.hasOwn(node, 'gated-by') ||
          Object.hasOwn(node['x-glean-release'] ?? {}, 'gated-by'),
      ),
    ).toEqual([]);
  });
});

describe('writeGeneratedSpecs', () => {
  test('writes every source spec and keeps every operation', async () => {
    const outputDir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'generated-specs-')),
      'generated_specs',
    );

    await writeGeneratedSpecs({ sourceDir, outputDir, commitSha: 'abc123' });

    expect(fs.readdirSync(outputDir).sort()).toEqual(
      [...sourceSpecFiles].sort(),
    );
    for (const file of sourceSpecFiles) {
      const output = yaml.load(
        fs.readFileSync(path.join(outputDir, file), 'utf8'),
      );
      const outputIds = new Set(operationIdsOf(output));

      expect(output.info['x-open-api-commit-sha']).toBe('abc123');
      expect(
        operationIdsOf(loadSourceSpec(file)).filter((id) => !outputIds.has(id)),
      ).toEqual([]);
    }
  });
});
