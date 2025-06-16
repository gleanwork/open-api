#!/usr/bin/env node

import { mkdtemp, writeFile, mkdir } from 'fs/promises';
import { execa } from 'execa';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { parseArgs } from 'util';

const USAGE = `
📊 OpenAPI Changes Report Generator

Usage: node download-and-openapi-changes.js [options]

Options:
  --open        Open the HTML report after generation
  --report-file Custom location for the report (default: temp directory)
  --help, -h    Show this help message

Examples:
  node download-and-openapi-changes.js
  node download-and-openapi-changes.js --open
  node download-and-openapi-changes.js --report-file ./reports

This script downloads the remote OpenAPI spec and compares it with your local
source_specs/client_rest.yaml file, generating an HTML diff report.
`;

function showUsage() {
  console.log(USAGE);
}

async function downloadAndDiff(options = {}) {
  const remoteUrl =
    'https://gleanwork.github.io/open-api/specs/source/client_rest.yaml';
  const localFile = 'source_specs/client_rest.yaml';

  try {
    const tempDir = await mkdtemp(join(tmpdir(), 'changes-report-'));
    const reportFile =
      options.reportFile || join(tempDir, 'changes-report.hml');
    const outputDir = dirname(reportFile);
    await mkdir(outputDir, { recursive: true });
    await mkdir(tempDir, { recursive: true });

    console.log('📥 Downloading remote file...');
    const response = await fetch(remoteUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to download: ${response.status} ${response.statusText}`,
      );
    }

    const content = await response.text();
    const tempFile = join(tempDir, 'client_rest.yaml');

    await writeFile(tempFile, content);
    console.log(`✅ Downloaded to: ${tempFile}`);

    console.log('🚀 Running openapi-changes html-report...');
    await execa(
      'openapi-changes',
      [
        'html-report',
        '--no-logo',
        tempFile,
        localFile,
        '--report-file',
        reportFile,
      ],
      { stdio: 'inherit' },
    );

    console.log(`\n✨ Process finished successfully`);
    console.log(`📄 Report written to: ${reportFile}`);

    if (options.open) {
      try {
        console.log('🌐 Opening report...');
        await execa('open', [reportFile]);
      } catch (error) {
        console.log(`ℹ️  Could not auto-open report: ${error.message}`);
        console.log(`   You can manually open: ${reportFile}`);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

try {
  const { values } = parseArgs({
    options: {
      open: {
        type: 'boolean',
        short: 'o',
      },
      'report-file': {
        type: 'string',
      },
      help: {
        type: 'boolean',
        short: 'h',
      },
    },
    allowPositionals: false,
  });

  if (values.help) {
    showUsage();
    process.exit(0);
  }

  downloadAndDiff({
    open: values.open,
    reportFile: values['report-file'],
  });
} catch (error) {
  console.error(`❌ ${error.message}\n`);
  showUsage();
  process.exit(1);
}
