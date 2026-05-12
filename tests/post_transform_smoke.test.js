import { beforeEach, describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

const SPEC_PATH = path.join(
  process.cwd(),
  'overlayed_specs',
  'glean-merged-spec.yaml',
);

const loadSpec = () => yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));

describe('Post-transformation smoke tests', () => {
  let spec;

  beforeEach(() => {
    spec = loadSpec();
  });

  test('spec parses successfully', () => {
    expect(spec && typeof spec === 'object').toBe(true);
  });

  test('server URL uses {instance}', () => {
    expect(spec.servers?.length).toBeGreaterThan(0);

    const url = spec.servers[0].url;

    expect(url.includes('{instance}')).toBe(true);
    expect(url.includes('{domain}')).toBe(false);
  });

  test('security scheme is APIToken only', () => {
    const schemes = spec.components?.securitySchemes ?? {};

    expect('APIToken' in schemes).toBe(true);
    expect('BearerAuth' in schemes).toBe(false);
    expect('actAsBearerToken' in schemes).toBe(false);
    expect('cookieAuth' in schemes).toBe(false);
  });

  test('contains IndexingShortcut component', () => {
    const schemas = spec.components?.schemas ?? {};

    expect('IndexingShortcut' in schemas).toBe(true);
  });

  test('overlay applied title', () => {
    expect(spec.info?.title).toBe('Glean API');
  });

  test('all paths use expected base prefixes', () => {
    const paths = Object.keys(spec.paths ?? {});

    expect(paths.length).toBeGreaterThan(0);

    const hasAllowedPrefix = (path) =>
      path.startsWith('/rest/api/v1') ||
      path.startsWith('/api/index/v1') ||
      path === '/api' ||
      path.startsWith('/api/');
    const hasUnexpected = paths.some((path) => !hasAllowedPrefix(path));

    expect(hasUnexpected).toBe(false);
  });

  test('platform endpoints have expected SDK mappings', () => {
    expect(spec.paths?.['/api/search']?.post).toMatchObject({
      operationId: 'platform-search',
      'x-speakeasy-group': 'platform.search',
      'x-speakeasy-name-override': 'query',
    });
    expect(spec.paths?.['/api/tools']?.get).toMatchObject({
      operationId: 'platform-tools-list',
      'x-speakeasy-group': 'platform.tools',
      'x-speakeasy-name-override': 'list',
    });
  });

  test('platform experimental metadata does not publish runtime gates', () => {
    for (const operation of [
      spec.paths?.['/api/search']?.post,
      spec.paths?.['/api/tools']?.get,
    ]) {
      expect(operation?.['x-glean-experimental']).toMatchObject({
        id: expect.any(String),
        introduced: expect.any(String),
      });
      expect(operation?.['x-glean-experimental']).not.toHaveProperty(
        'gated-by',
      );
    }
  });
});
