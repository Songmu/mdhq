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

The executable provides two subcommands:

```text
mdhq get [options] <url>
mdhq list [options]
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

## Processing pipeline

`getPage` performs the following operations:

1. Validate that the requested URL uses HTTP or HTTPS.
2. Load the JSON configuration and collect unknown-key warnings.
3. Resolve the storage root and host/path-specific entry query key.
4. Check whether the requested URL already has a same-identity destination.
5. Fetch the page when it cannot be skipped before network access.
6. Resolve the final URL after redirects and recalculate configuration and
   destination from that URL.
7. Check the final destination for another same-identity skip.
8. Convert the fetched HTML to Markdown with Defuddle.
9. Normalize ordinary links and discover image links.
10. Download supported images and rewrite successful image destinations.
11. Normalize the Markdown body and calculate its SHA-256 content digest.
12. Build YAML frontmatter.
13. Save the Markdown with collision-safe create or update behavior.

The final URL determines the destination and the `source` frontmatter field.
The original URL is retained as `requested_url` only when it differs from the
final URL.

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

1. Send `If-None-Match` when frontmatter contains `etag`.
2. Otherwise send `If-Modified-Since` when frontmatter contains a valid
   `last_modified`.
3. Otherwise perform an ordinary GET.

Automatic validators are sent only on the first request and are not forwarded
after redirects. When a stored validator is available, it replaces any
caller-provided `If-None-Match` or `If-Modified-Since` value so that an HTTP
304 always corresponds to the saved document. A 304 received without a stored
validator is an error.

An HTTP 304 response preserves the existing Markdown body, skips conversion
and asset downloads, updates `modified`, and returns `unchanged`. A 200
response replaces stored validators with the response values; validators that
are absent from a 200 response are removed.

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
operation.

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

Identity ignores:

- the difference between HTTP and HTTPS
- fragments
- all query parameters except the selected entry query key

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

The first value returned for the configured entry query key is used. A missing
or empty value causes the URL to use its normal path-based identity.

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

Other query parameters and the fragment do not affect the destination.

The query value comes from `URLSearchParams.get`, so percent escapes are
decoded and `+` is interpreted as a space. The resulting value then uses the
same NFC normalization, unsafe-character encoding, reserved-name handling,
240-byte limit, and MD5 fallback as a URL path segment. A slash in the query
value becomes `%2F` inside the filename and never creates another directory.

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

- relative URLs are resolved against the final page URL
- absolute URLs are retained
- fragment-only links are retained
- reference-style link definitions are resolved and normalized

For images:

- relative destinations are resolved against the final page URL
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
HTTP(S) image destinations are kept as absolute URLs, the representative
image remains an absolute frontmatter URL, the result `assets` array is empty,
and `_assets` is not created.

mdhq does not rewrite ordinary links to other locally stored Markdown
files.

## Assets

Assets are stored under:

```text
<root>/_assets/<md5-of-final-url>.<extension>
```

The hash input is the complete final asset URL after redirects, including its
query string.

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

Asset content is first written completely to a same-directory temporary file.
A new destination is published without replacing an existing file. When the
deterministic path already exists, its bytes are compared with the fetched
content. Identical content is reported as `reused`; differing content is
atomically replaced and reported as `saved`.

An individual asset failure:

- does not prevent the Markdown file from being saved
- produces an `ASSET_FETCH_FAILED` warning
- produces an asset result with `status: "failed"`
- leaves the original absolute image URL in Markdown

All errors raised while fetching, validating, or saving an individual asset
are caught by the asset-localization stage and converted to this non-fatal
result. This includes timeouts, redirect failures, HTTP errors, response-size
limits, unsupported media types, and filesystem errors for that asset.

When the representative image is saved successfully, frontmatter `image`
contains its local relative path and `image_source` contains the original
absolute URL. When it fails, `image` remains the absolute URL and
`image_source` is omitted.

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
- `site`
- `domain`
- `language`
- `word_count`
- `image`
- `image_source`

mdhq-controlled fields:

- `source`: final page URL
- `requested_url`: original URL, only when different from `source`
- `created`: initial local acquisition time
- `modified`: latest successful acquisition or HTTP revalidation time
- `content_digest`: SHA-256 digest of the normalized Markdown body
- `etag`: HTTP ETag stored verbatim, when supplied
- `last_modified`: HTTP Last-Modified converted to RFC 3339 UTC, when valid

`created` and `modified` are both written on initial acquisition and use
local-offset RFC 3339 timestamps with second-level precision. A valid existing
`created` string is preserved verbatim during an update, including its
original UTC offset.

`published` and `updated` are source-article metadata. Instants are normalized
to RFC 3339 with second precision; genuinely date-only values remain
`YYYY-MM-DD`. `updated` is extracted from Schema.org `dateModified`, article
or Open Graph modification metadata, or `itemprop="dateModified"`.

The Markdown body uses LF line endings, has trailing whitespace removed, and
ends with exactly one LF. `content_digest` is calculated from the UTF-8 bytes
of that normalized body only. Frontmatter, delimiters, and the blank line
between frontmatter and body are excluded.

Configured exclusions and values are applied before mdhq-controlled fields.
Consequently `source`, `requested_url`, `created`, `modified`,
`content_digest`, `etag`, and `last_modified` cannot be removed or overridden
by frontmatter configuration. Other fields, including extracted metadata,
`image`, and `type`, can be excluded or replaced. mdhq does not emit `type` by
default; it can be added with `frontmatter.values`.

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

- a missing destination is still created exclusively
- a concurrently created same-identity destination returns `skipped`
- a concurrently created different-identity destination returns
  `PATH_COLLISION`
- an existing same-identity document is written to a temporary file in the
  same directory and replaced with an atomic rename
- an HTTP 304 or a 200 response with an unchanged normalized Markdown body
  returns `unchanged`
- a 200 response with a changed normalized Markdown body returns `updated`
- the identity is checked again immediately before replacement
- temporary files are removed after success or failure

No persistent lock files are created.

Initial Markdown and asset publication requires filesystem hard-link support.
This is supported by standard Windows NTFS volumes and common Linux and macOS
filesystems. mdhq returns a storage or asset error rather than degrading to
a partially visible copy on a filesystem that rejects hard links.

Simultaneous updates of the same URL identity are allowed. Each replacement
is atomic, but mdhq does not provide compare-and-swap semantics between
same-identity writers. The last successful rename determines the final
document.

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
