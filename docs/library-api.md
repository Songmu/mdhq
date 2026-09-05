# Library API reference

The package is an ECMAScript module:

```ts
import {
  convertHtml,
  getPage,
  MdhqError
} from "@songmu/mdhq";
```

Runtime exports:

- `convertHtml`
- `getPage`
- `MdhqError`

Type-only exports:

- `MdhqConfig`
- `MdhqErrorCode`
- `AssetResult`
- `ConvertedPage`
- `ConvertHtmlOptions`
- `GetPageOptions`
- `GetPageResult`
- `HeaderValue`
- `MdhqWarning`
- `PageMetadata`

TypeScript callers should import types with `import type`:

```ts
import { getPage, MdhqError } from "@songmu/mdhq";
import type { GetPageOptions, GetPageResult, MdhqConfig } from "@songmu/mdhq";
```

## `convertHtml`

```ts
function convertHtml(options: ConvertHtmlOptions): Promise<ConvertedPage>
```

This is the low-level conversion API. It does not fetch the page, download
assets, add frontmatter, or write files.

### Options

```ts
interface ConvertHtmlOptions {
  html: string;
  url: string | URL;
  defuddle?: Omit<DefuddleOptions, "markdown" | "url">;
}
```

- `html` is the complete input HTML string.
- `url` is an absolute base URL. Unlike `getPage`, it is not restricted to
  HTTP or HTTPS; for example, a `file:` URL is accepted.
- `defuddle` passes options to Defuddle.

mdhq forces `markdown: true`. `useAsync` defaults to `true` when it is not
provided.

### Result

```ts
interface ConvertedPage {
  markdown: string;
  metadata: PageMetadata;
}
```

```ts
interface PageMetadata {
  title?: string;
  description?: string;
  author?: string;
  published?: string;
  updated?: string;
  site?: string;
  domain?: string;
  language?: string;
  image?: string;
  favicon?: string;
  wordCount?: number;
}
```

Empty string metadata is omitted. `wordCount` is omitted unless it is greater
than zero.

## `getPage`

```ts
function getPage(options: GetPageOptions): Promise<GetPageResult>
```

This is the high-level fetch, convert, localize, and save API.

### Options

```ts
interface GetPageOptions {
  url: string | URL;
  root?: string;
  configPath?: string;
  assets?: boolean;
  update?: boolean;
  headers?: HeaderValue[];
  userAgent?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  useAsync?: boolean;
  now?: () => Date;
  onWarning?: (warning: MdhqWarning) => void;
}
```

| Field | Behavior |
| --- | --- |
| `url` | Required HTTP or HTTPS page URL. |
| `root` | Highest-precedence library storage root. |
| `configPath` | Override the default XDG configuration path. |
| `assets` | Download and localize images when `true`; overrides configuration and defaults to `true`. When `false`, image destinations remain absolute and `_assets` is not created. |
| `update` | Replace an existing same-identity document when `true`; defaults to `false`. |
| `headers` | Additional page headers. Sent only while requests remain on the initial page origin. A cross-origin page redirect permanently disables them for later page and asset requests in that operation. |
| `userAgent` | Override the configured or built-in User-Agent. |
| `timeoutMs` | Override the configured or built-in per-request timeout. |
| `maxResponseBytes` | Override the configured or built-in response-size limit. |
| `maxRedirects` | Override the configured or built-in redirect limit. |
| `useAsync` | Highest-precedence Defuddle asynchronous-extractor setting. |
| `now` | Clock injection used for `created` and `modified`; intended for deterministic callers and tests. Both fields are written on initial acquisition. |
| `onWarning` | Called once for each warning as it is produced. |

### Headers

```ts
interface HeaderValue {
  name: string;
  value: string;
}
```

Multiple entries with the same name are appended.

### Result

```ts
interface GetPageResult {
  requestedUrl: string;
  sourceUrl: string;
  path: string;
  status: "saved" | "updated" | "unchanged" | "skipped";
  assets: AssetResult[];
  warnings: MdhqWarning[];
}
```

- `requestedUrl` is the input after WHATWG URL serialization and fragment
  removal. This lowercases and IDNA-normalizes the host and removes an explicit
  default port.
- `sourceUrl` is the normalized source URL written to frontmatter `source`.
  After redirects, mdhq accepts one HTML canonical URL when its normalized
  origin and pathname match the final response URL. Invalid, ambiguous,
  cross-origin, or path-divergent canonical URLs are ignored. Without an
  accepted canonical, mdhq uses `urlpurify` to remove known tracking
  parameters from the final response URL. Fragments are always removed.
  For a pre-fetch skip, `sourceUrl` is the existing document's stored source.
- `path` is the absolute Markdown path.
- `assets` is empty when page processing is skipped.
- `warnings` contains configuration and asset warnings.

Status meanings:

- `saved`: a new document was created.
- `updated`: an existing document's normalized Markdown body or user-facing
  frontmatter changed.
- `unchanged`: HTTP returned 304, or a 200 response produced the same
  normalized Markdown body and user-facing frontmatter. HTTP validators may
  still be updated.
- `skipped`: an existing same-identity document was found without `update`.

With `update`, `getPage` sends the stored `etag` as `If-None-Match`, or falls
back to the stored `last_modified` as `If-Modified-Since`, when the request is
for the same HTTP target and does not include credentials. `etag` and
`last_modified` are stored in Markdown frontmatter only when the response is
safe to revalidate; `Vary` and body digests are not serialized.

The fast pre-fetch skip is retained. If the requested URL candidate already
maps to an existing document and `update` is false, mdhq does not make a
network request and therefore cannot observe remote redirect or canonical
changes.

### Asset results

```ts
interface AssetResult {
  sourceUrl: string;
  finalUrl?: string;
  path?: string;
  status: "saved" | "reused" | "failed";
  error?: string;
}
```

- `sourceUrl` is the absolute pre-fetch asset URL discovered in Markdown or
  representative-image metadata.
- `path` is the absolute local asset path.
- `saved` means a new immutable content-addressed asset file was created.
- `reused` means the deterministic asset path already existed with identical
  bytes.
- `failed` means the Markdown operation continued without localizing that
  asset, including the unlikely case of differing bytes at the same digest
  and extension path.
- `finalUrl` and `path` are present for successful asset operations.
- `error` is present for failed operations.

The `assets` array follows first-discovery order. Markdown images are listed
in document traversal order, followed by the representative image when it was
not already discovered. Exact duplicate source URLs produce one result.
Different source URLs that redirect to the same final URL produce separate
results but reuse the same deterministic file.

### Warnings

```ts
interface MdhqWarning {
  code: string;
  message: string;
  url?: string;
}
```

Current warning codes:

| Code | Meaning |
| --- | --- |
| `UNKNOWN_CONFIG_KEY` | A JSON configuration key is not recognized but processing continues. |
| `ASSET_FETCH_FAILED` | An individual asset could not be fetched, validated, or saved. |
| `INVALID_IMAGE_URL` | Defuddle returned an invalid or non-HTTP(S) representative-image URL; the page is saved without that metadata field. |
| `INVALID_LAST_MODIFIED` | A response contained an invalid `Last-Modified` value; the page is saved without that validator. |

Warnings are both accumulated in the result and delivered to `onWarning`.

## Error model

Fatal operational errors are represented by:

```ts
class MdhqError extends Error {
  readonly code: MdhqErrorCode;
  readonly cause?: unknown;
}
```

Current error codes:

| Code | Meaning |
| --- | --- |
| `INVALID_URL` | A URL or URL path encoding is invalid. |
| `INVALID_HEADER` | A CLI `--header` value does not use `Name: value` syntax. |
| `UNSUPPORTED_SCHEME` | The high-level operation received a non-HTTP(S) URL or a redirect used one. |
| `UNSUPPORTED_CONTENT_TYPE` | A page response was not HTML or XHTML. |
| `RESPONSE_TOO_LARGE` | A page exceeded the configured byte limit. The same condition for an individual asset is converted to an `ASSET_FETCH_FAILED` warning and failed asset result by `getPage`. |
| `TOO_MANY_REDIRECTS` | The configured redirect limit was exceeded. |
| `FETCH_FAILED` | Network, timeout, HTTP-status, or redirect metadata failure. |
| `CONVERSION_FAILED` | Defuddle failed or produced no usable Markdown. |
| `CONFIG_ERROR` | Configuration reading, syntax, type validation, or pattern selection failed. |
| `PATH_COLLISION` | A destination belongs to a different URL identity or cannot be identified safely. |
| `PATH_TOO_LONG` | The destination cannot fit after path-segment hashing. |
| `STORAGE_ERROR` | A Markdown read, create, temporary write, or replacement failed. |

Callers should branch on `error.code` rather than parsing `error.message`.

Errors produced while processing an individual asset do not escape
`getPage`. They are converted into `ASSET_FETCH_FAILED` warnings and
`AssetResult` objects with `status: "failed"`. The error table describes
fatal page-level and Markdown-storage failures unless a row explicitly says
otherwise.
