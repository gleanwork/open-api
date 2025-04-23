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
    const clientYaml = readFixture('client_rest.yaml');
    const transformedContent = transformYaml(clientYaml);
    
    expect(transformedContent).toMatchSnapshot();
  });
  
  test('transforms indexing API YAML correctly', () => {
    const indexingYaml = readFixture('indexing.yaml');
    const transformedContent = transformYaml(indexingYaml);
    
    expect(transformedContent).toMatchSnapshot();
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
    
    expect(transformedSpec.servers[0].url).toBe('https://api.example.com');
    
    expect(transformedSpec.paths).toEqual({});
  });
}); 