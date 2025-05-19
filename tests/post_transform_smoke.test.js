import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

const SPEC_PATH = path.join(process.cwd(), 'overlayed_specs', 'glean-merged-spec.yaml');

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

    const allowedPrefixes = ['/rest/api/v1', '/api/index/v1'];
    const hasUnexpected = paths.some((p) => !allowedPrefixes.some((prefix) => p.startsWith(prefix)));

    expect(hasUnexpected).toBe(false);
  });
}); 
