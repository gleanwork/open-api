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
  transformPlatformSpec,
  injectOpenApiCommitSha,
} from '../src/source-spec-transformer.js';

function readFixture(filename) {
  const sourceFile = path.join(process.cwd(), 'source_specs', filename);
  return fs.readFileSync(sourceFile, 'utf8');
}

function readTestFixture(filename) {
  const sourceFile = path.join(process.cwd(), 'tests', 'fixtures', filename);
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

    // A path may declare its own `servers:` block; in that case the transformer
    // prefixes the path with that path-level basePath rather than the global one.
    const expectedBasePathFor = (pathValue) => {
      const pathServers = pathValue?.servers;
      if (Array.isArray(pathServers) && pathServers.length > 0) {
        const candidate = extractBasePath(pathServers[0].url ?? '');
        if (candidate) return candidate;
      }
      return originalBasePath;
    };

    const allExpectedBasePaths = new Set();

    for (const originalPath of originalPaths) {
      const expectedBasePath = expectedBasePathFor(
        originalSpec.paths[originalPath],
      );
      allExpectedBasePaths.add(expectedBasePath);

      const expectedTransformedPath = `${expectedBasePath}${originalPath}`;
      expect(transformedSpec.paths).toHaveProperty(expectedTransformedPath);

      const originalOperations = originalSpec.paths[originalPath];
      const transformedOperations =
        transformedSpec.paths[expectedTransformedPath];

      expect(Object.keys(transformedOperations)).toEqual(
        Object.keys(originalOperations),
      );
    }

    for (const path of transformedPaths) {
      const matchesSomeBasePath = [...allExpectedBasePaths].some((prefix) =>
        path.startsWith(prefix),
      );
      expect(matchesSomeBasePath).toBe(true);
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

  test('honors path-level servers when prefixing path keys', () => {
    const sourceYaml = readTestFixture('path-level-servers.yaml');
    const transformedSpec = yaml.load(transform(sourceYaml, 'indexing.yaml'));

    // Global-server path keeps the global basePath prefix.
    expect(transformedSpec.paths).toHaveProperty('/api/index/v1/indexdocument');

    // Path-level-server path is prefixed with its OWN basePath, not the global one.
    const customMetadataKey =
      '/rest/api/index/document/{docId}/custom-metadata/{groupName}';
    expect(transformedSpec.paths).toHaveProperty(customMetadataKey);
    expect(transformedSpec.paths).not.toHaveProperty(
      '/api/index/v1/document/{docId}/custom-metadata/{groupName}',
    );

    // The path-level server URL has its basePath stripped, so server.url + pathKey
    // composes the correct full URL (no doubled prefix).
    const pathLevelServers = transformedSpec.paths[customMetadataKey].servers;
    expect(pathLevelServers[0].url).toBe('https://{instance}-be.glean.com');

    // Top-level server URL is also stripped of its global basePath.
    expect(transformedSpec.servers[0].url).toBe(
      'https://{instance}-be.glean.com',
    );

    // {domain} → {instance} variable rename applies to path-level servers too.
    expect(pathLevelServers[0].variables).toHaveProperty('instance');
    expect(pathLevelServers[0].variables).not.toHaveProperty('domain');
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

  test('transforms platform components, paths, and SDK names from x-glean-sdk metadata', () => {
    const platformSpec = {
      openapi: '3.0.0',
      info: { title: 'Glean Platform API', version: '2026-04-01' },
      'x-tagGroups': [{ name: 'Platform', tags: ['Search'] }],
      servers: [{ url: 'https://{domain}-be.glean.com/api' }],
      components: {
        securitySchemes: {
          ApiToken: { type: 'http', scheme: 'bearer' },
        },
        responses: {
          BadRequest: {
            description: 'bad request',
            content: {
              'application/problem+json': {
                schema: { $ref: '#/components/schemas/Result' },
              },
            },
          },
        },
        schemas: {
          SearchRequest: { type: 'object' },
          ToolsListResponse: {
            type: 'object',
            properties: {
              tools: {
                type: 'array',
                items: { $ref: '#/components/schemas/Tool' },
              },
            },
          },
          Tool: { type: 'object' },
          ToolCallRequest: { type: 'object' },
          ToolCallResponse: {
            type: 'object',
            properties: {
              result: { $ref: '#/components/schemas/Result' },
            },
          },
          PersonReference: { type: 'object' },
          Person: { type: 'object' },
          DocumentSpec: { type: 'object' },
          PeopleSearchResponse: {
            type: 'object',
            properties: {
              people: {
                type: 'array',
                items: { $ref: '#/components/schemas/Person' },
              },
            },
          },
          RunRequest: { type: 'object' },
          RunEvent: { type: 'object' },
          Result: {
            type: 'object',
            properties: {
              related: { $ref: '#/components/schemas/SearchRequest' },
              creator: { $ref: '#/components/schemas/PersonReference' },
            },
          },
          SummarizeRequest: {
            type: 'object',
            properties: {
              document_specs: {
                type: 'array',
                items: { $ref: '#/components/schemas/DocumentSpec' },
              },
            },
          },
          PlatformExisting: { type: 'object' },
        },
      },
      security: [{ ApiToken: [] }],
      paths: {
        '/search': {
          post: {
            tags: ['Search'],
            operationId: 'platform-search',
            'x-glean-sdk': {
              group: 'search',
              method: 'query',
            },
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SearchRequest' },
                },
              },
            },
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Result' },
                  },
                },
              },
              400: {
                $ref: '#/components/responses/BadRequest',
              },
            },
          },
        },
        '/tools': {
          get: {
            tags: ['Tools'],
            operationId: 'platform-tools-list',
            'x-glean-sdk': {
              group: 'tools',
              method: 'list',
            },
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/ToolsListResponse',
                    },
                  },
                },
              },
            },
          },
        },
        '/tools/call': {
          post: {
            tags: ['Tools'],
            operationId: 'platform-tools-call',
            'x-glean-sdk': {
              group: 'tools',
              method: 'call',
            },
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ToolCallRequest' },
                },
              },
            },
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/ToolCallResponse',
                    },
                  },
                },
              },
            },
          },
        },
        '/agents/{agent_id}/runs': {
          post: {
            tags: ['Agents'],
            operationId: 'platform-agents-create-run',
            'x-glean-sdk': {
              group: 'agents',
              method: 'createRun',
            },
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/RunRequest' },
                },
              },
            },
            responses: {
              200: {
                description: 'ok',
                content: {
                  'text/event-stream': {
                    schema: {
                      $ref: '#/components/schemas/RunEvent',
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const transformedSpec = yaml.load(
      transform(yaml.dump(platformSpec), 'platform.yaml'),
    );

    expect(transformedSpec.servers[0].url).toBe(
      'https://{instance}-be.glean.com',
    );
    expect(transformedSpec.paths).toHaveProperty('/api/search');
    expect(transformedSpec.paths).toHaveProperty('/api/tools');
    expect(transformedSpec.paths).toHaveProperty('/api/tools/call');
    expect(transformedSpec.paths).toHaveProperty('/api/agents/{agent_id}/runs');
    expect(transformedSpec['x-tagGroups']).toBeUndefined();

    expect(Object.keys(transformedSpec.components.schemas).sort()).toEqual([
      'PlatformDocumentSpec',
      'PlatformExisting',
      'PlatformPeopleSearchResponse',
      'PlatformPerson',
      'PlatformPersonReference',
      'PlatformResult',
      'PlatformRunEvent',
      'PlatformRunRequest',
      'PlatformSearchRequest',
      'PlatformSummarizeRequest',
      'PlatformTool',
      'PlatformToolCallRequest',
      'PlatformToolCallResponse',
      'PlatformToolsListResponse',
    ]);
    expect(
      transformedSpec.paths['/api/search'].post.requestBody.content[
        'application/json'
      ].schema.$ref,
    ).toBe('#/components/schemas/PlatformSearchRequest');
    expect(
      transformedSpec.components.schemas.PlatformResult.properties.related.$ref,
    ).toBe('#/components/schemas/PlatformSearchRequest');
    expect(
      transformedSpec.components.schemas.PlatformResult.properties.creator.$ref,
    ).toBe('#/components/schemas/PlatformPersonReference');
    expect(
      transformedSpec.components.schemas.PlatformPeopleSearchResponse.properties
        .people.items.$ref,
    ).toBe('#/components/schemas/PlatformPerson');
    expect(
      transformedSpec.components.schemas.PlatformSummarizeRequest.properties
        .document_specs.items.$ref,
    ).toBe('#/components/schemas/PlatformDocumentSpec');
    expect(transformedSpec.components.responses).toHaveProperty(
      'PlatformBadRequest',
    );
    expect(transformedSpec.paths['/api/search'].post.responses[400].$ref).toBe(
      '#/components/responses/PlatformBadRequest',
    );

    expect(transformedSpec.paths['/api/search'].post).toMatchObject({
      'x-speakeasy-group': 'search',
      'x-speakeasy-name-override': 'query',
    });
    expect(transformedSpec.paths['/api/search'].post).not.toHaveProperty(
      'x-glean-sdk',
    );
    expect(
      transformedSpec.paths['/api/tools'].get.responses[200].content[
        'application/json'
      ].schema.$ref,
    ).toBe('#/components/schemas/PlatformToolsListResponse');
    expect(
      transformedSpec.components.schemas.PlatformToolsListResponse.properties
        .tools.items.$ref,
    ).toBe('#/components/schemas/PlatformTool');
    expect(transformedSpec.paths['/api/tools'].get).toMatchObject({
      'x-speakeasy-group': 'tools',
      'x-speakeasy-name-override': 'list',
    });
    expect(transformedSpec.paths['/api/tools'].get).not.toHaveProperty(
      'x-glean-sdk',
    );
    expect(transformedSpec.paths['/api/tools/call'].post).toMatchObject({
      'x-speakeasy-group': 'tools',
      'x-speakeasy-name-override': 'call',
    });
    expect(
      transformedSpec.paths['/api/tools/call'].post.responses[200].content[
        'application/json'
      ].schema.$ref,
    ).toBe('#/components/schemas/PlatformToolCallResponse');
    expect(
      transformedSpec.components.schemas.PlatformToolCallResponse.properties
        .result.$ref,
    ).toBe('#/components/schemas/PlatformResult');
    expect(transformedSpec.paths['/api/tools/call'].post).not.toHaveProperty(
      'x-glean-sdk',
    );
    expect(
      transformedSpec.paths['/api/agents/{agent_id}/runs'].post,
    ).toMatchObject({
      'x-speakeasy-group': 'agents',
      'x-speakeasy-name-override': 'createRun',
    });
    expect(
      transformedSpec.paths['/api/agents/{agent_id}/runs'].post.responses[200]
        .content['text/event-stream'].schema.$ref,
    ).toBe('#/components/schemas/PlatformRunEvent');
    expect(
      transformedSpec.paths['/api/agents/{agent_id}/runs'].post,
    ).not.toHaveProperty('x-glean-sdk');
    expect(transformedSpec.security).toEqual([{ APIToken: [] }]);
    expect(transformedSpec.components.securitySchemes).toHaveProperty(
      'APIToken',
    );
    expect(transformedSpec.components.securitySchemes).not.toHaveProperty(
      'ApiToken',
    );
  });

  test('transformPlatformSpec rejects operations without x-glean-sdk metadata', () => {
    expect(() =>
      transformPlatformSpec({
        paths: {
          '/tools': {
            post: {
              operationId: 'platform-tools',
            },
          },
        },
      }),
    ).toThrow(
      'Platform operation POST /tools with operationId platform-tools must declare x-glean-sdk.group and x-glean-sdk.method',
    );
  });

  test('transformPlatformSpec preserves other security schemes when normalizing ApiToken', () => {
    const spec = {
      components: {
        securitySchemes: {
          ApiToken: { type: 'http', scheme: 'bearer' },
          ExtraAuth: { type: 'apiKey', in: 'header', name: 'X-Extra-Auth' },
        },
      },
      security: [{ ApiToken: [], ExtraAuth: ['admin'] }],
      paths: {
        '/search': {
          post: {
            operationId: 'platform-search',
            'x-glean-sdk': {
              group: 'search',
              method: 'query',
            },
            security: [{ ApiToken: [], ExtraAuth: ['search'] }],
          },
        },
      },
    };

    transformPlatformSpec(spec);

    expect(spec.security).toEqual([{ APIToken: [], ExtraAuth: ['admin'] }]);
    expect(spec.paths['/search'].post.security).toEqual([
      { APIToken: [], ExtraAuth: ['search'] },
    ]);
  });

  test('transformPlatformSpec rejects schema names that collide after prefixing', () => {
    expect(() =>
      transformPlatformSpec({
        components: {
          schemas: {
            SearchRequest: { type: 'object' },
            PlatformSearchRequest: { type: 'object' },
          },
        },
        paths: {},
      }),
    ).toThrow(
      'Platform schema SearchRequest cannot be renamed to PlatformSearchRequest because PlatformSearchRequest already exists',
    );
  });

  test('transformPlatformSpec rejects response names that collide after prefixing', () => {
    expect(() =>
      transformPlatformSpec({
        components: {
          responses: {
            BadRequest: { description: 'bad request' },
            PlatformBadRequest: { description: 'platform bad request' },
          },
        },
        paths: {},
      }),
    ).toThrow(
      'Platform response BadRequest cannot be renamed to PlatformBadRequest because PlatformBadRequest already exists',
    );
  });

  test('transformPlatformSpec rejects invalid SDK metadata', () => {
    expect(() =>
      transformPlatformSpec({
        paths: {
          '/search': {
            post: {
              operationId: 'platform-search',
              'x-glean-sdk': {
                group: 'Search',
                method: 'Query',
              },
            },
          },
        },
      }),
    ).toThrow(
      'Platform operation POST /search with operationId platform-search has invalid x-glean-sdk.group "Search"; expected lowercase dot-separated identifiers',
    );
  });

  test('transformPlatformSpec rejects duplicate SDK methods', () => {
    expect(() =>
      transformPlatformSpec({
        paths: {
          '/search': {
            post: {
              operationId: 'platform-search',
              'x-glean-sdk': {
                group: 'search',
                method: 'query',
              },
            },
          },
          '/query': {
            post: {
              operationId: 'platform-query',
              'x-glean-sdk': {
                group: 'search',
                method: 'query',
              },
            },
          },
        },
      }),
    ).toThrow(
      'Platform operation POST /query with operationId platform-query declares duplicate SDK method search.query; already used by POST /search with operationId platform-search',
    );
  });

  test('transformPlatformSpec allows multiple operations in the same SDK group with different methods', () => {
    const spec = {
      paths: {
        '/tools': {
          get: {
            operationId: 'platform-tools-list',
            'x-glean-sdk': {
              group: 'tools',
              method: 'list',
            },
          },
        },
        '/tools/call': {
          post: {
            operationId: 'platform-tools-call',
            'x-glean-sdk': {
              group: 'tools',
              method: 'call',
            },
          },
        },
      },
    };

    transformPlatformSpec(spec);

    expect(spec.paths['/tools'].get).toMatchObject({
      'x-speakeasy-group': 'tools',
      'x-speakeasy-name-override': 'list',
    });
    expect(spec.paths['/tools/call'].post).toMatchObject({
      'x-speakeasy-group': 'tools',
      'x-speakeasy-name-override': 'call',
    });
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
                enum: ['LEGACY', 'STANDARD'],
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
    const oldField =
      transformedSpec.components.schemas.TestSchema.properties.oldField;

    expect(oldField.deprecated).toBe(true);
    expect(oldField['x-speakeasy-deprecation-message']).toBe(
      'Deprecated on 2026-02-05, removal scheduled for 2026-10-15: Field is deprecated',
    );
    expect(oldField['x-speakeasy-deprecation-message']).not.toContain(
      'undefined',
    );
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
    const statusField =
      transformedSpec.components.schemas.TestSchema.properties.status;

    expect({
      deprecated: statusField.deprecated,
      'x-speakeasy-deprecation-message':
        statusField['x-speakeasy-deprecation-message'],
      'x-speakeasy-enum-descriptions':
        statusField['x-speakeasy-enum-descriptions'],
    }).toMatchInlineSnapshot(`
      {
        "deprecated": undefined,
        "x-speakeasy-deprecation-message": undefined,
        "x-speakeasy-enum-descriptions": {
          "LEGACY": "@deprecated Deprecated on 2025-12-01, removal scheduled for 2026-07-15: Use STANDARD instead",
        },
      }
    `);
    expect(Array.isArray(statusField['x-glean-deprecated'])).toBe(true);
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

    expect({
      deprecated: clusterType.deprecated,
      'x-speakeasy-deprecation-message':
        clusterType['x-speakeasy-deprecation-message'],
      'x-speakeasy-enum-descriptions':
        clusterType['x-speakeasy-enum-descriptions'],
    }).toMatchInlineSnapshot(`
      {
        "deprecated": true,
        "x-speakeasy-deprecation-message": "Deprecated on 2025-02-01, removal scheduled for 2026-10-15: The clusterType field is deprecated",
        "x-speakeasy-enum-descriptions": {
          "NONE": "@deprecated Deprecated on 2025-02-01, removal scheduled for 2026-10-15: The NONE cluster type is deprecated",
        },
      }
    `);
  });

  test('transformGleanDeprecated merges enum value deprecations with existing enum descriptions', () => {
    const testSpec = {
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['LEGACY', 'STANDARD'],
                'x-speakeasy-enum-descriptions': {
                  LEGACY: 'Legacy status (kept for backwards compatibility)',
                  STANDARD: 'Standard status',
                },
                'x-glean-deprecated': [
                  {
                    id: 'enum-uuid-1',
                    kind: 'enum-value',
                    'enum-value': 'LEGACY',
                    message: 'Use STANDARD instead',
                    introduced: '2025-12-01',
                    removal: '2026-07-15',
                  },
                ],
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);
    const statusField =
      transformedSpec.components.schemas.TestSchema.properties.status;

    expect({
      deprecated: statusField.deprecated,
      'x-speakeasy-deprecation-message':
        statusField['x-speakeasy-deprecation-message'],
      'x-speakeasy-enum-descriptions':
        statusField['x-speakeasy-enum-descriptions'],
    }).toMatchInlineSnapshot(`
      {
        "deprecated": undefined,
        "x-speakeasy-deprecation-message": undefined,
        "x-speakeasy-enum-descriptions": {
          "LEGACY": "Legacy status (kept for backwards compatibility)

      @deprecated Deprecated on 2025-12-01, removal scheduled for 2026-07-15: Use STANDARD instead",
          "STANDARD": "Standard status",
        },
      }
    `);
  });

  test('transformGleanDeprecated ignores enum-value arrays when field is not an enum', () => {
    const testSpec = {
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              notAnEnum: {
                type: 'string',
                'x-glean-deprecated': [
                  {
                    id: 'enum-uuid-1',
                    kind: 'enum-value',
                    'enum-value': 'LEGACY',
                    message: 'Some enum-only deprecation',
                    introduced: '2025-12-01',
                    removal: '2026-07-15',
                  },
                ],
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);
    const field =
      transformedSpec.components.schemas.TestSchema.properties.notAnEnum;

    expect(field.deprecated).toBeUndefined();
    expect(field['x-speakeasy-deprecation-message']).toBeUndefined();
    expect(field['x-speakeasy-enum-descriptions']).toBeUndefined();
    expect(Array.isArray(field['x-glean-deprecated'])).toBe(true);
  });

  test('transformGleanDeprecated ignores object-form enum-value deprecations', () => {
    const testSpec = {
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['LEGACY', 'STANDARD'],
                'x-glean-deprecated': {
                  id: 'enum-uuid-1',
                  kind: 'enum-value',
                  'enum-value': 'LEGACY',
                  message: 'Use STANDARD instead',
                  introduced: '2025-12-01',
                  removal: '2026-07-15',
                },
              },
            },
          },
        },
      },
    };

    const transformedSpec = transformGleanDeprecated(testSpec);
    const statusField =
      transformedSpec.components.schemas.TestSchema.properties.status;

    expect(statusField.deprecated).toBeUndefined();
    expect(statusField['x-speakeasy-deprecation-message']).toBeUndefined();
    expect(statusField['x-speakeasy-enum-descriptions']).toBeUndefined();
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

    const speakeasyFields = (field) => ({
      deprecated: field.deprecated,
      'x-speakeasy-deprecation-message':
        field['x-speakeasy-deprecation-message'],
    });

    expect({
      messageOnly: speakeasyFields(props.messageOnly),
      introducedOnly: speakeasyFields(props.introducedOnly),
      removalOnly: speakeasyFields(props.removalOnly),
      emptyDeprecation: speakeasyFields(props.emptyDeprecation),
    }).toMatchInlineSnapshot(`
      {
        "emptyDeprecation": {
          "deprecated": undefined,
          "x-speakeasy-deprecation-message": undefined,
        },
        "introducedOnly": {
          "deprecated": true,
          "x-speakeasy-deprecation-message": "Deprecated on 2025-04-01",
        },
        "messageOnly": {
          "deprecated": true,
          "x-speakeasy-deprecation-message": "Some message",
        },
        "removalOnly": {
          "deprecated": true,
          "x-speakeasy-deprecation-message": "Removal scheduled for 2025-10-15",
        },
      }
    `);
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
    const staleField =
      transformedSpec.components.schemas.TestSchema.properties.staleField;

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
                enum: ['LEGACY', 'STANDARD'],
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

    const speakeasyFields = (field) => ({
      deprecated: field.deprecated,
      'x-speakeasy-deprecation-message':
        field['x-speakeasy-deprecation-message'],
    });

    expect({
      malformedOnly: speakeasyFields(props.malformedOnly),
      mixedArray: speakeasyFields(props.mixedArray),
    }).toMatchInlineSnapshot(`
      {
        "malformedOnly": {
          "deprecated": undefined,
          "x-speakeasy-deprecation-message": undefined,
        },
        "mixedArray": {
          "deprecated": true,
          "x-speakeasy-deprecation-message": "Deprecated on 2026-01-01, removal scheduled for 2026-10-15: Use newerField instead",
        },
      }
    `);
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
