import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { transform } from './transformer.js';

// Source and output directories
const SOURCE_DIR = 'source_specs';
const OUTPUT_DIR = 'generated_specs';

// Specification files
const SPEC_FILES = [
  'client_rest.yaml',
  'indexing.yaml',
  'admin_rest.yaml'
];

async function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
    core.info(`Created directory: ${directory}`);
  }
}

export async function readYamlFromFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    core.setFailed(`Error reading file ${filePath}: ${error.message}`);
    throw error;
  }
}

export async function run() {
  try {
    await ensureDirectoryExists(OUTPUT_DIR);
    
    for (const specFile of SPEC_FILES) {
      const sourceFilePath = path.join(SOURCE_DIR, specFile);
      const outputFilePath = path.join(OUTPUT_DIR, specFile);
      
      core.info(`Processing ${sourceFilePath}`);
      
      const yamlContent = await readYamlFromFile(sourceFilePath);
      
      const transformedYaml = transform(yamlContent, specFile);
      
      fs.writeFileSync(outputFilePath, transformedYaml, 'utf8');
      
      core.info(`Saved transformed YAML to ${outputFilePath}`);
    }
    
    core.info('OpenAPI specs transformation completed');
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
