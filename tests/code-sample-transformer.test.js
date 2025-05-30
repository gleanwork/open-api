import { beforeEach, describe, test, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import yaml from 'js-yaml';
import * as codeSampleTransformer from '../src/code-sample-transformer.js';

function readFixture(filename) {
  const sourceFile = path.join(process.cwd(), 'tests', 'fixtures', filename);
  return fs.readFileSync(sourceFile, 'utf8');
}

describe('Code Sample Transformer', () => {
  let fixtureContent, fixtureFilename;

  beforeEach(() => {
    fixtureFilename = 'example-with-code-samples.yaml';
    fixtureContent = readFixture(fixtureFilename);
  });

  describe('path', () => {
    test('yields each path found in the spec', async () => {
      const spec = yaml.load(`
openapi: 3.0.0
paths:
  /foo:
    post:
  /baz:
    get:
    `);

      const items = [];
      for (let [path, pathSpec] of codeSampleTransformer.path(spec)) {
        items.push({ path, pathSpec });
      }

      expect(items).toMatchInlineSnapshot(`
        [
          {
            "path": "/foo",
            "pathSpec": {
              "post": null,
            },
          },
          {
            "path": "/baz",
            "pathSpec": {
              "get": null,
            },
          },
        ]
      `);
    });
  });

  describe('extractCodeSnippet', () => {
    test('returns code snippet for specified language', () => {
      const pathSpec = yaml.load(`
    post:
      x-speakeasy-group: client.chat
      x-speakeasy-name-override: create
      x-speakeasy-usage-example: true
      x-codeSamples:
        - lang: python
          label: Python (API Client)
          source: |-
            print("huzzah!")
        - lang: typescript
          label: Typescript (API Client)
          source: |-
            console.log("huzzah!")
      `);

      expect(
        codeSampleTransformer.extractCodeSnippet(pathSpec, 'python'),
      ).toMatchInlineSnapshot(
        `
        {
          "label": "Python (API Client)",
          "lang": "python",
          "source": "print("huzzah!")",
        }
      `,
      );
      expect(
        codeSampleTransformer.extractCodeSnippet(pathSpec, 'typescript'),
      ).toMatchInlineSnapshot(
        `
        {
          "label": "Typescript (API Client)",
          "lang": "typescript",
          "source": "console.log("huzzah!")",
        }
      `,
      );
    });
  });

  describe('transformPythonCodeSnippetsForNamespacing', () => {
    test('updates chat code sample to use namespace', () => {
      const spec = yaml.load(fixtureContent);

      const updatedSpec =
        codeSampleTransformer.transformPythonCodeSamplesToPython(spec);
      const chatSpec = updatedSpec.paths['/rest/api/v1/chat'];

      expect(codeSampleTransformer.extractCodeSnippet(chatSpec, 'python'))
        .toMatchInlineSnapshot(`
        {
          "label": "Python (API Client)",
          "lang": "python",
          "source": "from glean.api_client import Glean, models
        import os


        with Glean(
            api_token=os.getenv("GLEAN_API_TOKEN", ""),
        ) as g_client:

            res = g_client.client.chat.create(messages=[
                {
                    "fragments": [
                        models.ChatMessageFragment(
                            text="What are the company holidays this year?",
                        ),
                    ],
                },
            ], timeout_millis=30000)

            # Handle response
            print(res)",
        }
      `);
    });
  });
});
