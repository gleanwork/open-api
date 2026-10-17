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

/**
 * Transforms one source spec and strips the operations that
 * config/unreleased-operations.yaml lists for it.
 */
export function transformSourceSpec(
  yamlContent,
  specFile,
  commitSha,
  unreleasedOperations = sourceSpecTransformer.loadUnreleasedOperations(),
) {
  return sourceSpecTransformer.transform(
    yamlContent,
    specFile,
    commitSha,
    unreleasedOperations[specFile],
  );
}

/**
 * Transforms every source spec into the output directory. Throws when
 * config/unreleased-operations.yaml names a source spec that does not exist,
 * so a typo or a renamed file cannot publish the operations it lists.
 */
export async function writeGeneratedSpecs({
  sourceDir = 'source_specs',
  outputDir = 'generated_specs',
  // Set by GitHub Actions
  commitSha = process.env.GITHUB_SHA || process.env.OPEN_API_COMMIT_SHA,
  unreleasedOperations = sourceSpecTransformer.loadUnreleasedOperations(),
} = {}) {
  const specFiles = getYamlFiles(sourceDir);

  if (specFiles.length === 0) {
    console.log(`No YAML files found in ${sourceDir}`);
    return;
  }

  const unknownFiles = Object.keys(unreleasedOperations).filter(
    (file) => !specFiles.includes(file),
  );
  if (unknownFiles.length > 0) {
    throw new Error(
      `config/unreleased-operations.yaml names source specs that ${sourceDir} does not have: ${unknownFiles.join(', ')}`,
    );
  }

  await ensureDirectoryExists(outputDir);

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

    const transformedYaml = transformSourceSpec(
      yamlContent,
      specFile,
      commitSha,
      unreleasedOperations,
    );

    fs.writeFileSync(outputFilePath, transformedYaml, 'utf8');

    console.log(`Saved transformed YAML to ${outputFilePath}`);
  }

  console.log('OpenAPI specs transformation completed');
}

export async function transformSourceSpecs() {
  try {
    await writeGeneratedSpecs();
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
          : specFile.includes('platform')
            ? 'platform.yaml'
            : specFile;
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
