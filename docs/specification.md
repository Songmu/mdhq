# Current specification

This document describes the behavior implemented in mdhq `0.0.0`.

## Overview

mdhq fetches one web page, extracts its primary content with Defuddle,
converts it to Markdown, downloads supported images, adds YAML frontmatter,
and saves the result in a ghq-inspired directory layout.

The storage tree is self-contained. mdhq does not create a database, global
index, persistent lock file, or state file.

Runtime requirements:

- Node.js 22 or newer
- ECMAScript modules

## CLI

The executable provides three subcommands:

```text
mdhq get [options] <url>
mdhq list [options]
mdhq root [options]
```

`mdhq get` accepts exactly one URL per invocation. Parallel or multi-URL
processing is delegated to external tools such as `xargs`.

### `get` options

| Option | Description |
| --- | --- |
| `--root <path>` | Override the storage root. |
| `--update` | Fetch and replace an existing document with the same URL identity. |
| `--user-agent <value>` | Override the default HTTP User-Agent. |
| `--header <header>` | Add an HTTP header. The option is repeatable and uses `Name: value` syntax. |
| `--json` | Write a structured result instead of only the Markdown path. |

On success without `--json`, stdout contains exactly one absolute Markdown
path followed by a newline. Warnings are written to stderr.

With `--json`, stdout contains an object with this shape:

```json
{
  "requestedUrl": "https://example.com/start",
  "sourceUrl": "https://example.com/article",
  "path": "/data/mdhq/example.com/article.md",
  "status": "saved",
  "assets": [],
  "warnings": []
}
```

`status` is one of:

- `saved`: a new Markdown file was created.
- `updated`: an existing document's normalized Markdown body changed.
- `unchanged`: an update succeeded without changing the normalized Markdown
  body, including an HTTP 304 response.
- `skipped`: an existing same-identity file was kept.

An error is written to stderr and causes exit status `1`.

### `list`

`mdhq list` recursively lists regular files ending in `.md` below the
effective storage root. Results are sorted by their root-relative paths and
written one per line.

By default, paths are relative to the storage root. `-p` or `--full-path`
prints absolute paths instead. `--root <path>` overrides the storage root
using the same precedence as `get`.

Directory symbolic links are not followed. Other extensions, including
uppercase `.MD` and names such as `.markdown`, are not listed. An empty root
produces no output. A missing or unreadable root is an error.

### `root`

`mdhq root` writes the absolute effective storage root followed by a newline.
`--root <path>` overrides the storage root using the same precedence as `get`
and `list`. The command loads configuration and reports configuration warnings
to stderr, but it does not require the resolved root to exist and does not
create it.

## Processing pipeline

`getPage` performs the following operations:

1. Validate that the requested URL uses HTTP or HTTPS.
2. Load the JSON configuration and collect unknown-key warnings.
3. Resolve the storage root and a pre-fetch host/path-specific entry query key.
4. Remove known tracking parameters from the requested URL candidate and check
   whether it already has a same-identity destination.
5. Fetch the page when it cannot be skipped before network access.
6. Resolve the final response URL after redirects.
7. Derive the normalized source URL from an accepted HTML canonical URL or
   `urlpurify` tracking-parameter removal.
8. Recalculate configuration and destination from the normalized source and
   check the final destination for another same-identity skip.
9. Convert the fetched HTML to Markdown with Defuddle using the final response
   URL as its base URL.
10. Normalize ordinary links and discover image links using the final response
    URL.
11. Download supported images and rewrite successful image destinations.
12. Normalize the Markdown body and calculate its SHA-256 content digest.
13. Build YAML frontmatter.
14. Save the Markdown with collision-safe create or update behavior.

The normalized source determines the destination and the `source` frontmatter
field. The fragment-free WHATWG-serialized original URL is retained as
`requested_url` only when it differs from the normalized source. Intermediate
redirect URLs are not stored.

The pre-fetch skip is intentionally retained. When it succeeds, mdhq performs
no request and cannot discover later redirect or canonical changes.

## HTTP behavior

The high-level API accepts only `http:` and `https:` URLs. Local HTML or other
schemes must be passed to the low-level `convertHtml` API instead.

Defaults:

| Setting | Default |
| --- | --- |
| User-Agent | `mdhq/0.0.0 (+https://github.com/Songmu/mdhq)` |
| Accept for pages | `text/html, application/xhtml+xml` |
| Timeout | 30 seconds per request attempt |
| Maximum response size | 20 MiB per resource |
| Maximum redirects | 10 |

With `update`, mdhq uses validators from a recognized existing destination:

1. Confirm that the request does not include `Authorization` or `Cookie`.
2. Confirm that the stored `source` is the same HTTP target as the requested
   URL, comparing scheme, authority, path, and query while ignoring fragments.
3. Send `If-None-Match` when frontmatter contains `etag`.
4. Otherwise send `If-Modified-Since` when frontmatter contains a valid
   `last_modified`.
5. Otherwise perform an ordinary GET.

Storage identity is intentionally broader than HTTP validator scope. A
same-identity URL with a different scheme, ignored secondary query parameter
under an entry key, or path alias is fetched without stored validators.

Automatic validators are sent only on the first request and are not forwarded
after redirects. When a stored validator is available, it replaces any
caller-provided `If-None-Match` or `If-Modified-Since` value so that an HTTP
304 always corresponds to the saved document. A 304 received without a stored
validator is an error.

An HTTP 304 response preserves the existing Markdown body, skips conversion
and asset downloads, preserves `modified`, and returns `unchanged`. A 200
response replaces stored validators with the response values; validators that
are absent from a 200 response are removed without changing `modified` when
the normalized Markdown body and user-facing frontmatter are unchanged.

Responses with a non-empty `Vary` header do not persist ETag or Last-Modified
validators, and mdhq never stores `Vary` header names or values in Markdown.
Responses without `Vary` may store a reusable `etag` or `last_modified`
validator.

Requests containing caller-supplied `Authorization` or `Cookie` headers never
reuse or persist HTTP validators, even when the response omits `Vary`. This
prevents a later request with a different credential context from accepting a
304 for a representation it did not fetch.

Any other non-success response, including `404 Not Found` and `410 Gone`,
fails the update before conversion or storage. The existing Markdown document,
frontmatter timestamps, validators, and localized assets remain unchanged.

All destination writes are serialized with a per-file cross-process lock.
Before saving either a 304 or 200 update, mdhq verifies that the destination
still matches the exact document snapshot read before the request. If another
writer changed it while the request or conversion was in flight, mdhq leaves
that document untouched and restarts the complete update from the latest
snapshot. Retries are bounded to two restarts; repeated contention fails
without overwriting the competing update.

Page responses must have one of these media types:

- `text/html`
- `application/xhtml+xml`

Media type parameters such as `charset` are ignored during comparison. A
missing or unsupported page Content-Type is an error. Response bytes are
currently decoded as UTF-8.

Redirect statuses `301`, `302`, `303`, `307`, and `308` are followed.
Redirects to unsupported schemes are rejected. Non-success final HTTP
statuses are errors.

The response-size limit is enforced from `Content-Length` when available and
again while streaming the response body.

### Headers and credential isolation

Headers supplied by the caller are sent to the initial page origin and
same-origin redirects. All caller-supplied headers are removed after a
cross-origin redirect and are not restored for later requests in that page
operation, including direct retries made against an existing redirect
destination.

In this section, "caller-supplied headers" means entries from CLI `--header`
or library `GetPageOptions.headers`. The separately selected User-Agent is
sent on every redirect and asset request, including cross-origin requests.

mdhq creates its built-in `Accept` and User-Agent headers first, then appends
entries from `--header` or `GetPageOptions.headers`. Supplying `Accept` or
`User-Agent` through the generic header option therefore combines another
value with the built-in or separately configured value rather than replacing
it. Use `--user-agent`, `GetPageOptions.userAgent`, or configuration
`userAgent` when replacement is intended.

Page headers are supplied to same-origin assets. They are not supplied to
cross-origin assets. If the page itself redirected across origins, no
caller-supplied headers are sent to any assets, including assets on the final
page origin. Asset redirects apply the same cross-origin stripping rule.

### Proxies

HTTP requests use Undici's environment-aware proxy agent. Standard uppercase
and lowercase proxy environment variables, including `HTTP_PROXY`,
`HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY`, are handled by that agent.

The proxy-aware fetch function is also passed to Defuddle for asynchronous
extractors.

## Defuddle conversion

mdhq uses `defuddle/node` version `0.19.3`.

The high-level pipeline forces Markdown output. Defuddle asynchronous
extractors are enabled by default and may contact third-party APIs when local
HTML does not contain usable content.

The effective `useAsync` value is selected in this order:

1. `GetPageOptions.useAsync`
2. `config.defuddle.useAsync`
3. Legacy top-level `config.useAsync`
4. `true`

Defuddle's asynchronous extractor requests receive mdhq's environment-aware
proxy dispatcher. They do not automatically receive CLI `--header` values,
`GetPageOptions.headers`, or the selected mdhq User-Agent. mdhq's page and
asset timeout, redirect, and response-size limits are also not wrapped around
those Defuddle-internal requests. Defuddle controls their request headers and
failure behavior.

An empty Defuddle result is a conversion error.

The normalized metadata model includes:

- title
- description
- author
- published date
- site
- domain
- language
- representative image
- favicon
- word count

Not every metadata value is necessarily written to frontmatter.

## URL identity

URL identity is used to decide whether an existing destination represents the
same page.

Identity includes:

- normalized host
- canonical pathname
- one configured entry query key and value, when present and non-empty
- otherwise, the MD5 digest of the ordered query tail when a query remains

Identity ignores:

- the difference between HTTP and HTTPS
- fragments
- query parameters other than a selected non-empty entry key when such a key
  is used

Host normalization:

- lowercases the hostname
- applies IDNA ASCII conversion
- removes trailing DNS root dots from ordinary hostnames
- omits standard ports
- retains non-standard ports

Path normalization:

- splits the path before decoding, so an encoded slash remains within one
  path segment
- removes repeated and trailing path separators for identity comparison
- decodes percent escapes as UTF-8
- treats an unmatched literal percent sign as a literal percent sign
- applies Unicode NFC normalization
- treats a root URL and `/index.html` as the same identity
- removes a final recognized HTML extension for identity comparison
- applies canonical percent encoding for identity comparison

The first non-empty value returned for the configured entry query key is used.
When no non-empty value exists, a remaining query uses the generic query-tail
MD5 identity.

## Source URL normalization

After redirects, mdhq examines `link` elements whose whitespace-separated
`rel` tokens contain `canonical`, case-insensitively.

- Exactly one canonical link must be present.
- A relative canonical is resolved against the document base URL. A valid
  `<base href>` is honored; an invalid base falls back to the final response
  URL.
- The resolved canonical must use HTTP or HTTPS.
- Its normalized origin and canonical pathname must equal those of the final
  response URL. Scheme, normalized host, port, and pathname aliases therefore
  cannot point to another content location.
- An accepted canonical is WHATWG-serialized and has its fragment removed. It
  is not passed through `urlpurify`.

When canonical is absent or rejected, mdhq applies
`urlpurify.stripTrackingParams()` to the final response URL. URL wrapper
unwrapping is not used. The result is validated as HTTP(S), WHATWG-serialized,
and stripped of its fragment. Functional WordPress preview parameters
(`preview`, `preview_id`, and `preview_nonce`) are retained because mdhq
accepts arbitrary page URLs rather than feed URLs only.

The normalized source is used for host/path configuration, storage identity,
destination, and frontmatter. The final response URL is used as the base for
Defuddle conversion, ordinary links, images, and assets, as well as for HTTP
redirect and credential handling. This allows storage-equivalent canonical
aliases such as `/article` and `/article/` without changing relative URL
targets.

Re-fetching a path-divergent canonical target is not currently supported.

## Storage paths

The general layout is:

```text
<root>/<host>/<path>.md
```

Examples:

| URL | Relative destination |
| --- | --- |
| `https://example.com/` | `example.com/index.md` |
| `https://example.com/entry/hoge/` | `example.com/entry/hoge.md` |
| `https://example.com/path/fuga` | `example.com/path/fuga.md` |
| `https://example.com/entry/hoge.html` | `example.com/entry/hoge.md` |
| `https://example.com/entry/hoge.ja.html` | `example.com/entry/hoge.ja.md` |
| `https://example.com/data.json` | `example.com/data.json.md` |
| `https://example.com/file.md` | `example.com/file.md.md` |
| `https://example.com:8443/path` | `example.com_8443/path.md` |
| `https://example.com/日本語` | `example.com/日本語.md` |

The following final extensions are replaced with `.md`, case-insensitively:

- `.html`
- `.htm`
- `.xhtml`
- `.php`
- `.asp`
- `.aspx`
- `.jsp`
- `.jspx`

Every other filename receives an additional `.md` suffix.

### Entry query keys

When `entryQueryKey` selects a non-empty query value, the original final path
element becomes a directory and the query value becomes the Markdown
filename:

```text
https://example.com/blog/blog.php?entry_id=123
-> example.com/blog/blog.php/123.md
```

Other query parameters and the fragment do not affect the destination when a
non-empty entry value is selected.

Entry values are inspected in URL order and the first non-empty value is used,
so percent escapes are decoded and `+` is interpreted as a space. The
resulting value then uses the same NFC normalization, unsafe-character
encoding, reserved-name handling, 240-byte limit, and MD5 fallback as a URL
path segment. A slash in the query value becomes `%2F` inside the filename and
never creates another directory.

### Generic query destinations

When a normalized source retains a query and has no usable configured entry
value, mdhq creates a lowercase 32-character MD5 digest from UTF-8 bytes. Query
parameter order is preserved.

For a pathname not ending in `/`, the digest input is the final raw pathname
segment followed by the serialized query including `?`:

```text
https://example.com/path/to.php?id=123
MD5 input: to.php?id=123
-> example.com/path/<md5>.md
```

For a pathname ending in `/`, the digest input is only the serialized query:

```text
https://example.com/path/to/?id=123
MD5 input: ?id=123
-> example.com/path/to/<md5>.md
```

If canonical selection or tracking cleanup removes the complete query, the
normal queryless destination rules apply.

### Safe path segments

Each URL path segment is decoded independently and normalized to NFC.

The following are encoded as uppercase `%HH` UTF-8 bytes:

- `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, and `|`
- NUL, control characters, and DEL
- literal percent signs
- a trailing space or period

An encoded slash such as `%2F` is therefore retained as `%2F` inside one
filesystem segment rather than becoming a directory separator.

The complete `.` and `..` names and Windows reserved device names such as
`CON`, `NUL`, `COM1`, and `LPT1` are entirely percent-encoded.

IPv6 host colons are replaced with underscores while brackets preserve the
host boundary. A non-standard IPv6 port is appended after an underscore.
Special hostnames such as `.` and `..` use the same safe-segment encoding and
cannot escape the selected storage root. The final resolved destination is
also checked to ensure it remains below that root. Existing directory
components below the root must not be symbolic links or Windows junctions;
mdhq rejects them with `PATH_COLLISION` instead of following them outside
the storage tree.

`_assets` is reserved at the storage root. A normalized host that conflicts
with this name is rejected.

### Length limits

A generated host, directory, or filename segment is replaced by its MD5
digest when it would exceed 240 bytes, including the `.md` suffix for a
filename.

On Windows, the complete absolute path target is 240 UTF-16 code units. On
other platforms, the target is 1000 UTF-8 bytes. The longest generated
segments are progressively replaced with MD5 digests until the path fits. If
hashing every eligible segment is insufficient because the root itself is too
long, path generation fails with `PATH_TOO_LONG`.

The Windows limit can reject unusually deep URLs even after every useful
segment has been shortened. The resulting error identifies both the URL and
the final attempted path.

## Markdown normalization

Defuddle output is parsed as an mdast tree with GitHub Flavored Markdown
extensions and serialized again after transformation. Tables,
strikethrough, task lists, and GFM autolinks are preserved. The output follows
the serializer's canonical Markdown formatting rather than preserving
Defuddle's exact whitespace.

For ordinary links:

- relative URLs are resolved against the final response URL
- absolute URLs are retained
- fragment-only links are retained
- reference-style link definitions are resolved and normalized

For images:

- relative destinations are resolved against the final response URL
- reference-style image definitions are resolved and localized
- absolute image URLs are collected for asset localization
- duplicate source URLs are fetched once
- successful downloads replace image destinations with relative local paths
- failed downloads leave the absolute source URL unchanged
- non-HTTP(S) images such as `data:` URLs are left unchanged and do not
  produce asset warnings

Asset localization is enabled by default. It can be disabled with the
top-level configuration field `assets: false`, library option
`GetPageOptions.assets: false`, or CLI option `--no-assets`. The library
option and CLI option take precedence over configuration. When disabled,
HTTP(S) image destinations are kept as absolute URLs, the result `assets`
array is empty, and `_assets` is not created.

mdhq does not rewrite ordinary links to other locally stored Markdown
files.

## Assets

Assets are stored under:

```text
<root>/_assets/<sha256-of-content>.<extension>
```

The digest component is calculated from the complete fetched response body
after redirects. The extension is selected from Content-Type, falling back to
the final URL pathname when Content-Type is missing. Identical bytes therefore
share the same digest, while differing media metadata can still select a
different extension.

Downloaded asset candidates are:

- image destinations present in Defuddle's Markdown output
- the representative article image from Defuddle metadata

favicon, CSS background images, video, audio, and images removed by Defuddle
are not discovered by mdhq.

Recognized Content-Type mappings:

| Content-Type | Extension |
| --- | --- |
| `image/avif` | `.avif` |
| `image/gif` | `.gif` |
| `image/jpeg` | `.jpg` |
| `image/png` | `.png` |
| `image/svg+xml` | `.svg` |
| `image/webp` | `.webp` |

Other explicit `image/*` responses use a safe final-URL extension when one is
available, otherwise `.bin`. A missing Content-Type is accepted only when the
final URL ends in one of the recognized generated extensions or the common
`.jpeg` and `.jfif` aliases. An explicitly non-image Content-Type is rejected
even when the URL looks like an image.

Up to six assets are fetched concurrently. Result ordering still follows the
first occurrence in the document.

Asset paths are immutable and content-addressed by the SHA-256 digest of the
fetched bytes. Content is first written completely to a same-directory
temporary file and a new destination is published without replacing an
existing file. When the deterministic path already exists, identical content
is reported as `reused`; differing content is treated as a digest collision
and reported as an asset failure.

Reusable HTTP validators are stored separately under:

```text
<root>/_assets/.cache/<sha256-of-complete-source-url>.json
```

The cache key includes the complete normalized source URL, including its query
string. Query variants and otherwise unrelated source URLs are therefore
validated independently, while identical response bytes still converge on the
same content-addressed asset path when they select the same extension.

When an exact source URL is encountered again, mdhq sends its cached ETag as
`If-None-Match`, or its cached Last-Modified value as `If-Modified-Since`. A
`304 Not Modified` response reuses the cached asset path. A `200` response is
hashed normally, so changed bytes produce a new immutable asset path and
unchanged bytes reuse the existing one.

Asset validators are retained only when the response has no `Vary` fields, the
request has no Authorization or Cookie header, and the request did not
redirect. Requests or responses with `Cache-Control: no-store` are not cached.
Caller-supplied conditional headers are not forwarded as asset validators.
Invalid cache metadata is reported as an `ASSET_CACHE_INVALID` warning. A
malformed regular cache file is replaced after a successful cacheable
response; an invalid non-file entry disables caching for that URL without
preventing the image from being localized.

When an article update receives `304 Not Modified`, asset localization is
skipped together with HTML conversion. Images are revalidated when the article
itself returns a new `200` response.

An individual asset failure:

- does not prevent the Markdown file from being saved
- produces an `ASSET_FETCH_FAILED` warning
- produces an asset result with `status: "failed"`
- leaves the original absolute image URL in Markdown

All errors raised while fetching, validating, or saving an individual asset
are caught by the asset-localization stage and converted to this non-fatal
result. This includes timeouts, redirect failures, HTTP errors, response-size
limits, unsupported media types, and filesystem errors for that asset.

When the representative image is saved successfully, it is downloaded into
`_assets` like other localized images even though it is not necessarily
referenced from the Markdown body. When it fails, the failure produces an
`ASSET_FETCH_FAILED` warning and a `"failed"` asset result like any other
image. mdhq does not write the representative image or its source URL to
frontmatter.

Updates do not delete unreferenced assets.

## Frontmatter

Documents use YAML frontmatter followed by one blank line and the normalized
Markdown body.

Metadata fields are emitted when non-empty:

- `title`
- `description`
- `author`
- `published`
- `updated`
- `language`

mdhq-controlled fields:

- `source`: normalized source URL
- `requested_url`: fragment-free serialized original URL, only when different
  from `source`
- `created`: initial local acquisition time
- `modified`: time of the latest meaningful Markdown note change
- `etag`: HTTP ETag stored verbatim, when supplied
- `last_modified`: HTTP Last-Modified converted to RFC 3339 UTC, when valid

`created` and `modified` are both written on initial acquisition and use
local-offset RFC 3339 timestamps with second-level precision. A valid existing
`created` string is preserved verbatim during an update, including its
original UTC offset. `modified` changes only when the normalized Markdown body
or user-facing frontmatter changes; HTTP 304 responses and validator-only
updates preserve it.

`published` and `updated` are source-article metadata, normalized through the
same rules. `updated` is extracted from Schema.org `dateModified`,
`article:modified_time` / `og:updated_time` meta tags, or
`itemprop="dateModified"` microdata. `published` is extracted the same way
from Schema.org `datePublished`, `article:published_time` /
`og:published_time` meta tags, or `itemprop="datePublished"` microdata, with
Defuddle's own (string-only) extraction used as a fallback when no such
metadata is present. Schema.org selection prefers an entity linked to the
current page through `url`, `@id`, `mainEntity`, or `mainEntityOfPage`;
concrete Article and Posting types rank ahead of generic WebPage and
CreativeWork fallbacks, independently of graph order.
The `published` field represents the initial publication date. Explicit
publication timestamps are preserved only when they come from
publication-specific metadata; modification or event timestamps are not
publication evidence. If Defuddle synthesizes a midnight UTC timestamp from
visible date-only text, unrelated same-day datetime metadata does not prevent
mdhq from returning `YYYY-MM-DD`.

Source-date normalization accepts the following inputs and, for each, always
produces exactly one of two canonical forms: `YYYY-MM-DD` when only a
calendar date is reliably known, or an RFC 3339 date-time with an explicit
`Z` or numeric offset and second-level precision (fractional seconds are
dropped):

- `YYYY-MM-DD`, and compact `YYYYMMDD` (recognized as a date before being
  considered as a numeric epoch).
- RFC 3339 date-times with an explicit `Z` or numeric UTC offset. A space is
  accepted instead of `T` only when an explicit offset is also present. An
  offset without a colon (`+0900`) is accepted and normalized to the colon
  form (`+09:00`). A supplied offset is preserved rather than converted to
  UTC.
- Local date-times without any UTC offset. Since no offset can be inferred
  reliably, these are reduced to their `YYYY-MM-DD` calendar date instead of
  inventing an offset such as `+00:00`.
- Unambiguous English month-name date text, such as `August 31, 2026` or
  `31 August 2026`, represented as `YYYY-MM-DD`.
- Unix epoch values, as JSON numbers or numeric strings, in seconds,
  milliseconds, microseconds, or nanoseconds. The unit is inferred from the
  number of significant digits (roughly 6-10 digits for seconds, 11-13 for
  milliseconds, 14-16 for microseconds, and 17-19 for nanoseconds); values
  outside of these ranges are rejected instead of being guessed at, so
  arbitrary numeric identifiers are not mistaken for dates. Microsecond and
  nanosecond values are scaled using integer arithmetic to avoid floating-
  point precision loss. Epoch-derived output always uses `Z`.
- JSON-LD value objects (`{"@value": "...", "@type": "...#dateTime"}`): the
  `@value` is normalized recursively regardless of `@type`.
- JSON-LD arrays: candidates are tried in their original order and the first
  one that normalizes successfully is used.

mdhq never guesses at ambiguous input: slash-separated numeric dates (such as
`09/02/2026`), unrecognized timezone abbreviations, and the machine's local
timezone are all rejected rather than assumed. Invalid calendar dates and
times (such as February 30 or an hour of 24) are rejected outright instead of
relying on JavaScript `Date` rollover. Malformed or unsupported JSON-LD
shapes normalize to `undefined` rather than throwing.

This normalization is unrelated to `last_modified`, which remains an
HTTP-protocol-specific conversion of the `Last-Modified` response header to
RFC 3339 UTC.

The Markdown body uses LF line endings, has trailing whitespace removed, and
ends with exactly one LF. mdhq internally calculates a SHA-256 digest from the
UTF-8 bytes of that normalized body for comparison, concurrency, and status
logic. Frontmatter, delimiters, and the blank line between frontmatter and
body are excluded, and the digest is not stored in frontmatter.

Configured exclusions and values are applied before mdhq-controlled fields.
Consequently `source`, `requested_url`, `created`, `modified`, `etag`, and
`last_modified` cannot be removed or overridden by frontmatter configuration.
`content_digest` and `vary` are always removed from serialized frontmatter.
Other fields, including extracted metadata and `type`, can be excluded or
replaced. mdhq does not emit `type`, `site`, `domain`, `image`,
`image_source`, or `word_count` by default; any of them can be added with
`frontmatter.values`. Refreshing an existing file removes `site`, `domain`,
`image`, `image_source`, and `word_count` when they are still present from a
file saved by an earlier mdhq version, unless `frontmatter.values` explicitly
supplies them again.

## Existing files and concurrent writes

An existing Markdown file is recognized only when it starts with parseable
YAML frontmatter containing a string `source` field.

Without `update`:

- content is written completely to a same-directory temporary file
- the destination is published with an atomic hard link and
  exclusive-create semantics
- a same-identity existing file returns `skipped`
- a different identity or an unrecognized existing file returns
  `PATH_COLLISION`
- a file created by another process during the write is reread and classified
  using the same rules

With `update`:

- all mdhq writes to the same destination are serialized by a transient
  cross-process lock
- a missing destination is still created exclusively
- an existing same-identity document is written to a temporary file in the
  same directory and replaced with an atomic rename
- the exact serialized snapshot read before fetching is checked again while
  holding the destination lock
- a conflicting same-identity write restarts the complete update from the
  latest snapshot, with at most two restarts
- a different-identity destination returns `PATH_COLLISION`
- an HTTP 304 or a 200 response with unchanged normalized Markdown body and
  user-facing frontmatter
  returns `unchanged`
- a 200 response with a changed normalized Markdown body or user-facing
  frontmatter returns `updated`
- temporary files are removed after success or failure

Lock directories are removed when the write completes. Stale locks left by a
terminated process are recovered by the lock implementation. A writer waits
up to 60 seconds for a healthy writer holding the same destination lock before
returning a storage error.

Initial Markdown and asset publication requires filesystem hard-link support.
This is supported by standard Windows NTFS volumes and common Linux and macOS
filesystems. mdhq returns a storage or asset error rather than degrading to
a partially visible copy on a filesystem that rejects hard links.

Simultaneous mdhq updates of the same destination use compare-and-swap
semantics: a writer can commit only while the destination still matches the
snapshot that authorized its fetch. Localized assets are immutable and
content-addressed, so a losing update cannot replace bytes referenced by the
winning document. Programs that modify storage files directly do not
participate in mdhq's lock protocol and should not edit a destination while an
mdhq write is in progress.

## Warnings and errors

Warnings are non-fatal and are returned in `GetPageResult.warnings`. The CLI
also writes them to stderr.

Current warning codes:

- `UNKNOWN_CONFIG_KEY`
- `ASSET_FETCH_FAILED`
- `INVALID_IMAGE_URL`
- `INVALID_LAST_MODIFIED`

Fatal library errors are instances of `MdhqError`. See
[Library API reference](library-api.md#error-model) for the current codes.

## Current limitations

- Only HTML and XHTML page responses are accepted.
- Page bytes are decoded as UTF-8 without HTML charset sniffing.
- No headless browser is included.
- No Markdown, PDF, JSON, or image page import is implemented.
- No local-link conversion between saved Markdown documents is implemented.
- No asset garbage collection is implemented.
- No multi-URL CLI mode is implemented.
- Images and links embedded inside raw HTML Markdown nodes are not rewritten
  or localized.
- Initial file publication is unsupported on filesystems without hard-link
  support.
- Case-sensitive URL paths that differ only by letter case collide on
  case-insensitive filesystems such as default Windows NTFS and many macOS
  volumes. The second URL is rejected with `PATH_COLLISION`.
