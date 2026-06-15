# First-class OAuth support in the Glean API client SDKs

**Status:** Draft / proposed
**Applies to:** `api-client-typescript`, `api-client-python`, `api-client-go`, `api-client-java` (all four Speakeasy-generated SDKs) and the shared spec pipeline in `gleanwork/open-api`.
**Author:** _TBD_

---

## 1. Summary

Today the SDKs only support a single bearer credential surfaced as `apiToken`. OAuth users must hack the header in via a custom HTTP client. This document proposes first-class OAuth support:

- A consumer can authenticate with **either** a Glean API token **or** an OAuth access token, chosen at construction.
- For OAuth, the SDK automatically sends the `X-Glean-Auth-Type: OAUTH` header when (and only when) it is required.
- The canonical auth surface becomes the Speakeasy `security` object/callback (which cleanly represents multiple schemes and token refresh), while the existing flat `apiToken` field is preserved as a backwards-compatible shim.

Scope is deliberately limited to **bring-your-own-token** OAuth. The SDK does not perform OAuth flows itself (see Non-goals).

---

## 2. Background: how Glean authenticates Client API requests

> OAuth applies to the **Client API only**. The Indexing API uses Glean-issued tokens and does not accept OAuth.

There are three ways a consumer authenticates, and they differ on the wire:

| Method                                         | `Authorization`  | `X-Glean-Auth-Type`                        |
| ---------------------------------------------- | ---------------- | ------------------------------------------ |
| Glean API token (user-scoped)                  | `Bearer <token>` | —                                          |
| Glean API token (global)                       | `Bearer <token>` | — (plus `X-Glean-ActAs` for impersonation) |
| OAuth — Glean OAuth Authorization Server (GAS) | `Bearer <token>` | **not required**                           |
| OAuth — external IdP-issued token              | `Bearer <token>` | **`OAUTH` (required)**                     |

Two facts drive the design and are easy to get wrong:

1. **`X-Glean-Auth-Type: OAUTH` is required only for external-IdP tokens.** Tokens issued by the Glean OAuth Authorization Server are recognized by their issuer and accepted without the header. Sending the header on a GAS token is harmless.
2. Because of (1), a **single** "OAuth access token" surface can unconditionally send `X-Glean-Auth-Type: OAUTH`: it is required for IdP tokens and ignored for GAS tokens. The SDK never needs to introspect the token to decide.

References (public): Glean Developer docs — OAuth Authentication for Client API; Client API Authentication overview; Glean OAuth Authorization Server.

---

## 3. Scope and non-goals

### In scope

- Accept an OAuth **access token** (a string) the consumer already obtained.
- Accept a **token provider** (a function returning a token) so refresh is the consumer's, using a standard OAuth library.
- Automatically attach `X-Glean-Auth-Type: OAUTH` for the OAuth path.
- Preserve the existing `apiToken` ergonomics (backwards compatibility).

### Non-goals (deferred or out of scope)

- **The SDK performing an OAuth flow** (authorization-code/PKCE or client-credentials). GAS's authorization-code flow is interactive; the SDK should not run it. The consumer obtains tokens with a standard library and passes them in.
- **OAuth client-credentials ("managed" flow).** GAS supports it for confidential service clients, and it is the most ergonomic SDK path, but it is not yet externalized as a supported public capability. **Deferred.** Re-adding it later is purely additive (a new `oauth2` security scheme in the overlay); see §8.
- **Dynamic Client Registration (DCR).** A client-registration mechanism (primarily for MCP hosts); tokens from DCR clients are GAS-issued and need no special handling. Out of scope.
- **`private_key_jwt` token-endpoint auth.** Not natively supported by the generator. Out of scope.
- **Per-user impersonation via `X-Glean-ActAs`.** Currently stripped from the SDKs; a separate workstream.

---

## 4. Investigation: what the generator actually does with two schemes

The central uncertainty was whether adding a second bearer scheme yields two flat constructor fields, a `security` object, or something else — and whether the existing flat `apiToken` could be preserved. This was settled empirically by regenerating the TypeScript SDK against the merged spec with an `OAuthAccessToken` scheme added, under three configurations.

| Configuration                                                                                | Generated `SDKOptions` auth                           | `components.Security`                                                                             | Outcome                                                                                                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `flattenGlobalSecurity: true` (current) + two alternatives declared per-operation            | `apiToken?: string \| (() => Promise<string>)` (flat) | `{ apiToken }` only                                                                               | **OAuth silently dropped.** Generator hoists the single most-used scheme and discards the rest.            |
| `flattenGlobalSecurity: false`, security still per-operation only                            | `security?: Security \| (() => Promise<Security>)`    | `{ apiToken }` at client level; both schemes appear only in a **per-method** `…Security` argument | **Asymmetric/unusable.** Hoist heuristic still lifts one scheme; OAuth is relegated to per-call arguments. |
| `flattenGlobalSecurity: false` + a **global** `security: [APIToken, OAuthAccessToken]` block | `security?: Security \| (() => Promise<Security>)`    | **`{ apiToken?, oAuthAccessToken? }`** at client level                                            | **Clean.** Both schemes, client level, no per-call args, no hoisting.                                      |

**Conclusions:**

1. **The flat `apiToken` field cannot coexist with a second scheme under the generator.** `flattenGlobalSecurity`/security-hoisting collapse multiple alternatives to the single most-used scheme and drop the others. Adding OAuth therefore _requires_ `flattenGlobalSecurity: false`, which changes the canonical surface to the `security` object/callback. This is a **breaking change** to the current `apiToken: "…"` constructor — hence the shim in §6.3.
2. **The lever is the spec, not only the gen flag.** The merged spec declares security per-operation with no global block, which triggers the hoist heuristic. The overlay must declare a **global** `security` with both alternatives so the generator emits a clean client-level `Security` object.

The winning configuration's generated request wiring (per operation):

```ts
const securityInput = await extractSecurity(client._options.security);
const requestSecurity = resolveGlobalSecurity(securityInput);
// ...
securitySource: client._options.security,   // the whole Security object reaches hooks
```

`securitySource` being the full `Security` object is what makes the `X-Glean-Auth-Type` hook clean (it can check `security.oAuthAccessToken != null`).

---

## 5. Consumer-facing API

The SDK does **not** ship an OAuth client. It accepts a token or a token-provider; the consumer mints tokens with a standard library (e.g. `openid-client` in Node) or their IdP SDK. This matches Speakeasy's security-source convention and the broader industry norm (credential providers in the AWS/GCP/Azure SDKs).

### 5.1 API token (unchanged; back-compat shim)

```ts
const glean = new Glean({
  serverURL: 'https://mycompany-be.glean.com',
  apiToken: '<glean-api-token>',
});
```

### 5.2 OAuth — simplest (a token string)

```ts
const glean = new Glean({
  serverURL: 'https://mycompany-be.glean.com',
  oauthToken: '<oauth-access-token>', // X-Glean-Auth-Type: OAUTH attached automatically
});
```

On the wire:

```http
POST /rest/api/v1/search HTTP/1.1
Host: mycompany-be.glean.com
Authorization: Bearer <oauth-access-token>
X-Glean-Auth-Type: OAUTH
```

### 5.3 OAuth — with refresh (token provider; standard library)

```ts
import * as client from "openid-client"; // standard Node OIDC lib, nothing Glean-specific

const config = await client.discovery(
  new URL("https://mycompany-be.glean.com/.well-known/oauth-authorization-server"),
  CLIENT_ID, CLIENT_SECRET,
);
let tokens = /* result of your one-time auth-code/PKCE exchange */;

const glean = new Glean({
  serverURL: "https://mycompany-be.glean.com",
  oauthToken: async () => {
    if (isExpiring(tokens)) tokens = await client.refreshTokenGrant(config, tokens.refresh_token!);
    return tokens.access_token!;
  },
});
```

### 5.4 Canonical `security` form (also supported)

```ts
new Glean({ security: { apiToken: 'x' } });
new Glean({ security: { oauthToken: 'x' } });
new Glean({ security: async () => ({ oauthToken: await getToken() }) });
```

### 5.5 Choosing

`apiToken`/`oauthToken` (and the `security` object) are alternatives — set exactly one credential. Python/Go/Java mirror this shape, since all four are generated from the same spec.

---

## 6. Design

### 6.1 Spec overlay (in `gleanwork/open-api`) — one change, fans out to all four SDKs

Add an OAuth bearer scheme and declare a **global** security block with both alternatives. Validated overlay actions:

```yaml
overlay: 1.0.0
x-speakeasy-jsonpath: rfc9535
actions:
  - target: $.components.securitySchemes
    update:
      OAuthAccessToken: # see §7 on naming → key becomes oAuthAccessToken
        type: http
        scheme: bearer
  - target: $.paths.*.*.security # drop per-operation security so the global block governs
    remove: true
  - target: $
    update:
      security:
        - APIToken: []
        - OAuthAccessToken: []
```

Leave the existing header-stripping overlay in place — `X-Glean-Auth-Type` stays out of the parameter list (it is hook-injected, not a manual parameter).

### 6.2 Generator config (`gen.yaml`, per repo — identical)

- `flattenGlobalSecurity: false` (required — see §4).
- `oAuth2ClientCredentialsEnabled: false` and `oAuth2PasswordEnabled: false` (no `oauth2` scheme is used in v1; removing these trims dead generated surface).

### 6.3 Backwards-compatibility shim — a thin `Glean` subclass (per repo)

Because §4 forces the `security` object form, the existing flat `apiToken` constructor would break. A small hand-authored subclass (regen-independent; depends only on the stable `Security` shape) accepts the flat fields and normalizes them into a `security` source before delegating to the generated class:

```ts
// hand-authored, e.g. src/custom/glean.ts
import { Glean as GleanBase } from '../sdk/sdk.js';
import type { SDKOptions } from '../lib/config.js';
import type { Security } from '../models/components/security.js';

export type GleanOptions = SDKOptions & {
  apiToken?: string | (() => Promise<string>); // back-compat shim
  oauthToken?: string | (() => Promise<string>); // convenience flat field
};

export class Glean extends GleanBase {
  constructor({ apiToken, oauthToken, ...rest }: GleanOptions = {}) {
    const security =
      rest.security ??
      (async (): Promise<Security> => ({
        apiToken: typeof apiToken === 'function' ? await apiToken() : apiToken,
        oAuthAccessToken:
          typeof oauthToken === 'function' ? await oauthToken() : oauthToken,
      }));
    super({ ...rest, security });
  }
}
```

The public package re-exports this `Glean` instead of the generated one via a hand-authored barrel (`export { Glean } from "./custom/glean.js"; export * from "../index.js";` — the explicit named export shadows the generated `Glean` in the `export *`). The package `exports` map is already customized in `gen.yaml`, so adding the entry is consistent with existing practice.

Each language gets the equivalent thin wrapper (Python `__init__` re-export, Go constructor, Java builder). The wrapper is the **only** way to support both surfaces without breaking the existing `apiToken` constructor.

### 6.4 `X-Glean-Auth-Type` hook (per repo)

A `beforeRequest` hook sets `X-Glean-Auth-Type: OAUTH` iff the active OAuth scheme is populated, read from `securitySource` (now the full `Security` object):

```ts
beforeRequest(ctx, request) {
  const sec = resolve(ctx.securitySource); // string | Security | fn
  if (sec && (sec as Security).oAuthAccessToken) {
    request.headers.set("X-Glean-Auth-Type", "OAUTH");
  }
  return request;
}
```

In TypeScript this registers in the existing hand-editable `src/hooks/registration.ts` alongside the current `XGlean` hook. The other SDKs use their equivalent request hooks and `securitySource` accessors.

### 6.5 Environment-variable fallback

Turning `flattenGlobalSecurity` off removes the generated `GLEAN_API_TOKEN` auto-pickup observed today. The shim (§6.3) should restore env fallback for back-compat and add the OAuth equivalent:

- `GLEAN_API_TOKEN` → `apiToken`
- `GLEAN_OAUTH_TOKEN` → `oauthToken`

(Confirm the exact pre-existing env behavior per language and preserve it.)

---

## 7. Naming

The scheme name determines the generated key: `OAuthAccessToken` → `oAuthAccessToken`. Either rename the scheme (e.g. `OauthToken` → `oauthToken`) for a cleaner generated key, or keep the scheme name and let the wrapper expose `oauthToken` as the public flat field (the wrapper already maps it). Recommendation: expose `oauthToken` publicly regardless of the internal scheme key.

---

## 8. Forward-compatibility notes

- **`serverURL` / `instance` migration.** This OAuth design is independent of the server-URL format. The OAuth surface is a bearer credential plus a constant header, both applied after base-URL resolution; it does not reference `instance`, `serverURL`, or any host. The migration from `instance` to `serverURL` (and tenant-ID obfuscation / vanity URLs) can proceed separately without affecting OAuth.
- **If client-credentials is externalized later.** Add an `oauth2` scheme with `clientCredentials` and a **root-relative** `tokenUrl: /oauth/token` (never absolute or `{instance}`-templated, and do not depend on `.well-known` discovery). A relative token URL resolves against the configured server origin, so it automatically follows the `serverURL` migration and works for vanity/obfuscated hosts. This is purely additive to the design above.

---

## 9. Rollout sequence

1. Land the overlay (§6.1) in `gleanwork/open-api` → transform → registry.
2. Client-generation is triggered in all four SDK repos.
3. In each repo, add the `gen.yaml` change (§6.2), the wrapper (§6.3), the hook (§6.4), and env fallback (§6.5).
4. Merge → each repo releases.
5. Publish the auth documentation (§5) for consumers.

The TypeScript repo should go first (where the generator behavior was validated); the other three mirror the same overlay output plus the equivalent per-language wrapper and hook.

---

## 10. Risks / open items

- **Wrapper export plumbing per language.** Bounded but real; each SDK owns a thin hand-authored entry point. This is the cost of supporting both surfaces.
- **Env-var parity** (§6.5) must be verified per language so existing `GLEAN_API_TOKEN` users are unaffected.
- **Endpoint auth-type consistency.** A few Client API endpoints historically handled the auth-type header inconsistently; centralizing header injection in the hook mitigates this, but verify against current behavior.
- **Naming** (§7) is a one-way door once published; decide before release.

---

## Appendix A — Validation methodology

The generator behavior in §4 was established by copying the merged spec and `gen.yaml` into a throwaway directory outside any repo, applying the overlay in §6.1 via a local Speakeasy workflow, and running `speakeasy run -t <target> --minimal --skip-compile --skip-testing --skip-versioning --skip-upload-spec` under each configuration, then inspecting the generated `lib/config.ts`, `models/components/security.ts`, and an operation function. No repository or the Speakeasy registry was modified (`--skip-upload-spec`).
