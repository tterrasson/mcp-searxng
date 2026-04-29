# Contributing to mcp-searxng

We welcome contributions! Follow these guidelines to get started.

## Getting Started

```bash
git clone https://github.com/YOUR_USERNAME/mcp-searxng.git
cd mcp-searxng
bun install
```

## Development Workflow

```bash
bun run watch   # Watch mode — rebuilds on file changes
bun run build   # One-off build
```

## Coding Standards

- Use TypeScript with strict type safety
- Follow existing error handling patterns
- Write concise, informative error messages
- Include unit tests for new functionality
- Maintain 80%+ test coverage
- Test with MCP inspector before submitting
- Run evals to verify functionality

## Testing

```bash
bun test tests            # Run all tests
bun run test:coverage     # Generate coverage report
```

## Submitting a PR

```bash
git checkout -b feature/your-feature-name
# Make changes in src/
bun run build
bun test tests
bun run test:coverage
bun run inspector
git commit -m "feat: description"
git push origin feature/your-feature-name
# Open a PR on GitHub
```
