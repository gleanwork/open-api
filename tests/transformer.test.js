const yaml = require('js-yaml');
const { transformYaml, extractBasePath } = require('../src/transformer');

describe('OpenAPI YAML Transformer', () => {
  test('extractBasePath extracts path correctly', () => {
    expect(extractBasePath('https://{domain}-be.glean.com/rest/api/v1')).toBe('/rest/api/v1');
    expect(extractBasePath('https://example.com/api/')).toBe('/api');
    expect(extractBasePath('https://example.com')).toBe('');
  });
  
  test('transforms servers URL and updates paths correctly', () => {
    const sampleYaml = `
openapi: 3.0.0
info:
  version: 0.9.0
  title: Glean Client API
servers:
  - url: https://{domain}-be.glean.com/rest/api/v1
    variables:
      domain:
        default: domain
paths:
  /activity:
    post:
      summary: Report document activity
  /search:
    get:
      summary: Search for content
`;
    
    const transformedContent = transformYaml(sampleYaml);
    const transformedYaml = yaml.load(transformedContent);
    
    // Server URL should be updated to remove the subpath
    expect(transformedYaml.servers[0].url).toBe('https://{domain}-be.glean.com/');
    
    // Paths should be updated to include the subpath
    expect(transformedYaml.paths).toHaveProperty('/rest/api/v1/activity');
    expect(transformedYaml.paths).toHaveProperty('/rest/api/v1/search');
    expect(transformedYaml.paths).not.toHaveProperty('/activity');
    expect(transformedYaml.paths).not.toHaveProperty('/search');
  });
  
  test('preserves path operation properties', () => {
    const sampleYaml = `
openapi: 3.0.0
servers:
  - url: https://api.example.com/v1
paths:
  /users:
    get:
      operationId: getUsers
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        '200':
          description: OK
`;
    
    const transformedContent = transformYaml(sampleYaml);
    const transformedYaml = yaml.load(transformedContent);
    
    // Path operation properties should be preserved
    expect(transformedYaml.paths['/v1/users'].get.operationId).toBe('getUsers');
    expect(transformedYaml.paths['/v1/users'].get.parameters[0].name).toBe('limit');
    expect(transformedYaml.paths['/v1/users'].get.responses['200'].description).toBe('OK');
  });
  
  test('handles paths that already have a leading slash', () => {
    const sampleYaml = `
openapi: 3.0.0
servers:
  - url: https://api.example.com/v1
paths:
  "/users":
    get:
      summary: Get users
  users/profile:
    get:
      summary: Get profile
`;
    
    const transformedContent = transformYaml(sampleYaml);
    const transformedYaml = yaml.load(transformedContent);
    
    // Both paths should be properly transformed
    expect(transformedYaml.paths).toHaveProperty('/v1/users');
    expect(transformedYaml.paths).toHaveProperty('/v1/users/profile');
  });
  
  test('handles empty or missing paths', () => {
    const sampleYaml = `
openapi: 3.0.0
servers:
  - url: https://api.example.com/v1
paths: {}
`;
    
    const transformedContent = transformYaml(sampleYaml);
    const transformedYaml = yaml.load(transformedContent);
    
    // Server URL should be updated
    expect(transformedYaml.servers[0].url).toBe('https://api.example.com/');
    
    // Paths should remain empty
    expect(transformedYaml.paths).toEqual({});
  });
  
  test('matches the provided example transformation', () => {
    const exampleYaml = `
openapi: 3.0.0
info:
  version: 0.9.0
  title: Glean Client API
  contact:
    email: support@glean.com
  description: |
    # Introduction
    These are the public APIs to enable implementing a custom client interface to the Glean system.
  x-logo:
    url: https://app.glean.com/images/glean-text2.svg
servers:
  - url: https://{domain}-be.glean.com/rest/api/v1
    variables:
      domain:
        default: domain
        description: Email domain (without extension) that determines the deployment backend.
security:
  - BearerAuth: []
paths:
  /activity:
    post:
      tags:
        - Activity
      summary: Report document activity
      description: Report user activity that occurs on indexed documents such as viewing or editing. This signal improves search quality.
      operationId: activity
      x-visibility: Public
      x-codegen-request-body-name: payload
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Activity'
        required: true
        x-exportParamName: Activity
      responses:
        '200':
          description: OK
`;

    const transformedContent = transformYaml(exampleYaml);
    const transformedYaml = yaml.load(transformedContent);
    
    // Check server URL
    expect(transformedYaml.servers[0].url).toBe('https://{domain}-be.glean.com/');
    
    // Check paths
    expect(transformedYaml.paths).toHaveProperty('/rest/api/v1/activity');
    
    // Check that server variables are preserved
    expect(transformedYaml.servers[0].variables.domain.default).toBe('domain');
    expect(transformedYaml.servers[0].variables.domain.description).toBe('Email domain (without extension) that determines the deployment backend.');
    
    // Check that operation details are preserved
    const activityPath = transformedYaml.paths['/rest/api/v1/activity'];
    expect(activityPath.post.operationId).toBe('activity');
    expect(activityPath.post.responses['200'].description).toBe('OK');
  });
}); 