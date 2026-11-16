import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import yaml from 'js-yaml';
import { beforeAll, describe, expect, test } from 'vitest';

// Runs the real Speakeasy overlay engine: the overlay's JSONPath depends on
// Speakeasy-specific evaluation behavior that a reimplementation would not catch.
describe('public-visibility overlay', () => {
  let spec;

  beforeAll(async () => {
    const outputPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'public-visibility-')),
      'out.yaml',
    );
    await execa('speakeasy', [
      'overlay',
      'apply',
      '--schema',
      'tests/fixtures/public-visibility.yaml',
      '--overlay',
      'overlays/public-visibility-overlay.yaml',
      '--out',
      outputPath,
    ]);
    spec = yaml.load(fs.readFileSync(outputPath, 'utf8'));
  });

  test('marks unannotated indexing operations Public', () => {
    expect(
      spec.paths['/api/index/v1/documents/{id}'].post['x-visibility'],
    ).toBe('Public');
  });

  test('keeps explicitly Public operations', () => {
    expect(spec.paths['/api/index/v1/documents/{id}'].get.operationId).toBe(
      'publicClient',
    );
  });

  test('removes Internal operations, including Internal indexing operations', () => {
    expect(spec.paths['/api/index/v1/documents/{id}']).not.toHaveProperty(
      'put',
    );
    expect(spec.paths).not.toHaveProperty('/rest/api/v1/internal-only');
  });

  test('removes unannotated operations outside the Indexing API', () => {
    expect(spec.paths['/api/index/v1/documents/{id}']).not.toHaveProperty(
      'delete',
    );
  });

  test('preserves path-level servers and parameters', () => {
    const pathItem = spec.paths['/api/index/v1/documents/{id}'];

    expect(pathItem.servers).toEqual([
      { url: 'https://{instance}-be.glean.com' },
    ]);
    expect(pathItem.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  test('preserves info.version', () => {
    expect(spec.info.version).toBe('7.8.9');
  });
});
