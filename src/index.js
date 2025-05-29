import * as fs from 'fs';
import * as path from 'path';
import { transform } from './source-spec-transformer.js';

// Source and output directories
const SOURCE_DIR = 'source_specs';
const OUTPUT_DIR = 'generated_specs';

// Specification files
const SPEC_FILES = ['client_rest.yaml', 'indexing.yaml', 'admin_rest.yaml'];

async function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
    console.log(`Created directory: ${directory}`);
  }
}

export async function readYamlFromFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`Error reading file ${filePath}: ${error.message}`);
    throw error;
  }
}

export async function transformSourceSpecs() {
  try {
    await ensureDirectoryExists(OUTPUT_DIR);

    for (const specFile of SPEC_FILES) {
      const sourceFilePath = path.join(SOURCE_DIR, specFile);
      const outputFilePath = path.join(OUTPUT_DIR, specFile);

      console.log(`Processing ${sourceFilePath}`);

      const yamlContent = await readYamlFromFile(sourceFilePath);

      const transformedYaml = transform(yamlContent, specFile);

      fs.writeFileSync(outputFilePath, transformedYaml, 'utf8');

      console.log(`Saved transformed YAML to ${outputFilePath}`);
    }

    console.log('OpenAPI specs transformation completed');
  } catch (error) {
    console.error(`Transformation failed: ${error.message}`);
    process.exit(1);
  }
}

export async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--source_specs')) {
    await transformSourceSpecs();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
