# SearXNG MCP Server

An [MCP server](https://modelcontextprotocol.io/introduction) that integrates the [SearXNG](https://docs.searxng.org) API, giving AI assistants web search and URL reading capabilities.

Repository: [github.com/tterrasson/mcp-searxng](https://github.com/tterrasson/mcp-searxng)

## Quick Start

Install dependencies and build the server with Bun:

```bash
bun install
bun run build
```

Add the built server to your MCP client configuration, replacing the path with your local clone:

```json
{
  "mcpServers": {
    "searxng": {
      "command": "bun",
      "args": ["/absolute/path/to/mcp-searxng/dist/index.js"],
      "env": {
        "SEARXNG_URL": "YOUR_SEARXNG_INSTANCE_URL"
      }
    }
  }
}
```

Replace `YOUR_SEARXNG_INSTANCE_URL` with the URL of your SearXNG instance, for example `https://search.example.com`.

## Features

- **Web Search**: General queries, news, articles, with pagination.
- **URL Content Reading**: Content extraction with pagination, section filtering, and heading extraction.
- **Intelligent Caching**: URL content is cached with TTL to improve performance and reduce redundant requests.
- **Pagination**: Control which page of results to retrieve.
- **Time Filtering**: Filter results by time range: day, month, or year.
- **Language Selection**: Filter results by preferred language.
- **Safe Search**: Control the search result filtering level.

## How It Works

`mcp-searxng` is a standalone MCP server that runs with Bun. Your AI assistant connects to it through the MCP protocol, and the server queries any SearXNG instance through its HTTP JSON API.

> **Not a SearXNG plugin:** This project cannot be installed as a native SearXNG plugin. Point it at an existing SearXNG instance by setting `SEARXNG_URL`.

```text
AI Assistant
        |  MCP protocol
        v
  mcp-searxng  (this project, Bun process)
        |  HTTP JSON API (SEARXNG_URL)
        v
  SearXNG instance
```

## Tools

### web_search

Execute web searches with pagination.

Inputs:

- `query` (string): The search query. This string is passed to external search services.
- `pageno` (number, optional): Search page number, starts at 1. Default: `1`.
- `time_range` (string, optional): Filter results by time range. One of `day`, `month`, `year`.
- `language` (string, optional): Language code for results, for example `en`, `fr`, `de`, or `all`. Default: `all`.
- `safesearch` (number, optional): Safe search filter level, where `0` is none, `1` is moderate, and `2` is strict. Defaults to the SearXNG instance setting.

### web_url_read

Read and convert the content from a URL to Markdown.

Inputs:

- `url` (string): The URL to fetch and process.
- `startChar` (number, optional): Starting character position for content extraction. Default: `0`.
- `maxLength` (number, optional): Maximum number of characters to return.
- `section` (string, optional): Extract content under a specific heading.
- `paragraphRange` (string, optional): Return specific paragraph ranges, for example `1-5`, `3`, or `10-`.
- `readHeadings` (boolean, optional): Return only a list of headings instead of full content.

## Installation

This fork is intended to run with [Bun](https://bun.sh).

```bash
git clone https://github.com/tterrasson/mcp-searxng.git
cd mcp-searxng
bun install
bun run build
```

Use `bun dist/index.js` in MCP clients after building.

For local development, you can run the TypeScript entrypoint directly:

```bash
SEARXNG_URL=http://localhost:8080 bun src/index.ts
```

## HTTP Transport

By default the server uses STDIO. Set `MCP_HTTP_PORT` to enable HTTP mode:

```json
{
  "mcpServers": {
    "searxng-http": {
      "command": "bun",
      "args": ["/absolute/path/to/mcp-searxng/dist/index.js"],
      "env": {
        "SEARXNG_URL": "YOUR_SEARXNG_INSTANCE_URL",
        "MCP_HTTP_PORT": "3000"
      }
    }
  }
}
```

Endpoints:

- `POST/GET/DELETE /mcp`: MCP protocol
- `GET /health`: health check

Run it locally:

```bash
MCP_HTTP_PORT=3000 SEARXNG_URL=http://localhost:8080 bun dist/index.js
curl http://localhost:3000/health
```

## Configuration

Set `SEARXNG_URL` to your SearXNG instance URL. All other variables are optional.

Full environment variable reference: [CONFIGURATION.md](CONFIGURATION.md)

## Troubleshooting

### 403 Forbidden from SearXNG

Your SearXNG instance likely has JSON format disabled. Edit `settings.yml`, usually `/etc/searxng/settings.yml`:

```yaml
search:
  formats:
    - html
    - json
```

Restart your SearXNG service, then verify:

```bash
curl 'http://localhost:8080/search?q=test&format=json'
```

You should receive a JSON response. If not, confirm the file is correctly loaded and YAML indentation is valid.

See also: [SearXNG settings docs](https://docs.searxng.org/admin/settings/settings.html) and [SearXNG discussion #1789](https://github.com/searxng/searxng/discussions/1789).

## Development

```bash
bun install
bun run build
bun run lint
bun test tests
```

Use the MCP inspector:

```bash
bun run inspector
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE) for details.
