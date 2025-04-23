import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { transformYaml, extractBasePath } from '../src/transformer';

// Helper function to read fixture files
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
    const clientYaml = readFixture('client-api.yaml');
    const transformedContent = transformYaml(clientYaml);
    
    // Parse before and after for verification
    const originalSpec = yaml.load(clientYaml);
    const transformedSpec = yaml.load(transformedContent);
    
    // Server URL should be updated to remove the subpath
    expect(transformedSpec.servers[0].url).toBe('https://{domain}-be.glean.com/');
    
    // Paths should be updated to include the subpath
    expect(transformedSpec.paths).toHaveProperty('/rest/api/v1/activity');
    expect(transformedSpec.paths).toHaveProperty('/rest/api/v1/search');
    
    // Save the snapshot of the transformed YAML
    expect(transformedContent).toMatchSnapshot();
  });
  
  test('transforms indexing API YAML correctly', () => {
    const indexingYaml = readFixture('indexing-api.yaml');
    const transformedContent = transformYaml(indexingYaml);
    
    // Parse before and after for verification
    const originalSpec = yaml.load(indexingYaml);
    const transformedSpec = yaml.load(transformedContent);
    
    // Server URL should be updated to remove the subpath
    expect(transformedSpec.servers[0].url).toBe('https://api.glean.com/');
    
    // Paths should be updated to include the subpath
    expect(transformedSpec.paths).toHaveProperty('/indexing/v1/documents');
    expect(transformedSpec.paths).toHaveProperty('/indexing/v1/documents/{id}');
    
    // Save the snapshot of the transformed YAML
    expect(transformedContent).toMatchSnapshot();
  });
  
  test('preserves path operation properties', () => {
    const clientYaml = readFixture('client-api.yaml');
    const transformedContent = transformYaml(clientYaml);
    const transformedSpec = yaml.load(transformedContent);
    
    // Path operation properties should be preserved
    const activityPath = transformedSpec.paths['/rest/api/v1/activity'];
    expect(activityPath.post.operationId).toBe('activity');
    expect(activityPath.post.tags[0]).toBe('Activity');
    expect(activityPath.post.responses['200'].description).toBe('OK');
    
    // Complex schemas should be preserved
    const searchPath = transformedSpec.paths['/rest/api/v1/search'];
    expect(searchPath.get.parameters[0].name).toBe('q');
    expect(searchPath.get.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/SearchResults');
  });
  
  test('handles empty or missing paths', () => {
    const sampleYaml = `
openapi: 3.0.0
servers:
  - url: https://api.example.com/v1
paths: {}
`;
    
    const transformedContent = transformYaml(sampleYaml);
    const transformedSpec = yaml.load(transformedContent);
    
    // Server URL should be updated
    expect(transformedSpec.servers[0].url).toBe('https://api.example.com/');
    
    // Paths should remain empty
    expect(transformedSpec.paths).toEqual({});
  });
}); 