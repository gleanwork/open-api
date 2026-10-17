import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import {
  loadUnreleasedOperations,
  stripUnreleasedOperations,
  PLATFORM_TAG_GROUPS_KEY,
  transform,
} from '../src/source-spec-transformer.js';
import { transformSourceSpec, writeGeneratedSpecs } from '../src/index.js';

function operationIdsOf(spec) {
  return Object.values(spec.paths ?? {}).flatMap((pathItem) =>
    Object.values(pathItem).map((operation) => operation?.operationId),
  );
}

function specWithDocuments() {
  return {
    openapi: '3.1.0',
    info: { title: 'Glean Platform API', version: '2026-04-01' },
    paths: {
      '/documents': {
        parameters: [{ $ref: '#/components/parameters/Include' }],
        get: {
          operationId: 'platform-documents-get-by-url',
          tags: ['Documents'],
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DocumentGetResponse' },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
          },
        },
      },
      '/search': {
        post: {
          operationId: 'platform-search',
          tags: ['Search'],
          parameters: [{ $ref: '#/components/parameters/Include' }],
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SearchResponse' },
                },
              },
            },
            400: { $ref: '#/components/responses/BadRequest' },
          },
        },
      },
      '/metadata-only': { summary: 'A path item with no operations' },
    },
    tags: [{ name: 'Documents' }, { name: 'Search' }],
    'x-tagGroups': [
      { name: 'Search & Data', tags: ['Search', 'Documents'] },
      { name: 'Unreleased', tags: ['Documents'] },
    ],
    components: {
      securitySchemes: { APIToken: { type: 'http', scheme: 'bearer' } },
      parameters: { Include: { name: 'include', in: 'query' } },
      responses: { BadRequest: { description: 'Bad request' } },
      schemas: {
        DocumentGetResponse: {
          type: 'object',
          properties: { document: { $ref: '#/components/schemas/Document' } },
        },
        Document: {
          type: 'object',
          properties: { owner: { $ref: '#/components/schemas/Person' } },
        },
        SearchResponse: {
          type: 'object',
          properties: { owner: { $ref: '#/components/schemas/Person' } },
        },
        Person: { type: 'object' },
        AlreadyUnused: { type: 'object' },
      },
    },
  };
}

describe('stripUnreleasedOperations', () => {
  test('removes the operation, its empty path, tag and tag group', () => {
    const spec = stripUnreleasedOperations(
      specWithDocuments(),
      ['platform-documents-get-by-url'],
      'platform.yaml',
    );

    expect(Object.keys(spec.paths)).toEqual(['/search', '/metadata-only']);
    expect(spec.tags).toEqual([{ name: 'Search' }]);
    expect(spec['x-tagGroups']).toEqual([
      { name: 'Search & Data', tags: ['Search'] },
    ]);
  });

  test('removes only the components that the removed operations used', () => {
    const { components } = stripUnreleasedOperations(
      specWithDocuments(),
      ['platform-documents-get-by-url'],
      'platform.yaml',
    );

    expect(Object.keys(components.schemas).sort()).toEqual([
      'AlreadyUnused',
      'Person',
      'SearchResponse',
    ]);
    expect(components.parameters).toHaveProperty('Include');
    expect(components.responses).toHaveProperty('BadRequest');
    expect(components.securitySchemes).toHaveProperty('APIToken');
  });

  test('keeps a tag that a remaining operation still uses', () => {
    const spec = specWithDocuments();
    spec.paths['/documents/{id}'] = {
      get: {
        operationId: 'platform-documents-get',
        tags: ['Documents'],
        responses: { 200: { description: 'OK' } },
      },
    };

    stripUnreleasedOperations(
      spec,
      ['platform-documents-get-by-url'],
      'platform.yaml',
    );

    expect(spec.tags).toContainEqual({ name: 'Documents' });
    expect(spec['x-tagGroups'][0].tags).toEqual(['Search', 'Documents']);
  });

  test('keeps schemas that a discriminator mapping names', () => {
    const spec = specWithDocuments();
    spec.components.schemas.SearchResponse.discriminator = {
      propertyName: 'type',
      mapping: { DOCUMENT: 'Document' },
    };

    stripUnreleasedOperations(
      spec,
      ['platform-documents-get-by-url'],
      'platform.yaml',
    );

    expect(spec.components.schemas).toHaveProperty('Document');
    expect(spec.components.schemas).not.toHaveProperty('DocumentGetResponse');
  });

  test('keeps a schema that a remaining deep ref points into', () => {
    const spec = specWithDocuments();
    spec.components.schemas.SearchResponse.properties.document = {
      $ref: '#/components/schemas/Document/properties/owner',
    };

    stripUnreleasedOperations(
      spec,
      ['platform-documents-get-by-url'],
      'platform.yaml',
    );

    expect(spec.components.schemas).toHaveProperty('Document');
  });

  test('fails when a listed operation is not in the spec', () => {
    expect(() =>
      stripUnreleasedOperations(
        specWithDocuments(),
        ['platform-documents-renamed'],
        'platform.yaml',
      ),
    ).toThrow(/platform\.yaml does not have: platform-documents-renamed/);
  });

  test('leaves the spec unchanged when nothing is listed', () => {
    const spec = specWithDocuments();
    stripUnreleasedOperations(spec, undefined, 'platform.yaml');

    expect(spec).toEqual(specWithDocuments());
  });
});

describe('transform', () => {
  const unreleased = ['platform-documents-get-by-url'];

  test.each([
    ['has no servers', []],
    ['has a server with no URL', [{ description: 'No URL' }]],
    ['has a server URL with no base path', [{ url: 'https://example.com' }]],
  ])('strips unreleased operations when the spec %s', (_name, servers) => {
    const spec = { ...specWithDocuments(), servers };

    const output = yaml.load(
      transform(yaml.dump(spec), 'platform.yaml', undefined, unreleased),
    );

    expect(operationIdsOf(output)).not.toContain(
      'platform-documents-get-by-url',
    );
    expect(operationIdsOf(output)).toContain('platform-search');
  });

  test('fails on a missing operation even when the spec has no base path', () => {
    const spec = {
      ...specWithDocuments(),
      servers: [{ url: 'https://example.com' }],
    };

    expect(() =>
      transform(yaml.dump(spec), 'platform.yaml', undefined, [
        'platform-documents-renamed',
      ]),
    ).toThrow(/does not have: platform-documents-renamed/);
  });
});

describe('writeGeneratedSpecs', () => {
  function tempDirs() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-specs-'));
    const sourceDir = path.join(root, 'source_specs');
    fs.mkdirSync(sourceDir);
    fs.copyFileSync(
      path.join(process.cwd(), 'source_specs', 'platform.yaml'),
      path.join(sourceDir, 'platform.yaml'),
    );
    return { sourceDir, outputDir: path.join(root, 'generated_specs') };
  }

  test('writes the Platform spec without the committed unreleased operations', async () => {
    const dirs = tempDirs();

    await writeGeneratedSpecs(dirs);

    const output = yaml.load(
      fs.readFileSync(path.join(dirs.outputDir, 'platform.yaml'), 'utf8'),
    );
    const unreleased = loadUnreleasedOperations()['platform.yaml'];
    expect(unreleased.length).toBeGreaterThan(0);
    expect(
      operationIdsOf(output).filter((id) =>
        unreleased.some((op) => id === op || id?.startsWith(`${op}-`)),
      ),
    ).toEqual([]);
  });

  test('fails when the list names a source spec that does not exist', async () => {
    const dirs = tempDirs();

    await expect(
      writeGeneratedSpecs({
        ...dirs,
        unreleasedOperations: {
          'platfrom.yaml': ['platform-documents-get'],
        },
      }),
    ).rejects.toThrow(/does not have: platfrom\.yaml/);
    expect(fs.existsSync(dirs.outputDir)).toBe(false);
  });
});

describe('loadUnreleasedOperations', () => {
  function writeConfig(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unreleased-'));
    const file = path.join(dir, 'unreleased-operations.yaml');
    fs.writeFileSync(file, content);
    return file;
  }

  test('reads operationIds by source spec file name', () => {
    const file = writeConfig(
      'platform.yaml:\n  - operationId: platform-documents-get\n    reason: Not released.\n',
    );

    expect(loadUnreleasedOperations(file)).toEqual({
      'platform.yaml': ['platform-documents-get'],
    });
  });

  test('requires a reason for each entry', () => {
    const file = writeConfig(
      'platform.yaml:\n  - operationId: platform-documents-get\n',
    );

    expect(() => loadUnreleasedOperations(file)).toThrow(/needs a reason/);
  });

  test('reads the committed list', () => {
    expect(() => loadUnreleasedOperations()).not.toThrow();
  });
});

describe('unreleased Platform operations', () => {
  const sourceSpec = fs.readFileSync(
    path.join(process.cwd(), 'source_specs', 'platform.yaml'),
    'utf8',
  );
  const unreleased = loadUnreleasedOperations()['platform.yaml'] ?? [];

  test('are listed only when the source spec still has them', () => {
    const operationIds = new Set(
      Object.values(yaml.load(sourceSpec).paths).flatMap((pathItem) =>
        Object.values(pathItem).map((operation) => operation?.operationId),
      ),
    );

    expect(unreleased.filter((id) => !operationIds.has(id))).toEqual([]);
  });

  test('are left out of the generated Platform spec', () => {
    const spec = yaml.load(transformSourceSpec(sourceSpec, 'platform.yaml'));
    const operationIds = Object.values(spec.paths).flatMap((pathItem) =>
      Object.values(pathItem).map((operation) => operation?.operationId),
    );

    expect(unreleased.length).toBeGreaterThan(0);
    for (const id of unreleased) {
      expect(
        operationIds.some((op) => op === id || op?.startsWith(`${id}-`)),
      ).toBe(false);
    }
  });

  test('take the Documents tag group entry and schemas with them', () => {
    const spec = yaml.load(transformSourceSpec(sourceSpec, 'platform.yaml'));
    const groupedTags = spec[PLATFORM_TAG_GROUPS_KEY].flatMap(
      (group) => group.tags,
    );

    expect(groupedTags).not.toContain('Documents');
    expect(Object.keys(spec.components.schemas)).not.toContain(
      'PlatformDocumentsBatchRequest',
    );
  });
});
