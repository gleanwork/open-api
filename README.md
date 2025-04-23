# OpenAPI YAML Transformer

A GitHub Action that transforms OpenAPI YAML specification files by:

1. Downloading files from specified URLs
2. Moving the server URL subpath to each individual API path
3. Writing the transformed files to the `generated/` directory

## Transformation Process

This action performs the following transformations:

- **Before**: `servers.url = "https://{domain}-be.glean.com/rest/api/v1"`, `path = "/activity"`
- **After**: `servers.url = "https://{domain}-be.glean.com/"`, `path = "/rest/api/v1/activity"`

## Output

Transformed files are saved to the `generated/` directory:
- `generated/client_rest.yaml`
- `generated/indexing.yaml`

## Usage

Add the following to your workflow file:

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0  # Important for commits to work
      
  - name: Transform OpenAPI specs
    uses: glean/openapi-yaml-transformer@v1
```

## Development

To set up the development environment:

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run tests:
   ```bash
   npm test
   ```
4. Build the action:
   ```bash
   npm run build
   ```

## Files

- `action.yml` - Action metadata
- `src/index.js` - Main action code
- `src/transformer.js` - OpenAPI transformation logic
- `tests/transformer.test.js` - Unit tests
- `.github/workflows/test.yml` - CI workflow
- `.github/workflows/transform.yml` - Action execution workflow 