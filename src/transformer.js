const yaml = require('js-yaml');
const path = require('path');

/**
 * Extracts the base path from a server URL
 * @param {string} url Server URL with variables
 * @returns {string} The base path
 */
function extractBasePath(url) {
  // Replace any variable placeholders with dummy values for parsing
  const tempUrl = url.replace(/{([^}]+)}/g, 'domain');
  
  try {
    const urlObj = new URL(tempUrl);
    const basePath = urlObj.pathname;
    
    // Remove trailing slash if it exists
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
function transformYaml(yamlContent) {
  // Parse the YAML content
  const spec = yaml.load(yamlContent);
  
  // Check if there are servers defined
  if (!spec.servers || spec.servers.length === 0) {
    console.warn('No servers found in the OpenAPI spec');
    return yamlContent;
  }
  
  // Find the base path from the first server
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
  
  // Update all server URLs to remove the base path
  for (const server of spec.servers) {
    if (server.url) {
      server.url = server.url.replace(basePath, '');
    }
  }
  
  // Update paths to include the base path
  if (spec.paths) {
    const newPaths = {};
    for (const [pathKey, pathValue] of Object.entries(spec.paths)) {
      // Ensure the path starts with a slash
      const normalizedPath = pathKey.startsWith('/') ? pathKey : `/${pathKey}`;
      
      // Combine the base path with the original path
      const newPathKey = `${basePath}${normalizedPath}`;
      newPaths[newPathKey] = pathValue;
    }
    spec.paths = newPaths;
  }
  
  // Convert back to YAML string with proper formatting
  return yaml.dump(spec, {
    lineWidth: -1,  // Preserve line breaks
    noRefs: true,   // Don't use anchors and aliases
    quotingType: '"' // Use double quotes for strings
  });
}

module.exports = {
  transformYaml,
  extractBasePath
}; 