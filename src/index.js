import * as core from '@actions/core';
import * as github from '@actions/github';
import { HttpClient } from '@actions/http-client';
import * as fs from 'fs';
import * as path from 'path';
import { transformYaml } from './transformer.js';

// URLs for the OpenAPI specification files
const URLS = [
  'https://api.redoc.ly/registry/assets/glean/Glean%20Client%20API/v1/public/client_rest.yaml?branch=main', // Client API
  'https://api.redoc.ly/registry/assets/glean/Glean%20Indexing%20API/v1/public/indexing.yaml?branch=main' // Indexing API
];

const OUTPUT_FILES = [
  'client_rest.yaml', // Client API
  'indexing.yaml' // Indexing API
];

const OUTPUT_DIR = 'generated';

async function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
    core.info(`Created directory: ${directory}`);
  }
}

async function commitFiles(files, commitMessage = 'Update OpenAPI specs') {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN not found. Make sure to set permissions in workflow file.');
    }

    const octokit = github.getOctokit(token);
    const context = github.context;
    
    // Get the current commit SHA to use as a base
    const { data: refData } = await octokit.rest.git.getRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `heads/${context.ref.split('/').pop()}`
    });
    const currentSha = refData.object.sha;
    
    // Get the current commit to use as parent
    const { data: commitData } = await octokit.rest.git.getCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      commit_sha: currentSha
    });
    
    // Create blobs for each file
    const fileBlobs = await Promise.all(
      files.map(async (file) => {
        const content = fs.readFileSync(file, 'utf8');
        const { data } = await octokit.rest.git.createBlob({
          owner: context.repo.owner,
          repo: context.repo.repo,
          content,
          encoding: 'utf-8'
        });
        
        return {
          path: file,
          mode: '100644', // normal file
          type: 'blob',
          sha: data.sha
        };
      })
    );
    
    // Create a new tree with the files
    const { data: treeData } = await octokit.rest.git.createTree({
      owner: context.repo.owner,
      repo: context.repo.repo,
      base_tree: commitData.tree.sha,
      tree: fileBlobs
    });
    
    // Create a new commit
    const { data: newCommitData } = await octokit.rest.git.createCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      message: commitMessage,
      tree: treeData.sha,
      parents: [currentSha]
    });
    
    // Update the reference
    await octokit.rest.git.updateRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `heads/${context.ref.split('/').pop()}`,
      sha: newCommitData.sha
    });
    
    core.info(`Changes committed with SHA: ${newCommitData.sha}`);
    return true;
  } catch (error) {
    core.error(`Error committing changes: ${error.message}`);
    if (error.stack) core.debug(error.stack);
    return false;
  }
}

export async function downloadYaml(url) {
  try {
    const http = new HttpClient('openapi-preprocessor');
    const response = await http.get(url);
    const body = await response.readBody();
    return body;
  } catch (error) {
    core.setFailed(`Error downloading from ${url}: ${error.message}`);
    throw error;
  }
}

export async function run() {
  try {
    await ensureDirectoryExists(OUTPUT_DIR);
    
    const outputFilePaths = [];
    
    for (let i = 0; i < URLS.length; i++) {
      const url = URLS[i];
      const outputFileName = OUTPUT_FILES[i];
      const outputFilePath = path.join(OUTPUT_DIR, outputFileName);
      outputFilePaths.push(outputFilePath);
      
      core.info(`Processing ${url}`);
      
      const yamlContent = await downloadYaml(url);
      
      const transformedYaml = transformYaml(yamlContent);
      
      fs.writeFileSync(outputFilePath, transformedYaml, 'utf8');
      
      core.info(`Saved transformed YAML to ${outputFilePath}`);
    }
    
    const commitSuccess = await commitFiles(outputFilePaths);
    
    if (commitSuccess) {
      core.info('OpenAPI specs transformation completed and changes were committed');
    } else {
      core.warning('OpenAPI specs transformation completed but changes could not be committed');
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
