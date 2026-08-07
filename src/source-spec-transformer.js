import yaml from 'js-yaml';

/**
 * Repairs `example` values that contradict the schema they are attached to.
 *
 * These examples are not decorative. Anything that builds a request body from the
 * spec copies them verbatim — the developer site's interactive "try it" panel
 * prefills exactly these values — so an example whose type does not match its
 * schema ships a request the API rejects, and the first click on the page returns
 * an error. Speakeasy's SDK samples mask the same defect by passing examples
 * through typed models that silently coerce whatever does not fit, which is why a
 * broken example can look correct in the Python tab and fail in the panel beside it.
 *
 * Each repair is guarded so it only fires on the wrong shape: once the upstream
 * spec is corrected at source, every one of these becomes a no-op rather than
 * clobbering a now-valid example. `validate-examples.js` is the general net that
 * fails CI when a new mismatch appears; this function fixes the known ones.
 *
 * @param {Object} spec The OpenAPI spec object
 * @returns {Object} The same spec, repaired in place
 */
export function transformInvalidExamples(spec) {
  const schemas = spec.components?.schemas;
  if (!schemas) return spec;

  // `values` items are FacetFilterValue objects, not bare strings. Applies to
  // every schema carrying a facet-filter example, request and response alike.
  const repairFacetFilterValues = (filters) => {
    if (!Array.isArray(filters)) return;
    for (const filter of filters) {
      if (!Array.isArray(filter?.values)) continue;
      filter.values = filter.values.map((v) =>
        typeof v === 'string' ? { value: v, relationType: 'EQUALS' } : v,
      );
    }
  };
  for (const schema of Object.values(schemas)) {
    if (!schema?.example) continue;
    repairFacetFilterValues(schema.example.facetFilters);
    repairFacetFilterValues(schema.example.rewrittenFacetFilters);
  }

  // `status` is a single string ("Done"), not a list.
  const documentMetadata = schemas.DocumentMetadata;
  if (Array.isArray(documentMetadata?.example?.status)) {
    documentMetadata.example.status = documentMetadata.example.status[0];
  }

  // CustomData maps a field name to a CustomDataValue object, so a bare string
  // has to become the object's stringValue.
  const customData = documentMetadata?.example?.customData;
  if (customData && typeof customData === 'object') {
    for (const [key, value] of Object.entries(customData)) {
      if (typeof value === 'string') customData[key] = { stringValue: value };
    }
  }

  // The schema calls this a "phone number as a number string" — so, a string.
  const personMetadata = schemas.PersonMetadata;
  if (typeof personMetadata?.example?.phone === 'number') {
    personMetadata.example.phone = String(personMetadata.example.phone);
  }

  // objectName is a single string. Its example listed several candidate names,
  // which reads as "any of these" but validates as none of them.
  const objectName = schemas.objectName;
  if (objectName?.type === 'string' && Array.isArray(objectName.example)) {
    objectName.example = objectName.example[0];
  }

  // mustIncludeSuggestions is a QuerySuggestionList — the wrapper object, not the
  // bare suggestion array the example supplied.
  const suggestions = schemas.SearchResult?.example?.mustIncludeSuggestions;
  if (Array.isArray(suggestions)) {
    schemas.SearchResult.example.mustIncludeSuggestions = {
      suggestions,
    };
  }

  return spec;
}

/**
 * Gives pagination `cursor` properties an empty-string example.
 *
 * A cursor has no example, so a renderer synthesizing a request body from the
 * schema fills the placeholder `"string"` — and the API answers HTTP 500 to a
 * malformed cursor rather than ignoring it, so the very first request a reader
 * sends from the docs fails. An empty cursor means "start from the beginning",
 * which is exactly what a first request wants, and is the only value that is both
 * type-correct and semantically valid: any literal token we could invent would be
 * expired or forged.
 *
 * The 500 is worth fixing at the API too — a bad cursor is a client error — but
 * that would still leave the docs sending a request that fails, so the example is
 * needed either way.
 *
 * @param {Object} spec The OpenAPI spec object
 * @returns {Object} The same spec, updated in place
 */
export function transformCursorExamples(spec) {
  const visit = (node, seen) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const cursor = node.properties?.cursor;
    if (
      cursor &&
      cursor.type === 'string' &&
      cursor.example === undefined &&
      !cursor.$ref
    ) {
      cursor.example = '';
    }
    for (const child of Object.values(node)) visit(child, seen);
  };
  visit(spec, new WeakSet());
  return spec;
}

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

const httpMethods = new Set([
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'trace',
]);

const platformSdkGroupPattern = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;
const platformSdkMethodPattern = /^[a-z][A-Za-z0-9]*$/;

function rewriteRefs(obj, refMap) {
  if (!obj || typeof obj !== 'object') return;

  // Component refs can appear in request bodies, responses, nested schemas, and
  // examples, so renames have to be applied across the whole document tree.
  Object.keys(obj).forEach((key) => {
    if (key === '$ref' && typeof obj[key] === 'string' && refMap[obj[key]]) {
      obj[key] = refMap[obj[key]];
    } else if (typeof obj[key] === 'object') {
      rewriteRefs(obj[key], refMap);
    }
  });
}

function transformPlatformTagGroups(spec) {
  delete spec['x-tagGroups'];
}

function platformSchemaName(name) {
  return name.startsWith('Platform') ? name : `Platform${name}`;
}

function transformPlatformSchemas(spec) {
  if (!spec.components?.schemas) {
    return;
  }

  // Platform is merged into the existing public SDK spec, so common names like
  // SearchRequest, Result, or Person would otherwise collide with legacy REST
  // schemas. Prefixing every Platform schema keeps the merged model surface
  // deterministic without requiring each scio schema to know about SDK peers.
  const schemas = spec.components.schemas;
  const refMap = {};

  // Build the full rename plan before mutating schemas so collisions fail before
  // refs are rewritten and before any partial rename can leak into the output.
  for (const name of Object.keys(schemas)) {
    const nextName = platformSchemaName(name);
    if (nextName !== name) {
      if (schemas[nextName]) {
        throw new Error(
          `Platform schema ${name} cannot be renamed to ${nextName} because ${nextName} already exists`,
        );
      }
      refMap[`#/components/schemas/${name}`] =
        `#/components/schemas/${nextName}`;
    }
  }

  for (const [name, schema] of Object.entries(schemas)) {
    const nextName = platformSchemaName(name);
    if (nextName !== name) {
      schemas[nextName] = schema;
      delete schemas[name];
    }
  }

  rewriteRefs(spec, refMap);
}

function transformPlatformResponses(spec) {
  if (!spec.components?.responses) {
    return;
  }

  // Shared response names such as BadRequest and Unauthorized are global within
  // the merged OpenAPI document. Keep Platform problem-detail responses separate
  // from the existing REST response components.
  const responses = spec.components.responses;
  const refMap = {};

  for (const name of Object.keys(responses)) {
    const nextName = platformSchemaName(name);
    if (nextName !== name) {
      if (responses[nextName]) {
        throw new Error(
          `Platform response ${name} cannot be renamed to ${nextName} because ${nextName} already exists`,
        );
      }
      refMap[`#/components/responses/${name}`] =
        `#/components/responses/${nextName}`;
    }
  }

  for (const [name, response] of Object.entries(responses)) {
    const nextName = platformSchemaName(name);
    if (nextName !== name) {
      responses[nextName] = response;
      delete responses[name];
    }
  }

  rewriteRefs(spec, refMap);
}

function transformPlatformApiTokenSecurity(spec) {
  // scio's Platform source spec uses ApiToken, while the merged SDK spec already
  // standardizes auth under APIToken. Normalize before merge so Speakeasy sees
  // one auth scheme instead of generating a second Platform-specific credential.
  const securitySchemes = spec.components?.securitySchemes;
  if (securitySchemes?.ApiToken) {
    if (securitySchemes.APIToken) {
      throw new Error(
        'Platform security scheme ApiToken cannot be renamed to APIToken because APIToken already exists',
      );
    }
    securitySchemes.APIToken = securitySchemes.ApiToken;
    delete securitySchemes.ApiToken;
  }

  const rewriteSecurity = (requirements) => {
    if (!Array.isArray(requirements)) {
      return requirements;
    }

    return requirements.map((requirement) => {
      if (!requirement || typeof requirement !== 'object') {
        return requirement;
      }
      if (requirement.ApiToken === undefined) {
        return requirement;
      }
      const { ApiToken, ...otherSchemes } = requirement;
      return { APIToken: ApiToken, ...otherSchemes };
    });
  };

  spec.security = rewriteSecurity(spec.security);
  if (!spec.paths) {
    return;
  }

  for (const pathItem of Object.values(spec.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (
        !httpMethods.has(method) ||
        !operation ||
        typeof operation !== 'object'
      ) {
        continue;
      }
      operation.security = rewriteSecurity(operation.security);
    }
  }
}

function transformPlatformOperations(spec) {
  if (!spec.paths) {
    return;
  }

  // Missing SDK metadata should fail here instead of letting Speakeasy invent a
  // default method name or forcing a follow-up mapping change in this repo.
  const sdkMethods = new Map();
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (
        !httpMethods.has(method) ||
        !operation ||
        typeof operation !== 'object'
      ) {
        continue;
      }

      const location = `${method.toUpperCase()} ${path} with operationId ${operation.operationId || '<missing>'}`;
      const sdk = operation['x-glean-sdk'];
      if (!sdk || typeof sdk !== 'object' || Array.isArray(sdk)) {
        throw new Error(
          `Platform operation ${location} must declare x-glean-sdk.group and x-glean-sdk.method`,
        );
      }

      if (
        typeof sdk.group !== 'string' ||
        !platformSdkGroupPattern.test(sdk.group)
      ) {
        throw new Error(
          `Platform operation ${location} has invalid x-glean-sdk.group ${JSON.stringify(sdk.group)}; expected lowercase dot-separated identifiers`,
        );
      }

      if (
        typeof sdk.method !== 'string' ||
        !platformSdkMethodPattern.test(sdk.method)
      ) {
        throw new Error(
          `Platform operation ${location} has invalid x-glean-sdk.method ${JSON.stringify(sdk.method)}; expected lower-camel identifier`,
        );
      }

      const sdkMethodKey = `${sdk.group}.${sdk.method}`;
      if (sdkMethods.has(sdkMethodKey)) {
        throw new Error(
          `Platform operation ${location} declares duplicate SDK method ${sdkMethodKey}; already used by ${sdkMethods.get(sdkMethodKey)}`,
        );
      }
      sdkMethods.set(sdkMethodKey, location);

      operation['x-speakeasy-group'] = sdk.group;
      operation['x-speakeasy-name-override'] = sdk.method;
      // x-glean-sdk is a source contract between scio and this transform; the
      // generated public spec only needs the Speakeasy extensions it derives.
      delete operation['x-glean-sdk'];
    }
  }
}

export function transformPlatformSpec(spec) {
  transformPlatformTagGroups(spec);
  transformPlatformSchemas(spec);
  transformPlatformResponses(spec);
  transformPlatformApiTokenSecurity(spec);
  transformPlatformOperations(spec);

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
  const updateServers = (servers) => {
    if (!Array.isArray(servers)) {
      return;
    }

    for (const server of servers) {
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
  };

  updateServers(spec.servers);

  if (spec.paths) {
    for (const pathValue of Object.values(spec.paths)) {
      if (pathValue && typeof pathValue === 'object') {
        updateServers(pathValue.servers);
      }
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
      // Keep both keys: x-enumDescriptions for Docusaurus docs, x-speakeasy-enum-descriptions for SDK generation
      obj['x-speakeasy-enum-descriptions'] = obj['x-enumDescriptions'];
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
 * Transforms x-glean-deprecated annotations to Speakeasy-compatible deprecation format.
 *
 * For property-level deprecations: sets `deprecated: true` and `x-speakeasy-deprecation-message`.
 * For enum-value deprecations: merges per-value `@deprecated` text into `x-speakeasy-enum-descriptions`.
 * Preserves the original `x-glean-deprecated` annotation in all cases.
 *
 * More information about the deprecation format can be found at: https://www.speakeasy.com/docs/sdks/customize/deprecations
 *
 * @param {Object} spec The OpenAPI spec object
 * @returns {Object} Transformed spec object
 */
export function transformGleanDeprecated(spec) {
  /**
   * Builds a human-readable deprecation message from a single x-glean-deprecated entry.
   * Handles missing fields gracefully to avoid "Deprecated on undefined" in SDK output.
   *
   * @param {Object|null} src A single deprecation object with optional introduced, removal, message
   * @returns {string} Formatted message, or empty string if src is invalid
   */
  const buildMessageFrom = (src) => {
    if (!src || typeof src !== 'object' || Array.isArray(src)) {
      return '';
    }

    const parts = [];

    if (src.introduced) {
      parts.push(`Deprecated on ${src.introduced}`);
    }

    if (src.removal) {
      parts.push(
        parts.length > 0
          ? `, removal scheduled for ${src.removal}`
          : `Removal scheduled for ${src.removal}`,
      );
    }

    let text = parts.join('');
    if (src.message) {
      text += `${text ? ': ' : ''}${src.message}`;
    }

    return text;
  };

  /**
   * Normalizes x-speakeasy-enum-descriptions into a { enumValue: description } object map.
   * Speakeasy accepts both array-indexed and object-map forms; this ensures we always
   * work with the object-map form so we can merge deprecation text by enum value name.
   *
   * @param {Object|Array|undefined} existing Current x-speakeasy-enum-descriptions value
   * @param {string[]} enumValues The enum values from the schema, used for array→map index alignment
   * @returns {Object} Normalized { enumValue: description } map
   */
  const toEnumDescriptionsMap = (existing, enumValues) => {
    if (!existing) {
      return {};
    }
    if (Array.isArray(existing)) {
      if (!Array.isArray(enumValues)) {
        return {};
      }
      const out = {};
      for (let i = 0; i < enumValues.length; i++) {
        const key = enumValues[i];
        const value = existing[i];
        if (typeof key === 'string' && typeof value === 'string' && value) {
          out[key] = value;
        }
      }
      return out;
    }
    if (typeof existing === 'object') {
      return { ...existing };
    }
    return {};
  };

  /**
   * Appends a deprecation annotation to an enum value's description, skipping if
   * the description already contains an @deprecated tag to avoid duplicate annotations.
   *
   * @param {string|undefined} existing Current description for this enum value
   * @param {string|undefined} addition The @deprecated text to append
   * @returns {string} Merged description
   */
  const mergeEnumDescription = (existing, addition) => {
    if (!addition) {
      return existing || '';
    }
    if (!existing) {
      return addition;
    }
    if (existing.includes('@deprecated')) {
      return existing;
    }
    return `${existing}\n\n${addition}`;
  };

  /**
   * Processes kind: enum-value entries from an array-form x-glean-deprecated and merges
   * their deprecation text into x-speakeasy-enum-descriptions. This is how Speakeasy
   * surfaces per-value deprecation info in generated SDK code.
   *
   * @param {Object} obj The schema node (must have an enum array)
   * @param {Array} deprecation The array-form x-glean-deprecated value
   */
  const addEnumValueDeprecationsToDescriptions = (obj, deprecation) => {
    if (!Array.isArray(deprecation) || !Array.isArray(obj.enum)) {
      return;
    }

    const enumValueDeprecations = deprecation.filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        item.kind === 'enum-value' &&
        typeof item['enum-value'] === 'string',
    );

    if (enumValueDeprecations.length === 0) {
      return;
    }

    const enumValues = obj.enum.filter((v) => typeof v === 'string');
    if (enumValues.length === 0) {
      return;
    }

    const descriptions = toEnumDescriptionsMap(
      obj['x-speakeasy-enum-descriptions'],
      enumValues,
    );

    for (const item of enumValueDeprecations) {
      const value = item['enum-value'];
      if (!enumValues.includes(value)) {
        continue;
      }
      const text = buildMessageFrom(item);
      if (!text) {
        continue;
      }
      const deprecationText = `@deprecated ${text}${item.docs ? ` See ${item.docs}` : ''}`;
      descriptions[value] = mergeEnumDescription(
        descriptions[value],
        deprecationText,
      );
    }

    if (Object.keys(descriptions).length > 0) {
      obj['x-speakeasy-enum-descriptions'] = descriptions;
    }
  };

  /**
   * Determines whether a property-level deprecation should be set, and returns the
   * source object to build the message from (or null to skip).
   *
   * x-glean-deprecated has two forms (see DEPRECATIONS.md in glean-developer-site):
   *   - Object form: simple property/endpoint deprecation (no kind field)
   *   - Array form: used on enum fields, entries have kind: property | enum-value
   *
   * Returns null (skip property deprecation) when:
   *   - Single object is an enum-value-only deprecation
   *   - Array form on a non-enum field (array form is only valid on enums per spec)
   *   - Array has no kind: property entry (only enum values are deprecated, not the property)
   *
   * @param {Object|Array} deprecation Raw x-glean-deprecated value
   * @param {boolean} hasEnum Whether the schema node has an enum array
   * @returns {Object|null} Source object for buildMessageFrom, or null to skip
   */
  const selectDeprecationSource = (deprecation, hasEnum) => {
    if (!deprecation || typeof deprecation !== 'object') {
      return null;
    }

    if (!Array.isArray(deprecation)) {
      if (deprecation.kind === 'enum-value' || 'enum-value' in deprecation) {
        return null;
      }
      return deprecation;
    }

    if (!hasEnum) {
      return null;
    }

    return (
      deprecation.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          item.kind === 'property',
      ) || null
    );
  };

  const processObject = (obj) => {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(processObject);
      return;
    }

    if (obj['x-glean-deprecated']) {
      const raw = obj['x-glean-deprecated'];

      if (Array.isArray(raw) && Array.isArray(obj.enum)) {
        addEnumValueDeprecationsToDescriptions(obj, raw);
      }

      const source = selectDeprecationSource(raw, Array.isArray(obj.enum));
      const message = buildMessageFrom(source);

      if (message) {
        obj.deprecated = true;
        obj['x-speakeasy-deprecation-message'] = message;
      } else {
        delete obj['x-speakeasy-deprecation-message'];
      }
    }

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

      // Honor path-level `servers:` blocks. When a path declares its own server,
      // its basePath is the prefix that should appear in the final path key —
      // not the global basePath. We also strip that basePath from the path-level
      // server URL so that `pathServer.url + pathKey` composes the correct full
      // URL (matching the convention used for the global server).
      let pathBasePath = basePath;
      if (Array.isArray(pathValue?.servers) && pathValue.servers.length > 0) {
        const firstPathServerUrl = pathValue.servers[0].url;
        if (firstPathServerUrl) {
          const candidate = extractBasePath(firstPathServerUrl);
          if (candidate) {
            pathBasePath = candidate;
            for (const pathServer of pathValue.servers) {
              if (pathServer.url) {
                pathServer.url = pathServer.url.replace(candidate, '');
              }
            }
          }
        }
      }

      const newPathKey = `${pathBasePath}${normalizedPath}`;
      newPaths[newPathKey] = pathValue;
    }
    spec.paths = newPaths;
  }

  // Apply Shortcut -> IndexingShortcut transformation for indexing.yaml
  if (filename === 'indexing.yaml') {
    transformShortcutComponent(spec);
  }

  // Platform is the only source spec merged into an existing public SDK, so it
  // needs collision isolation and SDK-name materialization before generic passes.
  if (filename === 'platform.yaml') {
    transformPlatformSpec(spec);
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

  // Repair examples that contradict their own schema, for all files
  transformInvalidExamples(spec);

  // Give pagination cursors an example the API accepts, for all files
  transformCursorExamples(spec);

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
