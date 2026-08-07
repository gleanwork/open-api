/**
 * Validates that every `example` in a spec agrees with the schema it is attached to.
 *
 * An example that contradicts its own schema is not a cosmetic problem. Renderers
 * that build a request body from the spec copy example values verbatim, so a
 * type-invalid example ships a request the API rejects — the developer site's
 * interactive "try it" panel prefills exactly these values, and a wrong one turns
 * the first click on a page into an error response. Speakeasy's SDK code samples
 * hide the same defect, because they pass examples through typed models that
 * silently coerce whatever does not fit, so a broken example can look fine in one
 * tab and fail in another on the same page.
 *
 * Deliberately conservative: it reports only mismatches that are unambiguous, and
 * stays silent wherever the intended shape is genuinely open to interpretation —
 * `oneOf`/`anyOf`/`not`, and schemas that declare no type and carry no keyword to
 * infer one from. A check that cries wolf on a valid spec gets switched off, which
 * is worse than no check. `allOf` is checked rather than skipped, because it
 * flattens deterministically (see mergeAllOf), and a missing type is inferred from
 * `properties`/`additionalProperties`/`items`, since most schemas here describe an
 * object without saying so.
 */

const SCALAR_CHECKS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
};

/** Resolves local `#/components/...` refs. Returns null for anything external. */
function resolveRef(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let node = spec;
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) return null;
  }
  return node ?? null;
}

/**
 * Follows `$ref` chains to the schema that actually describes a value. Bounded
 * because a self-referential chain in a malformed spec must not hang the build.
 */
function deref(spec, schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 20) return schema;
  if (schema.$ref) {
    const target = resolveRef(spec, schema.$ref);
    return target ? deref(spec, target, depth + 1) : null;
  }
  return schema;
}

function typeName(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/**
 * Flattens an `allOf` into a single object schema for the purpose of checking an
 * example against it.
 *
 * `allOf` means the value satisfies every branch at once, so the union of the
 * branches' properties is a faithful view — unlike `oneOf`/`anyOf`, where the
 * intended branch is unknowable and checking would invent requirements. Returns
 * null whenever a branch makes the result ambiguous, so the caller stays silent
 * rather than guessing. Without this, a composed schema carrying an example (the
 * usual shape for response schemas here) would never be checked at all.
 */
function mergeAllOf(spec, schema, depth) {
  const merged = { type: 'object', properties: {} };
  for (const branch of schema.allOf) {
    const b = deref(spec, branch, depth);
    if (!b || typeof b !== 'object') continue;
    if (b.oneOf || b.anyOf || b.not) return null;
    if (b.type && b.type !== 'object') return null;
    if (b.allOf) {
      const inner = mergeAllOf(spec, b, depth + 1);
      if (!inner) return null;
      Object.assign(merged.properties, inner.properties);
      if (inner.additionalProperties)
        merged.additionalProperties = inner.additionalProperties;
      continue;
    }
    if (b.properties) Object.assign(merged.properties, b.properties);
    if (b.additionalProperties && typeof b.additionalProperties === 'object') {
      merged.additionalProperties = b.additionalProperties;
    }
  }
  return merged;
}

/**
 * Compares one example value against one schema, appending violations found.
 *
 * `path` is the spec location of the example being checked, so a failure names the
 * schema a maintainer has to edit rather than just the shape that was wrong.
 */
function checkValue(spec, schema, value, path, out, depth = 0) {
  if (depth > 12) return;
  let s = deref(spec, schema);
  if (!s || typeof s !== 'object') return;

  // Composition and untyped schemas: the intended shape is ambiguous, so silence.
  // `allOf` alone is the exception — it flattens deterministically.
  if (s.allOf && !s.oneOf && !s.anyOf && !s.not) {
    const flattened = mergeAllOf(spec, s, depth);
    if (!flattened) return;
    s = flattened;
  } else if (s.oneOf || s.anyOf || s.allOf || s.not) {
    return;
  }
  if (value === null) return; // nullable is spelled several ways across versions

  if (s.enum && Array.isArray(s.enum) && !s.enum.includes(value)) {
    out.push({
      path,
      problem: `value ${JSON.stringify(value)} is not one of the schema's enum values`,
      expected: s.enum,
      got: value,
    });
    return;
  }

  // Most schemas in these specs describe an object without saying `type: object`,
  // which is legal and very common. Infer it from the keywords that only make
  // sense for one type, or a wrong-shaped example against such a schema slips by.
  const t =
    s.type ??
    (s.properties || s.additionalProperties
      ? 'object'
      : s.items
        ? 'array'
        : undefined);
  if (!t) return;

  if (t === 'array') {
    if (!Array.isArray(value)) {
      out.push({
        path,
        problem: `schema is type array but example is ${typeName(value)}`,
        got: value,
      });
      return;
    }
    if (s.items) {
      value.forEach((item, i) =>
        checkValue(spec, s.items, item, `${path}[${i}]`, out, depth + 1),
      );
    }
    return;
  }

  if (t === 'object') {
    if (Array.isArray(value) || typeof value !== 'object') {
      out.push({
        path,
        problem: `schema is type object but example is ${typeName(value)}`,
        got: value,
      });
      return;
    }
    for (const [key, val] of Object.entries(value)) {
      const propSchema = s.properties?.[key];
      if (propSchema) {
        checkValue(spec, propSchema, val, `${path}.${key}`, out, depth + 1);
      } else if (
        s.additionalProperties &&
        typeof s.additionalProperties === 'object'
      ) {
        checkValue(
          spec,
          s.additionalProperties,
          val,
          `${path}.${key}`,
          out,
          depth + 1,
        );
      }
    }
    return;
  }

  const isScalarOk = SCALAR_CHECKS[t];
  if (isScalarOk && !isScalarOk(value)) {
    out.push({
      path,
      problem: `schema is type ${t} but example is ${typeName(value)}`,
      got: value,
    });
  }
}

/**
 * Walks a whole spec and returns every example that contradicts its schema.
 *
 * Both spellings are covered: a schema-level `example`, and OpenAPI 3.1's
 * `examples` array on a schema. Media-type `examples` (keyed objects with a
 * `value`) are checked against the sibling `schema` when one is present.
 */
export function findInvalidExamples(spec) {
  const out = [];
  const seen = new Set();

  const walk = (node, path) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (
      Object.prototype.hasOwnProperty.call(node, 'example') &&
      (node.type || node.properties || node.items || node.$ref || node.allOf)
    ) {
      checkValue(spec, node, node.example, `${path}.example`, out);
    }
    if (
      Array.isArray(node.examples) &&
      (node.type || node.properties || node.items)
    ) {
      node.examples.forEach((ex, i) =>
        checkValue(spec, node, ex, `${path}.examples[${i}]`, out),
      );
    }
    // Media type object: { schema, examples: { name: { value } } }
    if (node.schema && node.examples && !Array.isArray(node.examples)) {
      for (const [name, ex] of Object.entries(node.examples)) {
        if (ex && typeof ex === 'object' && 'value' in ex) {
          checkValue(
            spec,
            node.schema,
            ex.value,
            `${path}.examples.${name}.value`,
            out,
          );
        }
      }
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === 'example' || key === 'examples') continue;
      walk(child, `${path}.${key}`);
    }
  };

  walk(spec, '$');
  return out;
}

/** Formats violations for a test failure message or CI log. */
export function formatViolations(violations) {
  return violations
    .map(
      (v) =>
        `  ${v.path}\n      ${v.problem}\n      got: ${JSON.stringify(v.got)?.slice(0, 160)}`,
    )
    .join('\n');
}
