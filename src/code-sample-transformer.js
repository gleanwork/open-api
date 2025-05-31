import yaml from 'js-yaml';

/**
 * Extracts code snippet for a specific language from pathSpec
 * @param {Object} pathSpec The OpenAPI spec object for the specific path being processed
 * @param {string} language The language to extract code snippets for
 * @returns {string} The source code snippet for the specified language
 */
export function extractCodeSnippet(pathSpec, language) {
  for (const [httpMethod, methodSpec] of Object.entries(pathSpec)) {
    if (methodSpec && methodSpec['x-codeSamples']) {
      const codeSamples = methodSpec['x-codeSamples'];

      const matchingSample = codeSamples.find(
        (sample) => sample.lang === language,
      );

      return matchingSample;
    }
  }

  return undefined;
}

/**
 * Generator that iterates over all paths in an OpenAPI specification
 * @param {Object} spec The OpenAPI specification object
 * @yields {[string, Object]} A tuple containing the path key and path specification
 */
export function* path(spec) {
  if (spec.paths) {
    for (const [pathKey, pathSpec] of Object.entries(spec.paths)) {
      yield [pathKey, pathSpec];
    }
  }
}

export function transformPythonCodeSamplesToPython(spec) {
  for (const [apiPath, pathSpec] of path(spec)) {
    let codeSample = extractCodeSnippet(pathSpec, 'python');
    if (!codeSample) {
      continue;
    }

    let codeSampleSource = codeSample.source;

    const transformations = [
      // from glean import X, Y, Z -> from glean.api_client import X, Y, Z
      [
        /from glean(?!\.api_client) import\s+/g,
        'from glean.api_client import ',
      ],
      // from glean.something import ... -> from glean.api_client.something import ...
      [/from glean\.(?!api_client)([^.\s]+)/g, 'from glean.api_client.$1'],
      // import glean.something -> import glean.api_client.something
      [/import glean\.(?!api_client)([^.\s]+)/g, 'import glean.api_client.$1'],
    ];

    for (const [pattern, replacement] of transformations) {
      codeSampleSource = codeSampleSource.replace(pattern, replacement);
    }

    codeSample.source = codeSampleSource;
  }

  return spec;
}

/**
 * Transforms OpenAPI YAML by adjusting server URLs and paths
 * @param {string} content The OpenAPI YAML content
 * @param {string} filename The name of the file being processed
 * @returns {string} Transformed YAML content
 */
export function transform(content, _filename) {
  const spec = yaml.load(content);

  transformPythonCodeSamplesToPython(spec);

  return yaml.dump(spec, {
    lineWidth: -1, // Preserve line breaks
    noRefs: true, // Don't use anchors and aliases
    quotingType: '"', // Use double quotes for strings
  });
}
