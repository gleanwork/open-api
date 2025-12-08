import yaml from 'js-yaml';

/**
 * Extracts the base path from a server URL
 * @param {string} url Server URL with variables
 * @returns {string} The base path
 */
export function extractBasePath(url) {
  const tempUrl = url.replace(/{([^}]+)}/g, 'domain');

  try {
    const urlObj = new URL(tempUrl);
    const basePath = urlObj.pathname;

    return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  } catch (error) {
    console.warn(`Unable to parse URL: ${url}`);
    return '';
  }
}

/**
 * Transforms the Shortcut component to IndexingShortcut in indexing.yaml
 * @param {Object} spec The OpenAPI spec object
 * @returns {Object} Transformed spec object
 */
export function transformShortcutComponent(spec) {
  // Only proceed if we have schemas defined
  if (!spec.components || !spec.components.schemas) {
    return spec;
  }

  // Rename the Shortcut component to IndexingShortcut
  if (spec.components.schemas.Shortcut) {
    spec.components.schemas.IndexingShortcut = spec.components.schemas.Shortcut;
    delete spec.components.schemas.Shortcut;
  }

  // Update all references to Shortcut
  const replaceReferences = (obj) => {
    if (!obj || typeof obj !== 'object') return;

    Object.keys(obj).forEach((key) => {
      if (
        typeof obj[key] === 'string' &&
        obj[key] === '#/components/schemas/Shortcut'
      ) {
        obj[key] = '#/components/schemas/IndexingShortcut';
      } else if (typeof obj[key] === 'object') {
        replaceReferences(obj[key]);
      }
    });
  };

  replaceReferences(spec);

  return spec;
}

/**
 * Transforms the BearerAuth security scheme to APIToken
 * @param {Object} spec The OpenAPI spec object
 * @returns {Object} Transformed spec object
 */
export function transformBearerAuthToAPIToken(spec) {
  // Only proceed if we have securitySchemes defined
  if (!spec.components || !spec.components.securitySchemes) {
    return spec;
  }

  // Rename BearerAuth to APIToken if it exists
  if (spec.components.securitySchemes.BearerAuth) {
    spec.components.securitySchemes.APIToken =
      spec.components.securitySchemes.BearerAuth;
    delete spec.components.securitySchemes.BearerAuth;
  }

  // Update top-level security requirement
  if (spec.security) {
    spec.security = spec.security.map((secReq) => {
      if (secReq.BearerAuth !== undefined) {
        return { APIToken: secReq.BearerAuth };
      }
      return secReq;
    });
  }

  // Update operation-level security requirements
  if (spec.paths) {
    Object.keys(spec.paths).forEach((path) => {
      const pathObj = spec.paths[path];
      Object.keys(pathObj).forEach((method) => {
        if (typeof pathObj[method] === 'object' && pathObj[method].security) {
          pathObj[method].security = pathObj[method].security.map((secReq) => {
            if (secReq.BearerAuth !== undefined) {
              return { APIToken: secReq.BearerAuth };
            }
            return secReq;
          });
        }
      });
    });
  }

  // Update all references to bearerAuth in code samples (lowercase used in samples)
  const replaceInCodeSamples = (obj) => {
    if (!obj || typeof obj !== 'object') return;

    Object.keys(obj).forEach((key) => {
      // Replace in string values for code samples
      if (typeof obj[key] === 'string') {
        if (obj[key].includes('bearerAuth')) {
          obj[key] = obj[key].replace(/bearerAuth/g, 'apiToken');
        }
        if (obj[key].includes('BEARER_AUTH')) {
          obj[key] = obj[key].replace(/BEARER_AUTH/g, 'API_TOKEN');
        }
      } else if (typeof obj[key] === 'object') {
        replaceInCodeSamples(obj[key]);
      }
    });
  };

  // Process x-code-samples if they exist
  if (spec['x-code-samples']) {
    replaceInCodeSamples(spec['x-code-samples']);
  }

  // Process individual operation code samples
  if (spec.paths) {
    Object.values(spec.paths).forEach((pathObj) => {
      Object.values(pathObj).forEach((operation) => {
        if (operation['x-code-samples']) {
          replaceInCodeSamples(operation['x-code-samples']);
        }
      });
    });
  }

  return spec;
}

/**
 * Transforms the actAsBearerToken security scheme to APIToken
 * @param {Object} spec The OpenAPI spec object
 * @returns {Object} Transformed spec object
 */
export function transformActAsBearerTokenToAPIToken(spec) {
  if (!spec.components) {
    return spec;
  }

  if (spec.components.securitySchemes?.cookieAuth) {
    delete spec.components.securitySchemes.cookieAuth;
  }

  const cleanSecurityObject = (secObj) => {
    if (!secObj || typeof secObj !== 'object') return secObj;

    const cleaned = { ...secObj };

    if ('actAsBearerToken' in cleaned) {
      cleaned.APIToken = cleaned.actAsBearerToken;
      delete cleaned.actAsBearerToken;
    }

    if ('cookieAuth' in cleaned) {
      delete cleaned.cookieAuth;
    }

    return Object.keys(cleaned).length ? cleaned : null;
  };

  if (Array.isArray(spec.security)) {
    spec.security = spec.security.map(cleanSecurityObject).filter(Boolean);
  }

  if (spec.paths) {
    Object.values(spec.paths).forEach((pathObj) => {
      Object.values(pathObj).forEach((operation) => {
        if (Array.isArray(operation.security)) {
          operation.security = operation.security
            .map(cleanSecurityObject)
            .filter(Boolean);
        }
      });
    });
  }

  return spec;
}

/**
 * Transforms server variables from 'domain' to 'instance'
 * @param {Object} spec The OpenAPI spec object
 * @returns {Object} Transformed spec object
 */
export function transformServerVariables(spec) {
  if (!spec.servers || !Array.isArray(spec.servers)) {
    return spec;
  }

  for (const server of spec.servers) {
    if (server.url) {
      server.url = server.url.replace(/{domain}/g, '{instance}');
    }

    if (server.variables && server.variables.domain) {
      server.variables.instance = {
        default: 'instance-name',
        description:
          'The instance name (typically the email domain without the TLD) that determines the deployment backend.',
      };

      delete server.variables.domain;
    }
  }

  return spec;
}

/**
 * Converts x-enumDescriptions to x-speakeasy-enum-descriptions format
 * Speakeasy uses x-speakeasy-enum-descriptions instead of x-enumDescriptions
 * @param {Object} spec The OpenAPI spec object
 * @returns {Object} Transformed spec object
 */
export function transformEnumDescriptions(spec) {
  const processObject = (obj) => {
    if (!obj || typeof obj !== 'object') return;

    // Process arrays
    if (Array.isArray(obj)) {
      obj.forEach(processObject);
      return;
    }

    // Check if this object has x-enumDescriptions
    if (obj['x-enumDescriptions']) {
      // Copy to x-speakeasy-enum-descriptions (same format - object map)
      obj['x-speakeasy-enum-descriptions'] = obj['x-enumDescriptions'];

      // Remove the original x-enumDescriptions
      delete obj['x-enumDescriptions'];
    }

    // Recursively process all properties
    Object.values(obj).forEach((value) => {
      if (value && typeof value === 'object') {
        processObject(value);
      }
    });
  };

  processObject(spec);
  return spec;
}

/**
 * Transforms x-glean-deprecated annotations to Speakeasy-compatible deprecation format
 * Adds deprecated: true and x-speakeasy-deprecation-message fields while preserving the original annotation
 * @param {Object} spec The OpenAPI spec object
 * @returns {Object} Transformed spec object
 */
export function transformGleanDeprecated(spec) {
  const processObject = (obj) => {
    if (!obj || typeof obj !== 'object') return;

    // Process arrays
    if (Array.isArray(obj)) {
      obj.forEach(processObject);
      return;
    }

    // Check if this object has x-glean-deprecated
    if (obj['x-glean-deprecated']) {
      const deprecation = obj['x-glean-deprecated'];

      // Add deprecated: true
      obj.deprecated = true;

      // Build the deprecation message with dates
      const message = `Deprecated on ${deprecation.introduced}, removal scheduled for ${deprecation.removal}${deprecation.message ? `: ${deprecation.message}` : ''}`;
      obj['x-speakeasy-deprecation-message'] = message;
    }

    // Recursively process all properties
    Object.values(obj).forEach((value) => {
      if (value && typeof value === 'object') {
        processObject(value);
      }
    });
  };

  processObject(spec);
  return spec;
}

/**
 * Injects the open-api repository commit SHA into the spec info section
 * @param {Object} spec The OpenAPI spec object
 * @param {string} commitSha The commit SHA from the open-api repository
 * @returns {Object} Transformed spec object
 */
export function injectOpenApiCommitSha(spec, commitSha) {
  if (!spec.info) {
    spec.info = {};
  }

  if (commitSha) {
    spec.info['x-open-api-commit-sha'] = commitSha;
  }

  return spec;
}

/**
 * Transforms OpenAPI YAML by adjusting server URLs and paths
 * @param {string} content The OpenAPI YAML content
 * @param {string} filename The name of the file being processed
 * @param {string} [commitSha] Optional commit SHA from the open-api repository
 * @returns {string} Transformed YAML content
 */
export function transform(content, filename, commitSha) {
  const spec = yaml.load(content);

  if (!spec.servers || spec.servers.length === 0) {
    console.warn('No servers found in the OpenAPI spec');
    return content;
  }

  const firstServer = spec.servers[0];

  if (!firstServer.url) {
    console.warn('Server URL is missing');
    return content;
  }

  const basePath = extractBasePath(firstServer.url);

  if (!basePath) {
    console.warn('No base path found in server URL');
    return content;
  }

  for (const server of spec.servers) {
    if (server.url) {
      server.url = server.url.replace(basePath, '');
    }
  }

  if (spec.paths) {
    const newPaths = {};
    for (const [pathKey, pathValue] of Object.entries(spec.paths)) {
      const normalizedPath = pathKey.startsWith('/') ? pathKey : `/${pathKey}`;

      const newPathKey = `${basePath}${normalizedPath}`;
      newPaths[newPathKey] = pathValue;
    }
    spec.paths = newPaths;
  }

  // Apply Shortcut -> IndexingShortcut transformation for indexing.yaml
  if (filename === 'indexing.yaml') {
    transformShortcutComponent(spec);
  }

  // Apply BearerAuth -> APIToken transformation for all files
  transformBearerAuthToAPIToken(spec);

  // Apply domain -> instance transformation for all files
  transformServerVariables(spec);

  // Apply x-enumDescriptions -> x-speakeasy-enum-descriptions transformation for all files
  transformEnumDescriptions(spec);

  // Apply x-glean-deprecated -> Speakeasy deprecation format transformation for all files
  transformGleanDeprecated(spec);

  // Apply admin duplicate operationId fix
  if (filename === 'admin_rest.yaml') {
    transformActAsBearerTokenToAPIToken(spec);
  }

  // Inject open-api commit SHA if provided
  if (commitSha) {
    injectOpenApiCommitSha(spec, commitSha);
  }

  return yaml.dump(spec, {
    lineWidth: -1, // Preserve line breaks
    noRefs: true, // Don't use anchors and aliases
    quotingType: '"', // Use double quotes for strings
  });
}
