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
const hasMergedPlatformSpec = (spec) => Boolean(spec.paths?.['/api/search']);

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

  test('merged spec keeps existing version and source traceability', () => {
    expect(spec.info?.version).toBe('0.9.0');
    expect(spec.info?.['x-source-commit-sha']).toBeDefined();
    expect(spec.info?.['x-open-api-commit-sha']).toBeDefined();
  });

  test('existing merged tag groups are preserved', () => {
    const tagGroupNames = (spec['x-tagGroups'] ?? []).map(({ name }) => name);

    expect(tagGroupNames).toContain('Search & Generative AI');
    expect(tagGroupNames).toContain('Connected Content');
    expect(tagGroupNames).not.toEqual(['AI', 'Data Retrieval']);
  });

  test('all paths use expected base prefixes', () => {
    const paths = Object.keys(spec.paths ?? {});

    expect(paths.length).toBeGreaterThan(0);

    const allowedPrefixes = [
      '/rest/api/v1',
      '/api/index/v1',
      '/api/',
      '/rest/api/index/',
    ];
    const hasUnexpected = paths.some(
      (p) => !allowedPrefixes.some((prefix) => p.startsWith(prefix)),
    );

    expect(hasUnexpected).toBe(false);
  });

  test('Custom Metadata operations land under indexing.customMetadata SDK group', () => {
    const customMetadataOps = [
      {
        path: '/rest/api/index/document/{docId}/custom-metadata/{groupName}',
        method: 'put',
        nameOverride: 'upsert',
      },
      {
        path: '/rest/api/index/document/{docId}/custom-metadata/{groupName}',
        method: 'delete',
        nameOverride: 'delete',
      },
      {
        path: '/rest/api/index/custom-metadata/schema/{groupName}',
        method: 'get',
        nameOverride: 'getSchema',
      },
      {
        path: '/rest/api/index/custom-metadata/schema/{groupName}',
        method: 'put',
        nameOverride: 'upsertSchema',
      },
      {
        path: '/rest/api/index/custom-metadata/schema/{groupName}',
        method: 'delete',
        nameOverride: 'deleteSchema',
      },
    ];

    for (const { path, method, nameOverride } of customMetadataOps) {
      const operation = spec.paths?.[path]?.[method];

      expect(
        operation,
        `expected operation ${method.toUpperCase()} ${path}`,
      ).toBeDefined();
      expect(operation['x-speakeasy-group']).toBe('indexing.customMetadata');
      expect(operation['x-speakeasy-name-override']).toBe(nameOverride);
    }
  });

  test('CustomMetadataSchema is narrowed via CustomMetadataPropertyDefinition', () => {
    const schemas = spec.components?.schemas ?? {};

    const propertyDef = schemas.CustomMetadataPropertyDefinition;
    expect(
      propertyDef,
      'CustomMetadataPropertyDefinition schema',
    ).toBeDefined();
    expect(Object.keys(propertyDef.properties ?? {}).sort()).toEqual([
      'name',
      'propertyType',
      'skipIndexing',
    ]);
    expect(propertyDef.required).toEqual(['name', 'propertyType']);

    const customMetadataSchema = schemas.CustomMetadataSchema;
    expect(customMetadataSchema, 'CustomMetadataSchema').toBeDefined();
    expect(customMetadataSchema.properties?.metadataKeys?.items?.$ref).toBe(
      '#/components/schemas/CustomMetadataPropertyDefinition',
    );
  });

  test('Platform operations land under expected SDK groups', () => {
    if (!hasMergedPlatformSpec(spec)) {
      return;
    }

    const platformOps = [
      {
        path: '/api/agents/search',
        method: 'post',
        group: 'agents',
        nameOverride: 'search',
      },
      {
        path: '/api/agents/{agent_id}',
        method: 'get',
        group: 'agents',
        nameOverride: 'get',
      },
      {
        path: '/api/agents/{agent_id}/schemas',
        method: 'get',
        group: 'agents',
        nameOverride: 'getSchemas',
      },
      {
        path: '/api/agents/{agent_id}/runs',
        method: 'post',
        group: 'agents',
        nameOverride: 'createRun',
      },
      {
        path: '/api/search',
        method: 'post',
        group: 'search',
        nameOverride: 'query',
      },
    ];

    for (const { path, method, group, nameOverride } of platformOps) {
      const operation = spec.paths?.[path]?.[method];

      expect(
        operation,
        `expected operation ${method.toUpperCase()} ${path}`,
      ).toBeDefined();
      expect(operation['x-speakeasy-group']).toBe(group);
      expect(operation['x-speakeasy-name-override']).toBe(nameOverride);
      expect(operation['x-glean-sdk']).toBeUndefined();
    }
  });

  test('Platform merged spec retains streaming run response', () => {
    if (!hasMergedPlatformSpec(spec)) {
      return;
    }

    const operation = spec.paths?.['/api/agents/{agent_id}/runs']?.post;

    expect(operation?.responses?.['200']?.content).toHaveProperty(
      'text/event-stream',
    );
  });

  test('Platform private runtime gates do not reach merged spec', () => {
    if (!hasMergedPlatformSpec(spec)) {
      return;
    }

    expect(JSON.stringify(spec)).not.toContain('gated-by');
  });

  test('every operation carries an x-speakeasy-group with an allowed top-level namespace', () => {
    // The SDK namespace is derived from x-speakeasy-group. Any operation
    // without a group silently falls back to its `tags` and leaks a method to
    // the SDK top level. The top level is reserved for the Platform API, so
    // client/indexing operations must be nested under `client.*` / `indexing.*`.
    // `agents` and `search` are the intentional Platform (top-level) groups.
    const allowedTopLevelSegments = new Set([
      'client',
      'indexing',
      'agents',
      'search',
    ]);
    const methods = ['get', 'post', 'put', 'delete', 'patch'];

    const ungrouped = [];
    const badTopLevel = [];

    for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
      for (const method of methods) {
        const operation = pathItem?.[method];
        if (!operation) continue;

        const group = operation['x-speakeasy-group'];
        if (!group) {
          ungrouped.push(`${method.toUpperCase()} ${path}`);
          continue;
        }

        const topLevelSegment = group.split('.')[0];
        if (!allowedTopLevelSegments.has(topLevelSegment)) {
          badTopLevel.push(`${method.toUpperCase()} ${path} -> ${group}`);
        }
      }
    }

    expect(
      ungrouped,
      `operations missing x-speakeasy-group (they would leak to the SDK top level via their tags):\n${ungrouped.join('\n')}`,
    ).toEqual([]);
    expect(
      badTopLevel,
      `operations with an unexpected top-level SDK namespace:\n${badTopLevel.join('\n')}`,
    ).toEqual([]);
  });
});
