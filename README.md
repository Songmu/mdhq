# mdhq

`mdhq` saves web pages as Markdown in a ghq-inspired filesystem layout. It
uses Defuddle for content extraction and keeps all state in Markdown and asset
files rather than a database.

## Requirements

- Node.js 22 or newer

## Installation

```sh
npm install --global mdhq
```

## CLI

```sh
mdhq get https://example.com/article
mdhq get --update https://example.com/article
mdhq get --no-assets https://example.com/article
mdhq get --json --header 'Cookie: session=value' https://example.com/article
mdhq list
mdhq list --full-path
mdhq root
```

`mdhq get` prints the absolute Markdown path to stdout by default. Warnings
are written to stderr. `--json` returns the requested URL, final source URL,
Markdown path, status, downloaded assets, and warnings.

`mdhq list` recursively lists `.md` files below the storage root, one per
line, in sorted root-relative form. Use `-p` or `--full-path` to print absolute
paths. Directory symbolic links are not followed.

`mdhq root` prints the absolute effective storage root.

The storage root is selected in this order:

1. `--root`
2. `MDHQ_ROOT`
3. `root` in the configuration file
4. `$XDG_DATA_HOME/mdhq`, or `~/.local/share/mdhq`

The configuration file is
`$XDG_CONFIG_HOME/mdhq/config.json`, or
`~/.config/mdhq/config.json`.

```json
{
  "root": "/path/to/mdhq",
  "assets": false,
  "useAsync": true,
  "frontmatter": {
    "exclude": ["description"],
    "values": {
      "collection": "reading"
    }
  },
  "hosts": {
    "*.example.com": {
      "entryQueryKey": "entry_id",
      "paths": {
        "/search/*": {
          "entryQueryKey": null
        }
      }
    }
  }
}
```

Exact host and path patterns take precedence over globs. Among matching globs,
the pattern with the longest literal portion wins. Equally specific matching
patterns are rejected.

## Library API

```ts
import { convertHtml, getPage } from "mdhq";

const converted = await convertHtml({
  html,
  url: "https://example.com/article"
});

const saved = await getPage({
  url: "https://example.com/article",
  root: "/path/to/mdhq",
  assets: false
});
```

`convertHtml` performs extraction without fetching or writing files.
`getPage` fetches, converts, optionally localizes images, adds frontmatter,
and saves the document. Set `assets: false` or use `--no-assets` to keep
absolute image URLs without creating `_assets`.

## Documentation

- [Current specification](docs/specification.md)
- [Configuration reference](docs/configuration.md)
- [Library API reference](docs/library-api.md)

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
npm run test:package
```

CI runs the same checks on Linux, Windows, and macOS.
