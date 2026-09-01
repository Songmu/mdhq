# markhq

`markhq` saves web pages as Markdown in a ghq-inspired filesystem layout. It
uses Defuddle for content extraction and keeps all state in Markdown and asset
files rather than a database.

## Requirements

- Node.js 22 or newer

## Installation

```sh
npm install --global markhq
```

## CLI

```sh
markhq get https://example.com/article
markhq get --update https://example.com/article
markhq get --json --header 'Cookie: session=value' https://example.com/article
```

By default, successful commands print only the absolute Markdown path to
stdout. Warnings are written to stderr. `--json` returns the requested URL,
final source URL, Markdown path, status, downloaded assets, and warnings.

The storage root is selected in this order:

1. `--root`
2. `MARKHQ_ROOT`
3. `root` in the configuration file
4. `$XDG_DATA_HOME/markhq`, or `~/.local/share/markhq`

The configuration file is
`$XDG_CONFIG_HOME/markhq/config.json`, or
`~/.config/markhq/config.json`.

```json
{
  "root": "/path/to/markhq",
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
import { convertHtml, getPage } from "markhq";

const converted = await convertHtml({
  html,
  url: "https://example.com/article"
});

const saved = await getPage({
  url: "https://example.com/article",
  root: "/path/to/markhq"
});
```

`convertHtml` performs extraction without fetching or writing files.
`getPage` fetches, converts, localizes images, adds frontmatter, and saves the
document.

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
```
