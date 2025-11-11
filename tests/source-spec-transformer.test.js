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
});
