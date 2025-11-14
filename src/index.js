import * as fs from 'fs';
import * as path from 'path';
import * as sourceSpecTransformer from './source-spec-transformer.js';
import * as codeSamplesTransformer from './code-sample-transformer.js';

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

function getYamlFiles(directory) {
  try {
    const files = fs.readdirSync(directory);
    return files.filter(
      (file) => file.endsWith('.yaml') || file.endsWith('.yml'),
    );
  } catch (error) {
    console.error(`Error reading directory ${directory}: ${error.message}`);
    throw error;
  }
}

export async function transformSourceSpecs() {
  const sourceDir = 'source_specs';
  const outputDir = 'generated_specs';

  try {
    const specFiles = getYamlFiles(sourceDir);

    if (specFiles.length === 0) {
      console.log(`No YAML files found in ${sourceDir}`);
      return;
    }

    await ensureDirectoryExists(outputDir);

    // Get the commit SHA from environment variable (set by GitHub Actions)
    const commitSha = process.env.GITHUB_SHA || process.env.OPEN_API_COMMIT_SHA;

    if (commitSha) {
      console.log(`Injecting open-api commit SHA: ${commitSha}`);
    } else {
      console.log(
        'No commit SHA provided (GITHUB_SHA or OPEN_API_COMMIT_SHA environment variable not set)',
      );
    }

    for (const specFile of specFiles) {
      const sourceFilePath = path.join(sourceDir, specFile);
      const outputFilePath = path.join(outputDir, specFile);

      console.log(`Processing ${sourceFilePath}`);

      const yamlContent = await readYamlFromFile(sourceFilePath);

      const transformedYaml = sourceSpecTransformer.transform(
        yamlContent,
        specFile,
        commitSha,
      );

      fs.writeFileSync(outputFilePath, transformedYaml, 'utf8');

      console.log(`Saved transformed YAML to ${outputFilePath}`);
    }

    console.log('OpenAPI specs transformation completed');
  } catch (error) {
    console.error(`Transformation failed: ${error.message}`);
    process.exit(1);
  }
}

export async function transformMergedCodeSamplesSpecs() {
  const sourceDir = 'merged_code_samples_specs';
  const outputDir = 'modified_code_samples_specs';

  try {
    const specFiles = getYamlFiles(sourceDir);

    if (specFiles.length === 0) {
      console.log(`No YAML files found in ${sourceDir}`);
      return;
    }

    await ensureDirectoryExists(outputDir);

    for (const specFile of specFiles) {
      const sourceFilePath = path.join(sourceDir, specFile);
      const outputFileName = specFile.includes('client')
        ? 'client_rest.yaml'
        : specFile.includes('index')
          ? 'indexing.yaml'
          : path.join(outputDir, specFile);
      const outputFilePath = path.join(outputDir, outputFileName);

      console.log(`Processing ${sourceFilePath}`);

      const yamlContent = await readYamlFromFile(sourceFilePath);

      const transformedYaml = codeSamplesTransformer.transform(
        yamlContent,
        specFile,
      );

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
  } else if (args.includes('--merged_code_samples_specs')) {
    await transformMergedCodeSamplesSpecs();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
