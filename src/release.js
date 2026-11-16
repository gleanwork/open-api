/**
 * Readers for a node's lifecycle stage.
 *
 * `x-glean-release` is the lifecycle annotation. Until every source spec uses
 * it, these readers fall back to the older `x-glean-experimental` and
 * `x-glean-deprecated` annotations. A node that has `x-glean-release` ignores
 * the older ones.
 *
 * `x-glean-release` has two forms:
 *
 * - Object form, on operations, properties, and parameters:
 *
 *     x-glean-release:
 *       stage: deprecated # unreleased | beta | ga | deprecated
 *       docs: https://...
 *       deprecation:
 *         message: Use newField instead
 *         introduced: 2026-10-01
 *         removal: 2027-04-15
 *
 * - List form, only for enum values, and only to deprecate them:
 *
 *     x-glean-release:
 *       - stage: deprecated
 *         enum-value: LEGACY
 *         deprecation:
 *           message: Use STANDARD instead
 *           introduced: 2026-10-01
 *           removal: 2027-04-15
 *
 * Published specs never contain `stage: unreleased` nodes, so nothing here
 * strips nodes.
 */

export const RELEASE_EXTENSION = 'x-glean-release';
export const EXPERIMENTAL_EXTENSION = 'x-glean-experimental';
export const DEPRECATED_EXTENSION = 'x-glean-deprecated';

const OPT_IN_STAGES = new Set(['unreleased', 'beta']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether a node carries an annotation that can deprecate it: `x-glean-release`
 * or `x-glean-deprecated`.
 *
 * @param {Object} node
 * @returns {boolean}
 */
export function hasDeprecationAnnotation(node) {
  return (
    isPlainObject(node) &&
    (node[RELEASE_EXTENSION] !== undefined ||
      Boolean(node[DEPRECATED_EXTENSION]))
  );
}

/**
 * The deprecation details of an `x-glean-release` entry, with the stage-level
 * `docs` filled in when the deprecation has none of its own.
 *
 * @param {Object} entry An object-form value or a list-form item
 * @returns {Object|null}
 */
function releaseDeprecation(entry) {
  if (entry.stage !== 'deprecated' || !isPlainObject(entry.deprecation)) {
    return null;
  }
  const deprecation = { ...entry.deprecation };
  if (deprecation.docs === undefined && entry.docs !== undefined) {
    deprecation.docs = entry.docs;
  }
  return deprecation;
}

/**
 * Whether calling this operation needs the SDK's opt-in flag: `stage: beta`
 * (or `unreleased`), or an old `x-glean-experimental` annotation.
 *
 * @param {Object} operation The operation object
 * @returns {boolean}
 */
export function requiresOptIn(operation) {
  if (!isPlainObject(operation)) return false;

  const release = operation[RELEASE_EXTENSION];
  if (release !== undefined) {
    return isPlainObject(release) && OPT_IN_STAGES.has(release.stage);
  }

  return Boolean(operation[EXPERIMENTAL_EXTENSION]);
}

/**
 * The deprecation the node sets on itself, or null when it sets none.
 *
 * Reads `x-glean-release` with `stage: deprecated`. Without `x-glean-release`,
 * reads `x-glean-deprecated`: the object form deprecates the node, and on an
 * enum the list form deprecates it only through a `kind: property` entry.
 *
 * @param {Object} node An operation, parameter, or schema
 * @returns {Object|null} `{ message, introduced, removal, docs }`, each optional
 */
export function getDeprecation(node) {
  if (!isPlainObject(node)) return null;

  const release = node[RELEASE_EXTENSION];
  if (release !== undefined) {
    return isPlainObject(release) ? releaseDeprecation(release) : null;
  }

  const legacy = node[DEPRECATED_EXTENSION];
  if (isPlainObject(legacy)) {
    if (legacy.kind === 'enum-value' || 'enum-value' in legacy) return null;
    return legacy;
  }

  if (Array.isArray(legacy) && Array.isArray(node.enum)) {
    return (
      legacy.find((item) => isPlainObject(item) && item.kind === 'property') ||
      null
    );
  }

  return null;
}

/**
 * The enum values the node deprecates.
 *
 * Reads the list form of `x-glean-release`. `enum-value` can sit on the list
 * item or inside its `deprecation`. Without `x-glean-release`, reads the `kind: enum-value` entries of the
 * list form of `x-glean-deprecated`.
 *
 * @param {Object} node A schema
 * @returns {Array<{ enumValue: string, deprecation: Object }>}
 */
export function getEnumValueDeprecations(node) {
  if (!isPlainObject(node)) return [];

  const release = node[RELEASE_EXTENSION];
  if (release !== undefined) {
    if (!Array.isArray(release)) return [];
    return release.flatMap((item) => {
      if (!isPlainObject(item)) return [];
      const deprecation = releaseDeprecation(item);
      const enumValue = item['enum-value'] ?? deprecation?.['enum-value'];
      if (!deprecation || typeof enumValue !== 'string') return [];
      return [{ enumValue, deprecation }];
    });
  }

  const legacy = node[DEPRECATED_EXTENSION];
  if (!Array.isArray(legacy)) return [];
  return legacy.flatMap((item) =>
    isPlainObject(item) &&
    item.kind === 'enum-value' &&
    typeof item['enum-value'] === 'string'
      ? [{ enumValue: item['enum-value'], deprecation: item }]
      : [],
  );
}
