import { execa } from 'execa';
import yaml from 'js-yaml';

const REPOS = [
  'gleanwork/api-client-python',
  'gleanwork/api-client-typescript',
  'gleanwork/api-client-go',
  'gleanwork/api-client-java',
];

/**
 * Fetches the latest release for a repository using gh CLI
 * @param {string} repo Repository in format 'owner/name'
 * @returns {Promise<Object|null>} Release object or null if no releases
 */
async function getLatestRelease(repo) {
  try {
    const { stdout } = await execa('gh', [
      'release',
      'view',
      '--repo',
      repo,
      '--json',
      'tagName,url,publishedAt',
    ]);
    return JSON.parse(stdout);
  } catch (error) {
    if (error.stderr?.includes('release not found')) {
      return null;
    }
    throw error;
  }
}

/**
 * Fetches OpenAPI spec file from a branch
 * Tries to find the merged spec in .speakeasy directory
 * @param {string} repo Repository in format 'owner/name'
 * @param {string} ref The branch/tag reference
 * @returns {Promise<Object|null>} Parsed spec with SHAs or null
 */
async function getSpecFromBranch(repo, ref) {
  // The merged spec that contains the SHA information
  const specPath = '.speakeasy/glean-merged-spec.yaml';

  try {
    const { stdout } = await execa('gh', [
      'api',
      `repos/${repo}/contents/${specPath}?ref=${ref}`,
      '--jq',
      '.content',
    ]);

    // Content is base64 encoded
    const content = Buffer.from(stdout.trim(), 'base64').toString('utf8');
    const spec = yaml.load(content);

    if (spec.info) {
      return {
        sourceSha: spec.info['x-source-commit-sha'],
        openApiSha: spec.info['x-open-api-commit-sha'],
        specPath,
      };
    }
  } catch (error) {
    // File doesn't exist at this path
  }

  return null;
}

/**
 * Main function to check all client releases
 */
async function checkClientReleases() {
  console.log('Checking latest releases in API client repositories...\n');

  const results = [];

  for (const repo of REPOS) {
    console.log(`📦 Checking ${repo}...`);

    try {
      const release = await getLatestRelease(repo);

      if (!release) {
        results.push({
          repo,
          error: 'No releases found',
        });
        console.log(`   ❌ No releases found\n`);
        continue;
      }

      console.log(`   Latest release: ${release.tagName}`);
      console.log(
        `   Published: ${new Date(release.publishedAt).toLocaleString()}`,
      );

      const spec = await getSpecFromBranch(repo, release.tagName);

      if (!spec) {
        results.push({
          repo,
          release: release.tagName,
          error: 'Could not find OpenAPI spec with SHAs',
        });
        console.log(`   ⚠️  Could not find OpenAPI spec with SHAs\n`);
        continue;
      }

      console.log(`   x-source-commit-sha: ${spec.sourceSha || 'not found'}`);
      console.log(
        `   x-open-api-commit-sha: ${spec.openApiSha || 'not found'}`,
      );
      console.log(`   (from ${spec.specPath})\n`);

      results.push({
        repo,
        release: release.tagName,
        publishedAt: release.publishedAt,
        url: release.url,
        sourceSha: spec.sourceSha,
        openApiSha: spec.openApiSha,
        specPath: spec.specPath,
      });
    } catch (error) {
      results.push({
        repo,
        error: error.message,
      });
      console.log(`   ❌ Error: ${error.message}\n`);
    }
  }

  // Analyze results
  console.log('━'.repeat(80));
  console.log('\n📊 SUMMARY\n');

  const validResults = results.filter(
    (r) => !r.error && r.sourceSha && r.openApiSha,
  );

  if (validResults.length === 0) {
    console.log('❌ No valid releases found with SHA tracking.');
    console.log('\nErrors:');
    results.forEach((r) => {
      if (r.error) {
        console.log(`  - ${r.repo}: ${r.error}`);
      }
    });
    process.exit(1);
  }

  if (validResults.length < REPOS.length) {
    console.log('⚠️  Not all repositories have valid releases:\n');
    results.forEach((r) => {
      if (r.error) {
        console.log(`  ❌ ${r.repo}: ${r.error}`);
      } else if (!r.sourceSha || !r.openApiSha) {
        console.log(`  ⚠️  ${r.repo}: Missing SHA information`);
      } else {
        console.log(`  ✅ ${r.repo}: ${r.release}`);
      }
    });
    console.log('');
    process.exit(1);
  }

  // Check if all SHAs match
  const firstResult = validResults[0];
  const allSourceShasMatch = validResults.every(
    (r) => r.sourceSha === firstResult.sourceSha,
  );
  const allOpenApiShasMatch = validResults.every(
    (r) => r.openApiSha === firstResult.openApiSha,
  );

  if (allSourceShasMatch && allOpenApiShasMatch) {
    console.log('✅ All API client releases have matching SHAs!\n');
    console.log(`   x-source-commit-sha:    ${firstResult.sourceSha}`);
    console.log(`   x-open-api-commit-sha:  ${firstResult.openApiSha}\n`);
    console.log('Releases:');
    validResults.forEach((r) => {
      console.log(`  - ${r.repo}: ${r.release}`);
    });
    console.log('\n🎉 Ready to trigger generate-code-samples.yml workflow!');
    process.exit(0);
  } else {
    console.log('❌ SHA mismatch detected across releases:\n');

    // Group by SHA combinations
    console.log('x-source-commit-sha:');
    const sourceShaGroups = {};
    validResults.forEach((r) => {
      if (!sourceShaGroups[r.sourceSha]) {
        sourceShaGroups[r.sourceSha] = [];
      }
      sourceShaGroups[r.sourceSha].push(r.repo);
    });
    Object.entries(sourceShaGroups).forEach(([sha, repos]) => {
      console.log(`  ${sha}:`);
      repos.forEach((repo) => console.log(`    - ${repo}`));
    });

    console.log('\nx-open-api-commit-sha:');
    const openApiShaGroups = {};
    validResults.forEach((r) => {
      if (!openApiShaGroups[r.openApiSha]) {
        openApiShaGroups[r.openApiSha] = [];
      }
      openApiShaGroups[r.openApiSha].push(r.repo);
    });
    Object.entries(openApiShaGroups).forEach(([sha, repos]) => {
      console.log(`  ${sha}:`);
      repos.forEach((repo) => console.log(`    - ${repo}`));
    });

    console.log('\n⏳ Waiting for all releases to sync to the same SHAs.');
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  checkClientReleases().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { checkClientReleases, getLatestRelease, getSpecFromBranch };
