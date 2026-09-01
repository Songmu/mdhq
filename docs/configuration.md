# Configuration reference

markhq reads one optional JSON configuration file.

Default location:

```text
$XDG_CONFIG_HOME/markhq/config.json
```

When `XDG_CONFIG_HOME` is unset:

```text
~/.config/markhq/config.json
```

The library can select another file with `GetPageOptions.configPath`.
The CLI does not currently expose a configuration-path option.

A missing configuration file is accepted. An unreadable file, malformed
JSON, a non-object top-level value, or an invalid known value is a fatal
`CONFIG_ERROR`.

Unknown keys are accepted and reported with `UNKNOWN_CONFIG_KEY` warnings.
This applies at the top level and within `defuddle`, `frontmatter`, host
configuration, and path configuration objects.

## Complete example

```json
{
  "root": "/data/markhq",
  "userAgent": "my-clipper/1.0",
  "timeoutMs": 30000,
  "maxResponseBytes": 20971520,
  "maxRedirects": 10,
  "assets": false,
  "useAsync": true,
  "defuddle": {
    "removeSmallImages": true,
    "standardize": true,
    "language": "en"
  },
  "frontmatter": {
    "exclude": ["description"],
    "values": {
      "collection": "reading",
      "reviewed": false
    }
  },
  "hosts": {
    "*.example.com": {
      "entryQueryKey": "entry_id",
      "paths": {
        "/articles/*.php": {
          "entryQueryKey": "id"
        },
        "/search/*": {
          "entryQueryKey": null
        }
      }
    }
  }
}
```

## Top-level fields

| Field | Type | Description |
| --- | --- | --- |
| `root` | string | Default storage root. |
| `userAgent` | string | Default page and asset User-Agent. |
| `timeoutMs` | positive integer | Timeout in milliseconds for each markhq HTTP request attempt. |
| `maxResponseBytes` | positive integer | Maximum buffered bytes for each page or asset response. |
| `maxRedirects` | non-negative integer | Maximum redirect count for each page or asset request. |
| `assets` | boolean | Download images into `_assets`; defaults to `true`. |
| `useAsync` | boolean | Legacy fallback for Defuddle asynchronous extractors. |
| `defuddle` | object | Defuddle extraction options. |
| `frontmatter` | object | Frontmatter exclusions and configured values. |
| `hosts` | object | Host and pathname-specific entry query configuration. |

## Storage root precedence

The effective root is selected in this order:

1. CLI `--root` or library `GetPageOptions.root`
2. `MARKHQ_ROOT`
3. configuration `root`
4. `$XDG_DATA_HOME/markhq`
5. `~/.local/share/markhq` when `XDG_DATA_HOME` is unset

The selected root is converted to an absolute path.

## HTTP option precedence

For each setting, a defined `GetPageOptions` value overrides configuration.
Otherwise configuration overrides the built-in default.

| Library option | Configuration field | Built-in default |
| --- | --- | --- |
| `userAgent` | `userAgent` | markhq version User-Agent |
| `timeoutMs` | `timeoutMs` | `30000` |
| `maxResponseBytes` | `maxResponseBytes` | `20971520` |
| `maxRedirects` | `maxRedirects` | `10` |

The CLI `--user-agent` option is passed as `GetPageOptions.userAgent` and
therefore overrides configuration `userAgent`.

The CLI `--no-assets` option passes `GetPageOptions.assets: false` and
therefore overrides configuration `assets`. When asset localization is
disabled, image destinations remain absolute URLs, the result contains no
asset entries, and markhq does not create `_assets`.

Generic CLI `--header` values and library `headers` values are appended after
markhq creates its `Accept` and User-Agent headers. A generic `User-Agent` or
`Accept` entry is combined with the existing value; it does not replace it.
Use the dedicated User-Agent option for replacement.

`GetPageOptions.headers` has no configuration equivalent. This prevents
credentials such as cookies or authorization tokens from being stored in the
configuration file.

## Defuddle options

Supported `defuddle` fields:

| Field | Type |
| --- | --- |
| `debug` | boolean |
| `removeExactSelectors` | boolean |
| `removePartialSelectors` | boolean |
| `removeImages` | boolean |
| `useAsync` | boolean |
| `removeHiddenElements` | boolean |
| `removeLowScoring` | boolean |
| `removeSmallImages` | boolean |
| `standardize` | boolean |
| `removeContentPatterns` | boolean |
| `contentSelector` | string |
| `language` | string |
| `includeReplies` | boolean or `"extractors"` |
| `profile` | boolean |

markhq always enables Defuddle Markdown output and supplies its own
proxy-aware fetch implementation. Those values are not configurable through
the JSON file.

The supplied fetch implementation adds environment proxy handling only.
Defuddle-internal asynchronous requests do not inherit markhq generic
headers, the configured markhq User-Agent, or markhq's timeout,
response-size, and redirect limits.

The effective asynchronous-extractor setting is:

1. `GetPageOptions.useAsync`
2. `defuddle.useAsync`
3. top-level `useAsync`
4. `true`

## Frontmatter configuration

`frontmatter.exclude` is an array of field names to remove from extracted or
derived metadata.

`frontmatter.values` is an object of scalar fixed values. Accepted values are
strings, numbers, booleans, and `null`.

Application order:

1. Add extracted metadata and representative-image fields.
2. Remove fields listed in `exclude`.
3. Apply fields from `values`.
4. Add protected markhq fields.

Protected fields are:

- `source`
- `requested_url`
- `type`
- `created`
- `modified`

Protected fields cannot be removed or overridden by configuration.

## Host and path matching

`hosts` is an object whose keys are exact host strings or minimatch glob
patterns.

Before matching, URL hosts are lowercased, converted to IDNA ASCII, and
normalized for trailing DNS dots and ports. Host patterns are also lowercased
and literal labels are converted to IDNA ASCII. Explicit ports in patterns
are retained. A pattern such as `example.com:443` therefore matches an
explicit non-standard HTTP port 443, while an HTTPS URL using its standard
port matches `example.com`.

Selection order:

1. A normalized exact match.
2. The matching glob with the greatest number of fixed literal characters.
3. No host configuration.

If multiple matching patterns have equal specificity, processing fails with
`CONFIG_ERROR`. Multiple patterns that normalize to the same exact host are
also an error.

After selecting a host, `paths` is matched against the URL's encoded
`pathname` using the same exact-then-most-specific policy. Path patterns are
not IDNA- or Unicode-normalized.

## Entry query key inheritance

`entryQueryKey` selects the only query parameter that contributes to URL
identity and the storage path.

Rules:

- A host-level value applies to all paths by default.
- A matching path-level string overrides the host value.
- A matching path-level `null` disables the host value.
- A matching path object that omits `entryQueryKey` inherits the host value.
- A missing or empty parameter value falls back to normal path-based storage.
- All non-selected query parameters are ignored.
