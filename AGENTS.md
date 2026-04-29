# AGENTS.md

## Runtime

Use **bun** instead of node for everything:

- Running scripts: `bun run <script>` instead of `node <script>` or `npm run`
- Installing packages: `bun install` instead of `npm install`
- Running tests: `bun run test` instead of `vitest` / `jest` / etc.
- Executing TS directly: `bun run file.ts` (no need for ts-node)
