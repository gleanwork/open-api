import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { transform, extractBasePath, transformShortcutComponent } from '../src/transformer.js';

function readFixture(filename) {
  const fixtureFile = path.join(__dirname, 'fixtures', filename);
  return fs.readFileSync(fixtureFile, 'utf8');
}

describe('OpenAPI YAML Transformer', () => {
  test('extractBasePath extracts path correctly', () => {
    expect(extractBasePath('https://{domain}-be.glean.com/rest/api/v1')).toBe('/rest/api/v1');
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
    expect(transformedSpec.servers[0].url).toBe('https://{domain}-be.glean.com');
    
    const originalPaths = Object.keys(originalSpec.paths);
    const transformedPaths = Object.keys(transformedSpec.paths);
    
    expect(transformedPaths.length).toBe(originalPaths.length);
    
    for (const originalPath of originalPaths) {
      const expectedTransformedPath = `${originalBasePath}${originalPath}`;
      expect(transformedSpec.paths).toHaveProperty(expectedTransformedPath);
      
      const originalOperations = originalSpec.paths[originalPath];
      const transformedOperations = transformedSpec.paths[expectedTransformedPath];
      
      expect(Object.keys(transformedOperations)).toEqual(Object.keys(originalOperations));
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
    expect(transformedSpec.servers[0].url).toBe('https://{domain}-be.glean.com');
    
    const originalPaths = Object.keys(originalSpec.paths);
    const transformedPaths = Object.keys(transformedSpec.paths);
    
    expect(transformedPaths.length).toBe(originalPaths.length);
    
    for (const originalPath of originalPaths) {
      const expectedTransformedPath = `${originalBasePath}${originalPath}`;
      expect(transformedSpec.paths).toHaveProperty(expectedTransformedPath);
      
      const originalOperations = originalSpec.paths[originalPath];
      const transformedOperations = transformedSpec.paths[expectedTransformedPath];
      
      expect(Object.keys(transformedOperations)).toEqual(Object.keys(originalOperations));
    }
    
    for (const path of transformedPaths) {
      expect(path.startsWith(originalBasePath)).toBe(true);
    }
    
    // If there's a Shortcut component in the test fixture, it should be renamed to IndexingShortcut
    if (originalSpec.components && originalSpec.components.schemas && originalSpec.components.schemas.Shortcut) {
      expect(transformedSpec.components.schemas).not.toHaveProperty('Shortcut');
      expect(transformedSpec.components.schemas).toHaveProperty('IndexingShortcut');
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
      expect(transformedOperation.operationId).toBe(originalOperation.operationId);
    }
    
    if (originalOperation.summary) {
      expect(transformedOperation.summary).toBe(originalOperation.summary);
    }
    
    if (originalOperation.description) {
      expect(transformedOperation.description).toBe(originalOperation.description);
    }
    
    if (originalOperation.tags) {
      expect(transformedOperation.tags).toEqual(originalOperation.tags);
    }
    
    if (originalOperation.parameters) {
      expect(transformedOperation.parameters.length).toBe(originalOperation.parameters.length);
    }
    
    if (originalOperation.responses) {
      expect(Object.keys(transformedOperation.responses)).toEqual(
        Object.keys(originalOperation.responses)
      );
    }
  });
  
  test('handles empty or missing paths', () => {
    const sampleYaml = `
openapi: 3.0.0
servers:
  - url: https://api.example.com/v1
paths: {}
`;
    
    const transformedContent = transform(sampleYaml, 'sample.yaml');
    const transformedSpec = yaml.load(transformedContent);
    
    expect(transformedSpec.servers[0].url).toBe('https://api.example.com');
    
    expect(transformedSpec.paths).toEqual({});
  });
  
  test('transformShortcutComponent renames Shortcut to IndexingShortcut', () => {
    const testSpec = {
      components: {
        schemas: {
          Shortcut: {
            type: 'object',
            properties: {
              testProperty: { type: 'string' }
            }
          },
          OtherSchema: {
            type: 'object',
            properties: {
              shortcutRef: { $ref: '#/components/schemas/Shortcut' }
            }
          }
        }
      }
    };
    
    const transformedSpec = transformShortcutComponent(testSpec);
    
    expect(transformedSpec.components.schemas).not.toHaveProperty('Shortcut');
    expect(transformedSpec.components.schemas).toHaveProperty('IndexingShortcut');
    expect(transformedSpec.components.schemas.OtherSchema.properties.shortcutRef.$ref).toBe('#/components/schemas/IndexingShortcut');
  });
}); 