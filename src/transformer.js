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
 * Transforms OpenAPI YAML by adjusting server URLs and paths
 * @param {string} yamlContent The OpenAPI YAML content
 * @returns {string} Transformed YAML content
 */
export function transformYaml(yamlContent) {
  const spec = yaml.load(yamlContent);
  
  if (!spec.servers || spec.servers.length === 0) {
    console.warn('No servers found in the OpenAPI spec');
    return yamlContent;
  }
  
  const firstServer = spec.servers[0];
  if (!firstServer.url) {
    console.warn('Server URL is missing');
    return yamlContent;
  }
  
  const basePath = extractBasePath(firstServer.url);
  if (!basePath) {
    console.warn('No base path found in server URL');
    return yamlContent;
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
  
  return yaml.dump(spec, {
    lineWidth: -1,  // Preserve line breaks
    noRefs: true,   // Don't use anchors and aliases
    quotingType: '"' // Use double quotes for strings
  });
}
