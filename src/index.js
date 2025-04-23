const core = require('@actions/core');
const exec = require('@actions/exec');
const { HttpClient } = require('@actions/http-client');
const fs = require('fs');
const path = require('path');
const transformer = require('./transformer');

// URLs for the OpenAPI specification files
const URLS = [
  'https://api.redoc.ly/registry/assets/glean/Glean%20Client%20API/v1/public/client_rest.yaml?branch=main',
  'https://api.redoc.ly/registry/assets/glean/Glean%20Indexing%20API/v1/public/indexing.yaml?branch=main'
];

// Output file names
const OUTPUT_FILES = [
  'client_rest.yaml',
  'indexing.yaml'
];

// Output directory
const OUTPUT_DIR = 'generated';

async function downloadYaml(url) {
  try {
    const http = new HttpClient('openapi-yaml-transformer');
    const response = await http.get(url);
    const body = await response.readBody();
    return body;
  } catch (error) {
    core.setFailed(`Error downloading from ${url}: ${error.message}`);
    throw error;
  }
}

async function configGit() {
  try {
    await exec.exec('git', ['config', '--local', 'user.email', 'action@github.com']);
    await exec.exec('git', ['config', '--local', 'user.name', 'GitHub Action']);
  } catch (error) {
    core.setFailed(`Error configuring git: ${error.message}`);
    throw error;
  }
}

async function commitChanges(files) {
  try {
    // Add files
    for (const file of files) {
      await exec.exec('git', ['add', file]);
    }
    
    // Check if there are changes to commit
    let hasChanges = false;
    const exitCode = await exec.exec('git', ['diff', '--staged', '--quiet'], {
      ignoreReturnCode: true
    });
    hasChanges = exitCode !== 0;
    
    if (hasChanges) {
      await exec.exec('git', ['commit', '-m', 'Update OpenAPI specs']);
      await exec.exec('git', ['push']);
      core.info('Changes committed and pushed');
    } else {
      core.info('No changes to commit');
    }
  } catch (error) {
    core.setFailed(`Error committing changes: ${error.message}`);
    throw error;
  }
}

async function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
    core.info(`Created directory: ${directory}`);
  }
}

async function run() {
  try {
    // Ensure the output directory exists
    await ensureDirectoryExists(OUTPUT_DIR);
    
    // Array to store full paths of output files
    const outputFilePaths = [];
    
    // For each URL
    for (let i = 0; i < URLS.length; i++) {
      const url = URLS[i];
      const outputFileName = OUTPUT_FILES[i];
      const outputFilePath = path.join(OUTPUT_DIR, outputFileName);
      outputFilePaths.push(outputFilePath);
      
      core.info(`Processing ${url}`);
      
      // Download the YAML
      const yamlContent = await downloadYaml(url);
      
      // Transform the YAML
      const transformedYaml = transformer.transformYaml(yamlContent);
      
      // Write the transformed YAML to file
      fs.writeFileSync(outputFilePath, transformedYaml, 'utf8');
      
      core.info(`Saved transformed YAML to ${outputFilePath}`);
    }
    
    // Configure git
    await configGit();
    
    // Commit and push changes
    await commitChanges(outputFilePaths);
    
    core.info('OpenAPI specs transformation completed successfully');
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

// Run the action
if (require.main === module) {
  run();
}

// Export for testing
module.exports = {
  run,
  downloadYaml
}; 