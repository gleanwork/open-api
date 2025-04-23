# OpenAPI Preprocessor

Preprocesses our OpenAPI specs to prepare them for geneation via Speakeasy (our API client library generator).

The GitHub Action that transforms OpenAPI YAML specification files by:

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

See usage in the `./github/workflows/transform.yml` workflow.

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
