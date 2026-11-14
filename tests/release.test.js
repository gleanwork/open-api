import { beforeEach, describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import {
  getDeprecation,
  getEnumValueDeprecations,
  requiresOptIn,
} from '../src/release.js';
import { transformGleanDeprecated } from '../src/source-spec-transformer.js';
import {
  addIncludeExperimentalToCodeSamples,
  addServerURLToCodeSamples,
} from '../src/code-sample-transformer.js';

function loadFixture() {
  return yaml.load(
    fs.readFileSync(
      path.join(process.cwd(), 'tests', 'fixtures', 'release-stages.yaml'),
      'utf8',
    ),
  );
}

describe('release readers', () => {
  test('requiresOptIn is true for beta and unreleased, and for x-glean-experimental', () => {
    expect(requiresOptIn({ 'x-glean-release': { stage: 'beta' } })).toBe(true);
    expect(requiresOptIn({ 'x-glean-release': { stage: 'unreleased' } })).toBe(
      true,
    );
    expect(requiresOptIn({ 'x-glean-release': { stage: 'ga' } })).toBe(false);
    expect(
      requiresOptIn({
        'x-glean-release': {
          stage: 'deprecated',
          deprecation: { message: 'x' },
        },
      }),
    ).toBe(false);
    expect(requiresOptIn({ 'x-glean-experimental': { id: 'x' } })).toBe(true);
    expect(requiresOptIn({})).toBe(false);
  });

  test('x-glean-release wins over the old annotations', () => {
    const node = {
      'x-glean-release': { stage: 'ga' },
      'x-glean-experimental': { id: 'x' },
      'x-glean-deprecated': { message: 'old', removal: '2026-01-01' },
    };

    expect(requiresOptIn(node)).toBe(false);
    expect(getDeprecation(node)).toBeNull();
  });

  test('getDeprecation fills in the stage-level docs', () => {
    expect(
      getDeprecation({
        'x-glean-release': {
          stage: 'deprecated',
          docs: 'https://example.com/stage',
          deprecation: { message: 'm', removal: '2027-01-01' },
        },
      }),
    ).toEqual({
      message: 'm',
      removal: '2027-01-01',
      docs: 'https://example.com/stage',
    });

    expect(
      getDeprecation({
        'x-glean-release': {
          stage: 'deprecated',
          docs: 'https://example.com/stage',
          deprecation: { message: 'm', docs: 'https://example.com/own' },
        },
      }).docs,
    ).toBe('https://example.com/own');
  });

  test('getDeprecation ignores deprecation details on other stages', () => {
    expect(
      getDeprecation({
        'x-glean-release': { stage: 'beta', deprecation: { message: 'm' } },
      }),
    ).toBeNull();
  });

  test('the list form sets no stage on the node itself', () => {
    const node = {
      enum: ['A', 'B'],
      'x-glean-release': [
        {
          stage: 'deprecated',
          'enum-value': 'B',
          deprecation: { message: 'm' },
        },
      ],
    };

    expect(getDeprecation(node)).toBeNull();
    expect(requiresOptIn(node)).toBe(false);
    expect(getEnumValueDeprecations(node)).toEqual([
      { enumValue: 'B', deprecation: { message: 'm' } },
    ]);
  });

  test('getEnumValueDeprecations skips list items that are not deprecated', () => {
    expect(
      getEnumValueDeprecations({
        enum: ['A', 'B'],
        'x-glean-release': [
          { stage: 'beta', 'enum-value': 'A' },
          { stage: 'deprecated', 'enum-value': 'B' },
          'bad',
          null,
        ],
      }),
    ).toEqual([]);
  });
});

describe('release-stages fixture', () => {
  let spec;

  beforeEach(() => {
    spec = loadFixture();
  });

  test('transformGleanDeprecated marks each stage the right way', () => {
    transformGleanDeprecated(spec);

    const op = (p) => spec.paths[p].post;
    const summary = (node) => ({
      deprecated: node.deprecated,
      message: node['x-speakeasy-deprecation-message'],
    });
    const fields = spec.components.schemas.Fields.properties;

    expect({
      beta: summary(op('/stage/beta')),
      ga: summary(op('/stage/ga')),
      deprecated: summary(op('/stage/deprecated')),
      deprecatedParam: summary(op('/stage/deprecated').parameters[0]),
      legacyExperimental: summary(op('/legacy/experimental')),
      legacyDeprecated: summary(op('/legacy/deprecated')),
      precedence: summary(op('/precedence')),
      releaseDeprecated: summary(fields.releaseDeprecated),
      legacyDeprecatedField: summary(fields.legacyDeprecated),
      betaField: summary(fields.betaField),
      releaseEnum: fields.releaseEnum['x-speakeasy-enum-descriptions'],
      legacyEnum: fields.legacyEnum['x-speakeasy-enum-descriptions'],
      overriddenEnum: fields.overriddenEnum['x-speakeasy-enum-descriptions'],
    }).toMatchInlineSnapshot(`
      {
        "beta": {
          "deprecated": undefined,
          "message": undefined,
        },
        "betaField": {
          "deprecated": undefined,
          "message": undefined,
        },
        "deprecated": {
          "deprecated": true,
          "message": "Deprecated on 2026-10-01, removal scheduled for 2027-04-15: Use POST /stage/ga instead",
        },
        "deprecatedParam": {
          "deprecated": true,
          "message": "Deprecated on 2026-10-02, removal scheduled for 2027-04-16: Use newParam instead",
        },
        "ga": {
          "deprecated": undefined,
          "message": undefined,
        },
        "legacyDeprecated": {
          "deprecated": true,
          "message": "Deprecated on 2026-02-01, removal scheduled for 2026-10-15: Use POST /stage/ga instead",
        },
        "legacyDeprecatedField": {
          "deprecated": true,
          "message": "Deprecated on 2026-02-03, removal scheduled for 2026-10-17: Use newField instead",
        },
        "legacyEnum": {
          "LEGACY": "@deprecated Deprecated on 2026-02-04, removal scheduled for 2026-10-18: Use STANDARD instead",
        },
        "legacyExperimental": {
          "deprecated": undefined,
          "message": undefined,
        },
        "overriddenEnum": undefined,
        "precedence": {
          "deprecated": undefined,
          "message": undefined,
        },
        "releaseDeprecated": {
          "deprecated": true,
          "message": "Deprecated on 2026-10-03, removal scheduled for 2027-04-17: Use newField instead",
        },
        "releaseEnum": {
          "LEGACY": "@deprecated Deprecated on 2026-10-04, removal scheduled for 2027-04-18: Use STANDARD instead",
          "OLD": "@deprecated Deprecated on 2026-10-05, removal scheduled for 2027-04-19: Use STANDARD instead",
        },
      }
    `);
  });

  test('transformGleanDeprecated keeps the annotations', () => {
    const before = loadFixture();
    transformGleanDeprecated(spec);

    expect(spec.paths['/stage/deprecated'].post['x-glean-release']).toEqual(
      before.paths['/stage/deprecated'].post['x-glean-release'],
    );
    expect(spec.paths['/legacy/deprecated'].post['x-glean-deprecated']).toEqual(
      before.paths['/legacy/deprecated'].post['x-glean-deprecated'],
    );
  });

  test('only beta and x-glean-experimental samples get the opt-in flag', () => {
    addServerURLToCodeSamples(spec);
    addIncludeExperimentalToCodeSamples(spec);

    const optedIn = Object.fromEntries(
      Object.entries(spec.paths).map(([p, item]) => [
        p,
        item.post['x-codeSamples'][0].source.includes(
          'include_experimental=True',
        ),
      ]),
    );

    expect(optedIn).toEqual({
      '/stage/beta': true,
      '/stage/ga': false,
      '/stage/deprecated': false,
      '/legacy/experimental': true,
      '/legacy/deprecated': false,
      '/precedence': false,
    });
  });
});
