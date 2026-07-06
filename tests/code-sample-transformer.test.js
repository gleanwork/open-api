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

  describe('addServerURLToCodeSamples', () => {
    test('updates chat code sample to use namespace', () => {
      const spec = yaml.load(fixtureContent);

      const updatedSpec = codeSampleTransformer.addServerURLToCodeSamples(spec);
      const chatSpec = updatedSpec.paths['/rest/api/v1/chat'];

      expect(codeSampleTransformer.extractCodeSnippet(chatSpec, 'python'))
        .toMatchInlineSnapshot(`
        {
          "label": "Python (API Client)",
          "lang": "python",
          "source": "from glean import Glean, models
        import os


        with Glean(
            api_token=os.getenv("GLEAN_API_TOKEN", ""),
            server_url="https://mycompany-be.glean.com",
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
      expect(codeSampleTransformer.extractCodeSnippet(chatSpec, 'typescript'))
        .toMatchInlineSnapshot(`
        {
          "label": "Typescript (API Client)",
          "lang": "typescript",
          "source": "import { Glean } from "@gleanwork/api-client";

        const glean = new Glean({
          apiToken: process.env["GLEAN_API_TOKEN"] ?? "",
          serverURL: "https://mycompany-be.glean.com",
        });

        async function run() {
          const result = await glean.client.chat.create({
            messages: [
              {
                fragments: [
                  {
                    text: "What are the company holidays this year?",
                  },
                ],
              },
            ],
          });

          // Handle the result
          console.log(result);
        }

        run();",
        }
      `);
      expect(codeSampleTransformer.extractCodeSnippet(chatSpec, 'go'))
        .toMatchInlineSnapshot(`
        {
          "label": "Go (API Client)",
          "lang": "go",
          "source": "package main

        import(
        	"context"
        	"os"
        	apiclientgo "github.com/gleanwork/api-client-go"
        	"github.com/gleanwork/api-client-go/models/components"
        	"log"
        )

        func main() {
            ctx := context.Background()

            s := apiclientgo.New(
                apiclientgo.WithSecurity(os.Getenv("GLEAN_API_TOKEN")),
                apiclientgo.WithServerURL("https://mycompany-be.glean.com"),
            )

            res, err := s.Client.Chat.Create(ctx, components.ChatRequest{
                Messages: []components.ChatMessage{
                    components.ChatMessage{
                        Fragments: []components.ChatMessageFragment{
                            components.ChatMessageFragment{
                                Text: apiclientgo.String("What are the company holidays this year?"),
                            },
                        },
                    },
                },
            }, nil)
            if err != nil {
                log.Fatal(err)
            }
            if res.ChatResponse != nil {
                // handle response
            }
        }",
        }
      `);
      expect(codeSampleTransformer.extractCodeSnippet(chatSpec, 'java'))
        .toMatchInlineSnapshot(`
        {
          "label": "Java (API Client)",
          "lang": "java",
          "source": "package hello.world;

        import com.glean.api_client.glean_api_client.Glean;
        import com.glean.api_client.glean_api_client.models.components.*;
        import com.glean.api_client.glean_api_client.models.operations.ChatResponse;
        import java.lang.Exception;
        import java.util.List;

        public class Application {

            public static void main(String[] args) throws Exception {

                Glean sdk = Glean.builder()
                        .apiToken("<YOUR_BEARER_TOKEN_HERE>")
                        .serverURL("https://mycompany-be.glean.com")
                    .build();

                ChatResponse res = sdk.client().chat().create()
                        .chatRequest(ChatRequest.builder()
                            .messages(List.of(
                                ChatMessage.builder()
                                    .fragments(List.of(
                                        ChatMessageFragment.builder()
                                            .text("What are the company holidays this year?")
                                            .build()))
                                    .build()))
                            .build())
                        .call();

                if (res.chatResponse().isPresent()) {
                    // handle response
                }
            }
        }",
        }
      `);
    });
  });

  describe('experimentalCodeSnippets', () => {
    test('yields samples only for operations marked x-glean-experimental', () => {
      const spec = yaml.load(
        readFixture('example-with-experimental-code-samples.yaml'),
      );

      const experimentalLangs = [];
      for (const [, pathSpec] of codeSampleTransformer.path(spec)) {
        for (const [lang] of codeSampleTransformer.experimentalCodeSnippets(
          pathSpec,
        )) {
          experimentalLangs.push(lang);
        }
      }

      // Only the /api/agents/search (experimental) samples should be yielded,
      // not the /api/agents/stable ones.
      expect(experimentalLangs).toMatchInlineSnapshot(`
        [
          "python",
          "typescript",
          "go",
          "java",
        ]
      `);
    });
  });

  describe('addIncludeExperimentalToCodeSamples', () => {
    let spec;

    beforeEach(() => {
      spec = yaml.load(
        readFixture('example-with-experimental-code-samples.yaml'),
      );
      // Mirror the production order: server URL is injected first, then the
      // experimental flag is anchored onto it.
      codeSampleTransformer.addServerURLToCodeSamples(spec);
      codeSampleTransformer.addIncludeExperimentalToCodeSamples(spec);
    });

    test('adds include_experimental to the experimental Python sample', () => {
      const experimentalSpec = spec.paths['/api/agents/search'];

      expect(
        codeSampleTransformer.extractCodeSnippet(experimentalSpec, 'python')
          .source,
      ).toMatchInlineSnapshot(`
        "from glean.api_client import Glean
        import os


        with Glean(
            api_token=os.getenv("GLEAN_API_TOKEN", ""),
            server_url="https://mycompany-be.glean.com",
            include_experimental=True,
        ) as glean:

            res = glean.agents.search(name="HR Policy Agent")

            # Handle response
            print(res)"
      `);
    });

    test('adds includeExperimental to the experimental TypeScript sample', () => {
      const experimentalSpec = spec.paths['/api/agents/search'];

      expect(
        codeSampleTransformer.extractCodeSnippet(experimentalSpec, 'typescript')
          .source,
      ).toMatchInlineSnapshot(`
        "import { Glean } from "@gleanwork/api-client";

        const glean = new Glean({
          apiToken: process.env["GLEAN_API_TOKEN"] ?? "",
          serverURL: "https://mycompany-be.glean.com",
          includeExperimental: true,
        });

        async function run() {
          const result = await glean.agents.search({
            name: "HR Policy Agent",
          });

          console.log(result);
        }

        run();"
      `);
    });

    test('adds WithIncludeExperimental to the experimental Go sample', () => {
      const experimentalSpec = spec.paths['/api/agents/search'];

      expect(
        codeSampleTransformer.extractCodeSnippet(experimentalSpec, 'go').source,
      ).toContain('apiclientgo.WithIncludeExperimental(true),');
    });

    test('swaps to GleanBuilder and adds includeExperimental in the experimental Java sample', () => {
      const experimentalSpec = spec.paths['/api/agents/search'];

      expect(
        codeSampleTransformer.extractCodeSnippet(experimentalSpec, 'java')
          .source,
      ).toMatchInlineSnapshot(`
        "package hello.world;

        import com.glean.api_client.glean_api_client.Glean;
        import com.glean.api_client.glean_api_client.hooks.GleanBuilder;
        import com.glean.api_client.glean_api_client.models.components.PlatformAgentsSearchRequest;
        import com.glean.api_client.glean_api_client.models.operations.PlatformAgentsSearchResponse;
        import java.lang.Exception;

        public class Application {

            public static void main(String[] args) throws Exception {

                Glean sdk = GleanBuilder.create()
                        .apiToken(System.getenv().getOrDefault("GLEAN_API_TOKEN", ""))
                        .includeExperimental(true)
                    .build();

                PlatformAgentsSearchResponse res = sdk.agents().search()
                        .request(PlatformAgentsSearchRequest.builder()
                            .name("HR Policy Agent")
                            .build())
                        .call();

                if (res.platformAgentsSearchResponse().isPresent()) {
                    System.out.println(res.platformAgentsSearchResponse().get());
                }
            }
        }"
      `);
    });

    test('does not modify non-experimental samples', () => {
      const stableSpec = spec.paths['/api/agents/stable'];

      const python = codeSampleTransformer.extractCodeSnippet(
        stableSpec,
        'python',
      ).source;
      const java = codeSampleTransformer.extractCodeSnippet(
        stableSpec,
        'java',
      ).source;

      expect(python).not.toContain('include_experimental');
      expect(java).not.toContain('includeExperimental');
      expect(java).not.toContain('GleanBuilder');
      expect(java).toContain('Glean.builder()');
    });
  });
});
