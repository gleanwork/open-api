import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import {
  getLatestRelease,
  getSpecFromBranch,
} from '../src/check-client-releases.js';

vi.mock('execa');

describe('check-client-releases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getLatestRelease', () => {
    test('returns release object when release exists', async () => {
      const mockRelease = {
        tagName: 'v1.0.0',
        url: 'https://github.com/org/repo/releases/tag/v1.0.0',
        publishedAt: '2025-11-14T12:00:00Z',
      };

      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify(mockRelease),
        stderr: '',
      });

      const result = await getLatestRelease('org/repo');

      expect(execa).toHaveBeenCalledWith('gh', [
        'release',
        'view',
        '--repo',
        'org/repo',
        '--json',
        'tagName,url,publishedAt',
      ]);
      expect(result).toEqual(mockRelease);
    });

    test('returns null when no release found', async () => {
      vi.mocked(execa).mockRejectedValue({
        stderr: 'release not found',
      });

      const result = await getLatestRelease('org/repo');

      expect(result).toBeNull();
    });

    test('throws error on other failures', async () => {
      vi.mocked(execa).mockRejectedValue({
        stderr: 'Some other error',
        message: 'Command failed',
      });

      await expect(getLatestRelease('org/repo')).rejects.toThrow();
    });
  });

  describe('getSpecFromBranch', () => {
    test('extracts SHAs from spec successfully', async () => {
      const mockSpecYaml = `
openapi: 3.0.0
info:
  version: 1.0.0
  title: Test API
  x-source-commit-sha: abc123source
  x-open-api-commit-sha: def456openapi
  description: Test description
`;

      // Base64 encode the mock spec
      const base64Content = Buffer.from(mockSpecYaml).toString('base64');

      vi.mocked(execa).mockResolvedValue({
        stdout: base64Content,
        stderr: '',
      });

      const result = await getSpecFromBranch('org/repo', 'v1.0.0');

      expect(execa).toHaveBeenCalledWith('gh', [
        'api',
        'repos/org/repo/contents/.speakeasy/glean-merged-spec.yaml?ref=v1.0.0',
        '--jq',
        '.content',
      ]);
      expect(result).toEqual({
        sourceSha: 'abc123source',
        openApiSha: 'def456openapi',
        specPath: '.speakeasy/glean-merged-spec.yaml',
      });
    });

    test('returns null when spec file not found', async () => {
      vi.mocked(execa).mockRejectedValue({
        stderr: 'Not Found (HTTP 404)',
      });

      const result = await getSpecFromBranch('org/repo', 'v1.0.0');

      expect(result).toBeNull();
    });

    test('handles spec with only x-source-commit-sha', async () => {
      const mockSpecYaml = `
openapi: 3.0.0
info:
  version: 1.0.0
  title: Test API
  x-source-commit-sha: abc123source
  description: Test description
`;

      const base64Content = Buffer.from(mockSpecYaml).toString('base64');

      vi.mocked(execa).mockResolvedValue({
        stdout: base64Content,
        stderr: '',
      });

      const result = await getSpecFromBranch('org/repo', 'v1.0.0');

      expect(result).toEqual({
        sourceSha: 'abc123source',
        openApiSha: undefined,
        specPath: '.speakeasy/glean-merged-spec.yaml',
      });
    });

    test('handles spec with neither SHA field', async () => {
      const mockSpecYaml = `
openapi: 3.0.0
info:
  version: 1.0.0
  title: Test API
  description: Test description
`;

      const base64Content = Buffer.from(mockSpecYaml).toString('base64');

      vi.mocked(execa).mockResolvedValue({
        stdout: base64Content,
        stderr: '',
      });

      const result = await getSpecFromBranch('org/repo', 'v1.0.0');

      expect(result).toEqual({
        sourceSha: undefined,
        openApiSha: undefined,
        specPath: '.speakeasy/glean-merged-spec.yaml',
      });
    });

    test('handles malformed base64 content gracefully', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: 'not-valid-base64!!!',
        stderr: '',
      });

      const result = await getSpecFromBranch('org/repo', 'v1.0.0');

      // Should return null because YAML parsing will fail
      expect(result).toBeNull();
    });
  });

  describe('SHA comparison logic', () => {
    test('identifies matching SHAs across repos', () => {
      const results = [
        { repo: 'repo1', sourceSha: 'abc123', openApiSha: 'def456' },
        { repo: 'repo2', sourceSha: 'abc123', openApiSha: 'def456' },
        { repo: 'repo3', sourceSha: 'abc123', openApiSha: 'def456' },
      ];

      const firstResult = results[0];
      const allSourceShasMatch = results.every(
        (r) => r.sourceSha === firstResult.sourceSha,
      );
      const allOpenApiShasMatch = results.every(
        (r) => r.openApiSha === firstResult.openApiSha,
      );

      expect(allSourceShasMatch).toBe(true);
      expect(allOpenApiShasMatch).toBe(true);
    });

    test('identifies mismatched SHAs across repos', () => {
      const results = [
        { repo: 'repo1', sourceSha: 'abc123', openApiSha: 'def456' },
        { repo: 'repo2', sourceSha: 'xyz789', openApiSha: 'def456' },
        { repo: 'repo3', sourceSha: 'abc123', openApiSha: 'uvw999' },
      ];

      const firstResult = results[0];
      const allSourceShasMatch = results.every(
        (r) => r.sourceSha === firstResult.sourceSha,
      );
      const allOpenApiShasMatch = results.every(
        (r) => r.openApiSha === firstResult.openApiSha,
      );

      expect(allSourceShasMatch).toBe(false);
      expect(allOpenApiShasMatch).toBe(false);
    });

    test('groups repos by SHA correctly', () => {
      const results = [
        { repo: 'repo1', sourceSha: 'abc123', openApiSha: 'def456' },
        { repo: 'repo2', sourceSha: 'abc123', openApiSha: 'def456' },
        { repo: 'repo3', sourceSha: 'xyz789', openApiSha: 'def456' },
      ];

      const sourceShaGroups = {};
      results.forEach((r) => {
        if (!sourceShaGroups[r.sourceSha]) {
          sourceShaGroups[r.sourceSha] = [];
        }
        sourceShaGroups[r.sourceSha].push(r.repo);
      });

      expect(sourceShaGroups).toEqual({
        abc123: ['repo1', 'repo2'],
        xyz789: ['repo3'],
      });
    });
  });
});
