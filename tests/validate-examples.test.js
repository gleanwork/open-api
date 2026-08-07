import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  transform,
  transformInvalidExamples,
  transformCursorExamples,
} from '../src/source-spec-transformer.js';
import {
  findInvalidExamples,
  formatViolations,
} from '../src/validate-examples.js';

const SOURCE_DIR = 'source_specs';

describe('example validity', () => {
  const specFiles = fs
    .readdirSync(SOURCE_DIR)
    .filter((file) => file.endsWith('.yaml'));

  it('finds the source spec files to check', () => {
    expect(specFiles.length).toBeGreaterThan(0);
  });

  // Asserted on the transform's *output* rather than the committed source, because
  // source_specs is overwritten by an automated sync many times a day: pinning the
  // guarantee to the pipeline's result is what downstream consumers actually get.
  it.each(specFiles)(
    '%s produces no schema-contradicting examples after transform',
    (file) => {
      const content = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8');
      const spec = yaml.load(transform(content, file));
      const violations = findInvalidExamples(spec);

      expect(
        violations,
        violations.length
          ? `${file} has ${violations.length} example(s) that contradict their schema. ` +
              `Anything that builds a request body from this spec will send an invalid value:\n${formatViolations(violations)}`
          : undefined,
      ).toEqual([]);
    },
  );
});

describe('findInvalidExamples', () => {
  it('flags a scalar schema given an array example', () => {
    const spec = {
      components: { schemas: { S: { type: 'string', example: ['a'] } } },
    };
    expect(findInvalidExamples(spec)).toMatchObject([
      { problem: 'schema is type string but example is array' },
    ]);
  });

  it('flags an object-valued map given a bare string', () => {
    const spec = {
      components: {
        schemas: {
          Wrapper: {
            type: 'object',
            additionalProperties: { $ref: '#/components/schemas/Value' },
            example: { field: 'oops' },
          },
          Value: { properties: { stringValue: { type: 'string' } } },
        },
      },
    };
    expect(findInvalidExamples(spec)).toMatchObject([
      { problem: 'schema is type object but example is string' },
    ]);
  });

  it('checks examples on allOf-composed schemas', () => {
    const spec = {
      components: {
        schemas: {
          Base: { type: 'object', properties: { count: { type: 'integer' } } },
          Composed: {
            allOf: [{ $ref: '#/components/schemas/Base' }],
            example: { count: 'not-a-number' },
          },
        },
      },
    };
    expect(findInvalidExamples(spec)).toMatchObject([
      { problem: 'schema is type integer but example is string' },
    ]);
  });

  it('stays silent on oneOf, where the intended branch is unknowable', () => {
    const spec = {
      components: {
        schemas: {
          S: {
            oneOf: [{ type: 'string' }, { type: 'number' }],
            example: ['neither'],
          },
        },
      },
    };
    expect(findInvalidExamples(spec)).toEqual([]);
  });

  it('accepts a valid example', () => {
    const spec = {
      components: {
        schemas: {
          S: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            example: { name: 'ok', tags: ['a', 'b'] },
          },
        },
      },
    };
    expect(findInvalidExamples(spec)).toEqual([]);
  });

  it('flags a value outside an enum', () => {
    const spec = {
      components: {
        schemas: {
          S: { type: 'string', enum: ['A', 'B'], example: 'C' },
        },
      },
    };
    expect(findInvalidExamples(spec)).toMatchObject([
      { problem: `value "C" is not one of the schema's enum values` },
    ]);
  });
});

describe('transformCursorExamples', () => {
  it('gives a cursor property an empty-string example', () => {
    const spec = {
      components: {
        schemas: {
          Request: { properties: { cursor: { type: 'string' } } },
        },
      },
    };
    transformCursorExamples(spec);
    expect(spec.components.schemas.Request.properties.cursor.example).toBe('');
  });

  it('reaches cursors nested below the top level', () => {
    const spec = {
      components: {
        schemas: {
          Outer: {
            properties: {
              inner: { properties: { cursor: { type: 'string' } } },
            },
          },
        },
      },
    };
    transformCursorExamples(spec);
    expect(
      spec.components.schemas.Outer.properties.inner.properties.cursor.example,
    ).toBe('');
  });

  it('does not overwrite an example the spec already supplies', () => {
    const spec = {
      components: {
        schemas: {
          Request: {
            properties: { cursor: { type: 'string', example: 'abc123' } },
          },
        },
      },
    };
    transformCursorExamples(spec);
    expect(spec.components.schemas.Request.properties.cursor.example).toBe(
      'abc123',
    );
  });

  it('leaves a non-string cursor alone', () => {
    const spec = {
      components: {
        schemas: { Request: { properties: { cursor: { type: 'object' } } } },
      },
    };
    transformCursorExamples(spec);
    expect(
      spec.components.schemas.Request.properties.cursor.example,
    ).toBeUndefined();
  });

  it('gives every cursor in the real client spec an example', () => {
    const content = fs.readFileSync(
      path.join(SOURCE_DIR, 'client_rest.yaml'),
      'utf8',
    );
    const spec = yaml.load(transform(content, 'client_rest.yaml'));
    const missing = [];
    const visit = (node, p, seen) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      const cursor = node.properties?.cursor;
      if (cursor?.type === 'string' && cursor.example === undefined) {
        missing.push(`${p}.properties.cursor`);
      }
      for (const [k, v] of Object.entries(node)) visit(v, `${p}.${k}`, seen);
    };
    visit(spec, '$', new WeakSet());
    expect(missing).toEqual([]);
  });
});

describe('transformInvalidExamples', () => {
  it('wraps bare facet filter values as FacetFilterValue objects', () => {
    const spec = {
      components: {
        schemas: {
          Options: {
            example: {
              facetFilters: [{ fieldName: 'type', values: ['Spreadsheet'] }],
            },
          },
        },
      },
    };
    transformInvalidExamples(spec);
    expect(
      spec.components.schemas.Options.example.facetFilters[0].values,
    ).toEqual([{ value: 'Spreadsheet', relationType: 'EQUALS' }]);
  });

  it('repairs rewrittenFacetFilters on response examples too', () => {
    const spec = {
      components: {
        schemas: {
          Response: {
            example: {
              rewrittenFacetFilters: [{ fieldName: 'type', values: ['Email'] }],
            },
          },
        },
      },
    };
    transformInvalidExamples(spec);
    expect(
      spec.components.schemas.Response.example.rewrittenFacetFilters[0].values,
    ).toEqual([{ value: 'Email', relationType: 'EQUALS' }]);
  });

  it('collapses a listed status to the single string the schema declares', () => {
    const spec = {
      components: {
        schemas: { DocumentMetadata: { example: { status: ['Done'] } } },
      },
    };
    transformInvalidExamples(spec);
    expect(spec.components.schemas.DocumentMetadata.example.status).toBe(
      'Done',
    );
  });

  it('wraps customData strings as CustomDataValue objects', () => {
    const spec = {
      components: {
        schemas: {
          DocumentMetadata: {
            example: { customData: { someCustomField: 'someCustomValue' } },
          },
        },
      },
    };
    transformInvalidExamples(spec);
    expect(spec.components.schemas.DocumentMetadata.example.customData).toEqual(
      {
        someCustomField: { stringValue: 'someCustomValue' },
      },
    );
  });

  it('stringifies a numeric phone example', () => {
    const spec = {
      components: {
        schemas: { PersonMetadata: { example: { phone: 6505551234 } } },
      },
    };
    transformInvalidExamples(spec);
    expect(spec.components.schemas.PersonMetadata.example.phone).toBe(
      '6505551234',
    );
  });

  it('reduces a list of candidate objectNames to one', () => {
    const spec = {
      components: {
        schemas: {
          objectName: { type: 'string', example: ['HR ticket', 'Email'] },
        },
      },
    };
    transformInvalidExamples(spec);
    expect(spec.components.schemas.objectName.example).toBe('HR ticket');
  });

  it('wraps a bare suggestion array in its QuerySuggestionList', () => {
    const spec = {
      components: {
        schemas: {
          SearchResult: {
            example: { mustIncludeSuggestions: [{ missingTerm: 'container' }] },
          },
        },
      },
    };
    transformInvalidExamples(spec);
    expect(
      spec.components.schemas.SearchResult.example.mustIncludeSuggestions,
    ).toEqual({ suggestions: [{ missingTerm: 'container' }] });
  });

  // The point of the guards: when the upstream spec is corrected at source, this
  // pass must leave the now-valid examples alone rather than mangling them.
  it('leaves already-valid examples untouched', () => {
    const valid = {
      components: {
        schemas: {
          DocumentMetadata: {
            example: {
              status: 'Done',
              customData: {
                someCustomField: { stringValue: 'someCustomValue' },
              },
            },
          },
          PersonMetadata: { example: { phone: '6505551234' } },
          objectName: { type: 'string', example: 'HR ticket' },
          Options: {
            example: {
              facetFilters: [
                {
                  fieldName: 'type',
                  values: [{ value: 'Spreadsheet', relationType: 'EQUALS' }],
                },
              ],
            },
          },
          SearchResult: {
            example: {
              mustIncludeSuggestions: {
                suggestions: [{ missingTerm: 'container' }],
              },
            },
          },
        },
      },
    };
    const before = JSON.parse(JSON.stringify(valid));
    transformInvalidExamples(valid);
    expect(valid).toEqual(before);
  });
});
