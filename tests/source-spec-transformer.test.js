import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  transform,
  extractBasePath,
  transformShortcutComponent,
  transformBearerAuthToAPIToken,
  transformServerVariables,
  transformEnumDescriptions,
  transformGleanDeprecated,
  injectOpenApiCommitSha,
} from '../src/source-spec-transformer.js';

function readFixture(filename) {
  const sourceFile = path.join(process.cwd(), 'source_specs', filename);
  return fs.readFileSync(sourceFile, 'utf8');
}

describe('OpenAPI YAML Transformer', () => {
  test('extractBasePath extracts path correctly', () => {
    expect(extractBasePath('https://{domain}-be.glean.com/rest/api/v1')).toBe(
      '/rest/api/v1',
    );
    expect(extractBasePath('https://example.com/api/')).toBe('/api');
    expect(extractBasePath('https://example.com')).toBe('');
  });

  test('transforms client API YAML correctly', () => {
    const clientYaml = readFixture('client_rest.yaml');
    const transformedContent = transform(clientYaml, 'client_rest.yaml');

    const originalSpec = yaml.load(clientYaml);
    const transformedSpec = yaml.load(transformedContent);

    const originalBasePath = extractBasePath(originalSpec.servers[0].url);

    expect(transformedSpec.servers[0].url).not.toContain(originalBasePath);
    expect(transformedSpec.servers[0].url).toBe(
      'https://{instance}-be.glean.com',
    );

    const originalPaths = Object.keys(originalSpec.paths);
    const transformedPaths = Object.keys(transformedSpec.paths);

    expect(transformedPaths.length).toBe(originalPaths.length);

    for (const originalPath of originalPaths) {
      const expectedTransformedPath = `${originalBasePath}${originalPath}`;
      expect(transformedSpec.paths).toHaveProperty(expectedTransformedPath);

      const originalOperations = originalSpec.paths[originalPath];
      const transformedOperations =
        transformedSpec.paths[expectedTransformedPath];

      expect(Object.keys(transformedOperations)).toEqual(
        Object.keys(originalOperations),
      );
    }

    for (const path of transformedPaths) {
      expect(path.startsWith(originalBasePath)).toBe(true);
    }
  });

  test('transforms indexing API YAML correctly', () => {
    const indexingYaml = readFixture('indexing.yaml');
    const transformedContent = transform(indexingYaml, 'indexing.yaml');

    const originalSpec = yaml.load(indexingYaml);
    const transformedSpec = yaml.load(transformedContent);

    const originalBasePath = extractBasePath(originalSpec.servers[0].url);

    expect(transformedSpec.servers[0].url).not.toContain(originalBasePath);
    expect(transformedSpec.servers[0].url).toBe(
      'https://{instance}-be.glean.com',
    );

    const originalPaths = Object.keys(originalSpec.paths);
    const transformedPaths = Object.keys(transformedSpec.paths);

    expect(transformedPaths.length).toBe(originalPaths.length);

    for (const originalPath of originalPaths) {
      const expectedTransformedPath = `${originalBasePath}${originalPath}`;
      expect(transformedSpec.paths).toHaveProperty(expectedTransformedPath);

      const originalOperations = originalSpec.paths[originalPath];
      const transformedOperations =
        transformedSpec.paths[expectedTransformedPath];

      expect(Object.keys(transformedOperations)).toEqual(
        Object.keys(originalOperations),
      );
    }

    for (const path of transformedPaths) {
      expect(path.startsWith(originalBasePath)).toBe(true);
    }

    if (
      originalSpec.components &&
      originalSpec.components.schemas &&
      originalSpec.components.schemas.Shortcut
    ) {
      expect(transformedSpec.components.schemas).not.toHaveProperty('Shortcut');
      expect(transformedSpec.components.schemas).toHaveProperty(
        'IndexingShortcut',
      );
    }
  });

  test('preserves path operation properties', () => {
    const clientYaml = readFixture('client_rest.yaml');
    const transformedContent = transform(clientYaml, 'client_rest.yaml');
    const originalSpec = yaml.load(clientYaml);
    const transformedSpec = yaml.load(transformedContent);

    const originalPath = Object.keys(originalSpec.paths)[0];
    const originalBasePath = extractBasePath(originalSpec.servers[0].url);
    const transformedPath = `${originalBasePath}${originalPath}`;

    const method = Object.keys(originalSpec.paths[originalPath])[0];

    const originalOperation = originalSpec.paths[originalPath][method];
    const transformedOperation = transformedSpec.paths[transformedPath][method];

    if (originalOperation.operationId) {
      expect(transformedOperation.operationId).toBe(
        originalOperation.operationId,
      );
    }

    if (originalOperation.summary) {
      expect(transformedOperation.summary).toBe(originalOperation.summary);
    }

    if (originalOperation.description) {
      expect(transformedOperation.description).toBe(
        originalOperation.description,
      );
    }

    if (originalOperation.tags) {
      expect(transformedOperation.tags).toEqual(originalOperation.tags);
    }

    if (originalOperation.parameters) {
      expect(transformedOperation.parameters.length).toBe(
        originalOperation.parameters.length,
      );
    }

    if (originalOperation.responses) {
      expect(Object.keys(transformedOperation.responses)).toEqual(
        Object.keys(originalOperation.responses),
      );
    }
  });

  test('transformShortcutComponent renames Shortcut to IndexingShortcut', () => {
    const indexingYaml = readFixture('indexing.yaml');
    const transformedContent = transform(indexingYaml, 'indexing.yaml');
    const transformedSpec = yaml.load(transformedContent);

    expect(transformedSpec.components.schemas).toHaveProperty(
      'IndexingShortcut',
    );
    expect(transformedSpec.components.schemas).not.toHaveProperty('Shortcut');
  });

  ['client_rest.yaml', 'indexing.yaml'].forEach((filename) => {
    test(`transformBearerAuthToAPIToken renames BearerAuth to APIToken in ${filename}`, () => {
      const yamlContent = readFixture(filename);
      const transformedContent = transform(yamlContent, filename);
      const transformedSpec = yaml.load(transformedContent);

      expect(transformedSpec.security[0]).toHaveProperty('APIToken');
      expect(transformedSpec.components.securitySchemes).toHaveProperty(
        'APIToken',
      );
      expect(transformedSpec.components.securitySchemes).not.toHaveProperty(
        'BearerAuth',
      );
    });
  });

  test(`transformBearerAuthToAPIToken renames actAsBearerToken to APIToken in admin_rest.yaml`, () => {
    const yamlContent = readFixture('admin_rest.yaml');
    const transformedContent = transform(yamlContent, 'admin_rest.yaml');
    const transformedSpec = yaml.load(transformedContent);

    expect(transformedSpec.security[0]).toHaveProperty('APIToken');
    expect(transformedSpec.security[0]).not.toHaveProperty('actAsBearerToken');
    const hasCookie = transformedSpec.security.some((s) => 'cookieAuth' in s);
    expect(hasCookie).toBe(
      false,
      'cookieAuth should not be present in security',
    );
  });

  ['client_rest.yaml', 'indexing.yaml'].forEach((filename) => {
    test(`transformServerVariables changes 'domain' to 'instance' in ${filename}`, () => {
      const yamlContent = readFixture(filename);
      const transformedContent = transform(yamlContent, filename);
      const transformedSpec = yaml.load(transformedContent);

      // Check that server URL now uses {instance}
      expect(transformedSpec.servers[0].url).toContain('{instance}');
      expect(transformedSpec.servers[0].url).not.toContain('{domain}');

      // Check that variables section has instance instead of domain
      expect(transformedSpec.servers[0].variables).toHaveProperty('instance');
      expect(transformedSpec.servers[0].variables).not.toHaveProperty('domain');

      // Check new values are set correctly
      expect(transformedSpec.servers[0].variables.instance.default).toBe(
        'instance-name',
      );
      expect(
        transformedSpec.servers[0].variables.instance.description,
      ).toContain('instance name');
    });
  });

  test('transformServerVariables changes domain to instance in server variables', () => {
    const testSpec = {
      servers: [
        {
          url: 'https://{domain}-be.glean.com/api/test',
          variables: {
            domain: {
              default: 'domain',
              description:
                'Email domain (without extension) that determines the deployment backend.',
            },
          },
        },
      ],
    };

    const transformedSpec = transformServerVariables(testSpec);

    expect(transformedSpec.servers[0].url).toBe(
      'https://{instance}-be.glean.com/api/test',
    );
    expect(transformedSpec.servers[0].variables).toHaveProperty('instance');
    expect(transformedSpec.servers[0].variables).not.toHaveProperty('domain');
    expect(transformedSpec.servers[0].variables.instance.default).toBe(
      'instance-name',
    );
    expect(transformedSpec.servers[0].variables.instance.description).toContain(
      'instance name',
    );
  });

  test('transformEnumDescriptions converts x-enumDescriptions to x-speakeasy-enum-descriptions', () => {
    const testSpec = {
      components: {
        schemas: {
          TestEnum: {
            type: 'string',
            enum: ['VALUE1', 'VALUE2', 'VALUE3'],
            'x-enumDescriptions': {
              VALUE1: 'Description for value 1',
              VALUE2: 'Description for value 2',
              VALUE3: 'Description for value 3',
            },
          },
          NestedSchema: {
            properties: {
              status: {
                type: 'string',
                enum: ['PENDING', 'ACTIVE', 'COMPLETED'],
                'x-enumDescriptions': {
                  PENDING: 'Task is pending',
                  ACTIVE: 'Task is active',
                  COMPLETED: 'Task is completed',
                },
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformEnumDescriptions(testSpec);

    expect(transformedSpec).toMatchInlineSnapshot(`
      {
        "components": {
          "schemas": {
            "NestedSchema": {
              "properties": {
                "status": {
                  "enum": [
                    "PENDING",
                    "ACTIVE",
                    "COMPLETED",
                  ],
                  "type": "string",
                  "x-enumDescriptions": {
                    "ACTIVE": "Task is active",
                    "COMPLETED": "Task is completed",
                    "PENDING": "Task is pending",
                  },
                  "x-speakeasy-enum-descriptions": {
                    "ACTIVE": "Task is active",
                    "COMPLETED": "Task is completed",
                    "PENDING": "Task is pending",
                  },
                },
              },
            },
            "TestEnum": {
              "enum": [
                "VALUE1",
                "VALUE2",
                "VALUE3",
              ],
              "type": "string",
              "x-enumDescriptions": {
                "VALUE1": "Description for value 1",
                "VALUE2": "Description for value 2",
                "VALUE3": "Description for value 3",
              },
              "x-speakeasy-enum-descriptions": {
                "VALUE1": "Description for value 1",
                "VALUE2": "Description for value 2",
                "VALUE3": "Description for value 3",
              },
            },
          },
        },
      }
    `);
  });

  test('transformEnumDescriptions handles specs without x-enumDescriptions', () => {
    const testSpec = {
      components: {
        schemas: {
          SimpleEnum: {
            type: 'string',
            enum: ['A', 'B', 'C'],
          },
        },
      },
    };

    const transformedSpec = transformEnumDescriptions(testSpec);

    expect(transformedSpec).toMatchInlineSnapshot(`
      {
        "components": {
          "schemas": {
            "SimpleEnum": {
              "enum": [
                "A",
                "B",
                "C",
              ],
              "type": "string",
            },
          },
        },
      }
    `);
  });

  test('injectOpenApiCommitSha adds x-open-api-commit-sha to info section', () => {
    const testSpec = {
      info: {
        version: '1.0.0',
        title: 'Test API',
        'x-source-commit-sha': 'abc123',
      },
    };

    const commitSha = 'def456';
    const transformedSpec = injectOpenApiCommitSha(testSpec, commitSha);

    expect(transformedSpec.info['x-open-api-commit-sha']).toBe(commitSha);
    expect(transformedSpec.info['x-source-commit-sha']).toBe('abc123');
    expect(transformedSpec.info.version).toBe('1.0.0');
  });

  test('injectOpenApiCommitSha handles spec without info section', () => {
    const testSpec = {
      paths: {},
    };

    const commitSha = 'xyz789';
    const transformedSpec = injectOpenApiCommitSha(testSpec, commitSha);

    expect(transformedSpec.info).toBeDefined();
    expect(transformedSpec.info['x-open-api-commit-sha']).toBe(commitSha);
  });

  test('injectOpenApiCommitSha does nothing when commitSha is not provided', () => {
    const testSpec = {
      info: {
        version: '1.0.0',
        title: 'Test API',
      },
    };

    const transformedSpec = injectOpenApiCommitSha(testSpec, null);

    expect(transformedSpec.info['x-open-api-commit-sha']).toBeUndefined();
    expect(transformedSpec.info.version).toBe('1.0.0');
  });

  test('transform includes x-open-api-commit-sha when commitSha is provided', () => {
    const clientYaml = readFixture('client_rest.yaml');
    const commitSha = 'test-commit-sha-123';
    const transformedContent = transform(
      clientYaml,
      'client_rest.yaml',
      commitSha,
    );
    const transformedSpec = yaml.load(transformedContent);

    expect(transformedSpec.info['x-open-api-commit-sha']).toBe(commitSha);
    expect(transformedSpec.info['x-source-commit-sha']).toBeDefined();
  });

  test('transform does not include x-open-api-commit-sha when commitSha is not provided', () => {
    const clientYaml = readFixture('client_rest.yaml');
    const transformedContent = transform(clientYaml, 'client_rest.yaml');
    const transformedSpec = yaml.load(transformedContent);

    expect(transformedSpec.info['x-open-api-commit-sha']).toBeUndefined();
  });

  test('transformGleanDeprecated adds Speakeasy deprecation fields to operations', () => {
    const testSpec = {
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            'x-glean-deprecated': {
              id: 'uuid-123',
              message: 'Use /v2/test instead',
              introduced: '2024-01-15',
              removal: '2024-07-15',
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);

    expect(transformedSpec.paths['/test'].get.deprecated).toBe(true);
    expect(
      transformedSpec.paths['/test'].get['x-speakeasy-deprecation-message'],
    ).toBe(
      'Deprecated on 2024-01-15, removal scheduled for 2024-07-15: Use /v2/test instead',
    );
    // Verify original annotation is preserved
    expect(
      transformedSpec.paths['/test'].get['x-glean-deprecated'],
    ).toBeDefined();
    expect(transformedSpec.paths['/test'].get['x-glean-deprecated'].id).toBe(
      'uuid-123',
    );
  });

  test('transformGleanDeprecated adds Speakeasy deprecation fields to parameters', () => {
    const testSpec = {
      paths: {
        '/test': {
          get: {
            parameters: [
              {
                name: 'oldParam',
                in: 'query',
                'x-glean-deprecated': {
                  id: 'param-uuid',
                  message: 'Use newParam instead',
                  introduced: '2024-02-01',
                  removal: '2024-08-01',
                },
              },
            ],
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);

    const param = transformedSpec.paths['/test'].get.parameters[0];
    expect(param.deprecated).toBe(true);
    expect(param['x-speakeasy-deprecation-message']).toBe(
      'Deprecated on 2024-02-01, removal scheduled for 2024-08-01: Use newParam instead',
    );
    expect(param['x-glean-deprecated']).toBeDefined();
  });

  test('transformGleanDeprecated adds Speakeasy deprecation fields to schema properties', () => {
    const testSpec = {
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              oldField: {
                type: 'string',
                'x-glean-deprecated': {
                  id: 'schema-uuid',
                  message: 'Field renamed to newField',
                  introduced: '2024-03-01',
                  removal: '2024-09-01',
                  docs: 'https://docs.example.com/migration',
                },
              },
              newField: {
                type: 'string',
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);

    const oldField =
      transformedSpec.components.schemas.TestSchema.properties.oldField;
    expect(oldField.deprecated).toBe(true);
    expect(oldField['x-speakeasy-deprecation-message']).toBe(
      'Deprecated on 2024-03-01, removal scheduled for 2024-09-01: Field renamed to newField',
    );
    expect(oldField['x-glean-deprecated']).toBeDefined();
    expect(oldField['x-glean-deprecated'].docs).toBe(
      'https://docs.example.com/migration',
    );

    // Verify non-deprecated field is unchanged
    const newField =
      transformedSpec.components.schemas.TestSchema.properties.newField;
    expect(newField.deprecated).toBeUndefined();
    expect(newField['x-speakeasy-deprecation-message']).toBeUndefined();
  });

  test('transformGleanDeprecated handles property-only array deprecations', () => {
    const testSpec = {
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              oldField: {
                type: 'string',
                'x-glean-deprecated': [
                  {
                    id: 'property-only-uuid',
                    kind: 'property',
                    message: 'Field is deprecated',
                    introduced: '2026-02-05',
                    removal: '2026-10-15',
                  },
                ],
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);
    const oldField = transformedSpec.components.schemas.TestSchema.properties.oldField;

    expect(oldField.deprecated).toBe(true);
    expect(oldField['x-speakeasy-deprecation-message']).toBe(
      'Deprecated on 2026-02-05, removal scheduled for 2026-10-15: Field is deprecated',
    );
    expect(oldField['x-speakeasy-deprecation-message']).not.toContain('undefined');
    expect(Array.isArray(oldField['x-glean-deprecated'])).toBe(true);
  });

  test('transformGleanDeprecated handles enum-value-only array deprecations', () => {
    const testSpec = {
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['LEGACY', 'STANDARD'],
                'x-glean-deprecated': [
                  {
                    id: 'enum-uuid-1',
                    kind: 'enum-value',
                    'enum-value': 'LEGACY',
                    message: 'Use STANDARD instead',
                    introduced: '2025-12-01',
                    removal: '2026-07-15',
                  },
                  {
                    id: 'enum-uuid-2',
                    kind: 'enum-value',
                    'enum-value': 'OLD',
                    message: 'Use STANDARD instead',
                    introduced: '2025-12-02',
                    removal: '2026-07-16',
                  },
                ],
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);
    const statusField = transformedSpec.components.schemas.TestSchema.properties.status;

    expect(statusField.deprecated).toBe(true);
    expect(statusField['x-speakeasy-deprecation-message']).toBe(
      'Deprecated on 2025-12-01, removal scheduled for 2026-07-15: Use STANDARD instead',
    );
    expect(statusField['x-speakeasy-deprecation-message']).not.toContain('undefined');
  });

  test('transformGleanDeprecated prefers property entry for mixed array deprecations', () => {
    const testSpec = {
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              clusterType: {
                type: 'string',
                enum: ['NONE', 'DOMAIN', 'DATASOURCE'],
                'x-glean-deprecated': [
                  {
                    id: 'enum-uuid',
                    kind: 'enum-value',
                    'enum-value': 'NONE',
                    message: 'The NONE cluster type is deprecated',
                    introduced: '2025-02-01',
                    removal: '2026-10-15',
                  },
                  {
                    id: 'property-uuid',
                    kind: 'property',
                    message: 'The clusterType field is deprecated',
                    introduced: '2025-02-01',
                    removal: '2026-10-15',
                  },
                ],
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);
    const clusterType =
      transformedSpec.components.schemas.TestSchema.properties.clusterType;

    expect(clusterType.deprecated).toBe(true);
    expect(clusterType['x-speakeasy-deprecation-message']).toBe(
      'Deprecated on 2025-02-01, removal scheduled for 2026-10-15: The clusterType field is deprecated',
    );
    expect(clusterType['x-speakeasy-deprecation-message']).not.toContain('undefined');
  });

  test('transformGleanDeprecated handles missing deprecation fields without undefined', () => {
    const testSpec = {
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              messageOnly: {
                type: 'string',
                'x-glean-deprecated': {
                  id: 'message-only',
                  message: 'Some message',
                },
              },
              introducedOnly: {
                type: 'string',
                'x-glean-deprecated': {
                  id: 'introduced-only',
                  introduced: '2025-04-01',
                },
              },
              removalOnly: {
                type: 'string',
                'x-glean-deprecated': {
                  id: 'removal-only',
                  removal: '2025-10-15',
                },
              },
              emptyDeprecation: {
                type: 'string',
                'x-glean-deprecated': {
                  id: 'empty',
                },
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);
    const props = transformedSpec.components.schemas.TestSchema.properties;

    expect(props.messageOnly['x-speakeasy-deprecation-message']).toBe('Some message');
    expect(props.messageOnly['x-speakeasy-deprecation-message']).not.toContain(
      'undefined',
    );
    expect(props.messageOnly.deprecated).toBe(true);

    expect(props.introducedOnly['x-speakeasy-deprecation-message']).toBe(
      'Deprecated on 2025-04-01',
    );
    expect(props.introducedOnly['x-speakeasy-deprecation-message']).not.toContain(
      'undefined',
    );
    expect(props.introducedOnly.deprecated).toBe(true);

    expect(props.removalOnly['x-speakeasy-deprecation-message']).toBe(
      'Removal scheduled for 2025-10-15',
    );
    expect(props.removalOnly['x-speakeasy-deprecation-message']).not.toContain(
      'undefined',
    );
    expect(props.removalOnly.deprecated).toBe(true);

    expect(props.emptyDeprecation['x-speakeasy-deprecation-message']).toBeUndefined();
    expect(props.emptyDeprecation.deprecated).toBeUndefined();
  });

  test('transformGleanDeprecated clears stale Speakeasy message but preserves deprecated when message is empty', () => {
    const testSpec = {
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              staleField: {
                type: 'string',
                deprecated: true,
                'x-speakeasy-deprecation-message': 'old message',
                'x-glean-deprecated': {
                  id: 'empty',
                },
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);
    const staleField = transformedSpec.components.schemas.TestSchema.properties.staleField;

    expect(staleField.deprecated).toBe(true);
    expect(staleField['x-speakeasy-deprecation-message']).toBeUndefined();
  });

  test('transformGleanDeprecated ignores empty deprecation arrays', () => {
    const testSpec = {
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              emptyArrayField: {
                type: 'string',
                'x-glean-deprecated': [],
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);
    const emptyArrayField =
      transformedSpec.components.schemas.TestSchema.properties.emptyArrayField;

    expect(emptyArrayField.deprecated).toBeUndefined();
    expect(emptyArrayField['x-speakeasy-deprecation-message']).toBeUndefined();
  });

  test('transformGleanDeprecated handles malformed array entries safely', () => {
    const testSpec = {
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              malformedOnly: {
                type: 'string',
                'x-glean-deprecated': ['bad', null, 123, []],
              },
              mixedArray: {
                type: 'string',
                'x-glean-deprecated': [
                  'bad',
                  null,
                  {
                    id: 'valid',
                    kind: 'property',
                    message: 'Use newerField instead',
                    introduced: '2026-01-01',
                    removal: '2026-10-15',
                  },
                ],
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);
    const props = transformedSpec.components.schemas.TestSchema.properties;

    expect(props.malformedOnly.deprecated).toBeUndefined();
    expect(props.malformedOnly['x-speakeasy-deprecation-message']).toBeUndefined();

    expect(props.mixedArray.deprecated).toBe(true);
    expect(props.mixedArray['x-speakeasy-deprecation-message']).toBe(
      'Deprecated on 2026-01-01, removal scheduled for 2026-10-15: Use newerField instead',
    );
    expect(props.mixedArray['x-speakeasy-deprecation-message']).not.toContain(
      'undefined',
    );
  });

  test('transformGleanDeprecated handles specs without x-glean-deprecated', () => {
    const testSpec = {
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            summary: 'Test endpoint',
          },
        },
      },
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);

    // Verify no deprecated fields were added
    expect(transformedSpec.paths['/test'].get.deprecated).toBeUndefined();
    expect(
      transformedSpec.paths['/test'].get['x-speakeasy-deprecation-message'],
    ).toBeUndefined();
    expect(
      transformedSpec.components.schemas.TestSchema.properties.field.deprecated,
    ).toBeUndefined();
  });

  test('transformGleanDeprecated handles nested deprecations', () => {
    const testSpec = {
      paths: {
        '/test': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    properties: {
                      deprecatedField: {
                        type: 'string',
                        'x-glean-deprecated': {
                          id: 'nested-uuid',
                          message: 'This field is deprecated',
                          introduced: '2024-04-01',
                          removal: '2024-10-01',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);

    const deprecatedField =
      transformedSpec.paths['/test'].post.requestBody.content[
        'application/json'
      ].schema.properties.deprecatedField;
    expect(deprecatedField.deprecated).toBe(true);
    expect(deprecatedField['x-speakeasy-deprecation-message']).toBe(
      'Deprecated on 2024-04-01, removal scheduled for 2024-10-01: This field is deprecated',
    );
  });
});
