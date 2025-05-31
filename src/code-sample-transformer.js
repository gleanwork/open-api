import yaml from 'js-yaml';

/**
 * Generator that yields language and code sample pairs from pathSpec
 * @param {Object} pathSpec The OpenAPI spec object for the specific path being processed
 * @yields {[string, Object]} A tuple containing the language and code sample object
 */
export function* codeSnippets(pathSpec) {
  for (const [_, methodSpec] of Object.entries(pathSpec)) {
    if (methodSpec && methodSpec['x-codeSamples']) {
      const codeSamples = methodSpec['x-codeSamples'];
      for (const sample of codeSamples) {
        yield [sample.lang, sample];
      }
    }
  }
}

/**
 * Extracts code snippet for a specific language from pathSpec
 * @param {Object} pathSpec The OpenAPI spec object for the specific path being processed
 * @param {string} language The language to extract code snippets for
 * @returns {string} The source code snippet for the specified language
 */
export function extractCodeSnippet(pathSpec, language) {
  for (const [lang, sample] of codeSnippets(pathSpec)) {
    if (lang === language) {
      return sample;
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
 * Transforms code samples in an OpenAPI specification to add instance configuration
 * for various programming languages. This function adds the necessary instance/server
 * configuration to existing code samples that only contain API token configuration.
 *
 * Supported transformations:
 * - Python: Adds `instance=os.getenv("GLEAN_INSTANCE", "")` after `api_token`
 * - TypeScript: Adds `instance: process.env["GLEAN_INSTANCE"] ?? ""` after `apiToken`
 * - Go: Adds `apiclientgo.WithInstance("<value>")` before `WithSecurity`
 * - Java: Adds `.instance("<YOUR_GLEAN_INSTANCE_HERE>")` after `.apiToken()`
 *
 * @param {Object} spec The OpenAPI specification object containing code samples
 * @returns {Object} The modified OpenAPI specification with updated code samples
 */
export function addInstanceToCodeSamples(spec) {
  const transformationsByLang = {
    python: [
      [
        /([\s]*)(api_token=os\.getenv\("GLEAN_API_TOKEN", ""\),)/,
        '$1$2$1instance=os.getenv("GLEAN_INSTANCE", ""),',
      ],
    ],
    typescript: [
      [
        /([\s]*)(apiToken: process\.env\["GLEAN_API_TOKEN"\] \?\? "",)/,
        '$1$2$1instance: process.env["GLEAN_INSTANCE"] ?? "",',
      ],
    ],
    go: [
      [
        /([\s]*)(apiclientgo\.WithSecurity\(os\.Getenv\("GLEAN_API_TOKEN"\)\),)/,
        '$1$2$1apiclientgo.WithInstance(os.Getenv("GLEAN_INSTANCE")),',
      ],
    ],
    java: [
      [
        /([\s]*)(\.apiToken\("<YOUR_BEARER_TOKEN_HERE>"\))/,
        '$1$2$1.instance("<YOUR_GLEAN_INSTANCE_HERE>")',
      ],
    ],
  };

  for (const [_, pathSpec] of path(spec)) {
    for (const [lang, codeSample] of codeSnippets(pathSpec)) {
      const transformations = transformationsByLang[lang];

      if (!transformations) {
        continue;
      }

      let codeSampleSource = codeSample.source;

      for (const [pattern, replacement] of transformations) {
        codeSampleSource = codeSampleSource.replace(pattern, replacement);
      }

      codeSample.source = codeSampleSource;
    }
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
  addInstanceToCodeSamples(spec);

  return yaml.dump(spec, {
    lineWidth: -1, // Preserve line breaks
    noRefs: true, // Don't use anchors and aliases
    quotingType: '"', // Use double quotes for strings
  });
}
