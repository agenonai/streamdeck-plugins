# streamdeck-plugins

Elgato Stream Deck plugins built and maintained by Agenon (agenon.ai).

This repository is a pnpm monorepo. Shared packages live under `packages/`,
individual Stream Deck plugins live under `plugins/`. Every plugin uses the
reverse-DNS namespace `ai.agenon`, matching the Agenon company domain.

## Prerequisites

- Node.js 20 or newer
- pnpm 10
- `@elgato/cli` (installed globally: `npm install -g @elgato/cli`)
- Stream Deck app 6.5 or newer

## Getting started

Install dependencies from the repository root:

```bash
pnpm install
```

Run the full workspace checks:

```bash
pnpm typecheck
pnpm test
```

## Running a plugin in development

Each plugin exposes a `dev` script. To run the k3s context plugin in
development mode with the Stream Deck app:

```bash
pnpm --filter @agenon/streamdeck-k3s-context dev
```

## Adding a new plugin

1. Copy `plugins/k3s-context` to a new directory under `plugins/`.
2. Rename the `.sdPlugin` directory to match the new plugin.
3. Update every UUID in the copied files to use the `ai.agenon` namespace
   (for example `ai.agenon.<new-plugin-name>`), including the manifest,
   package name, and any references in source files.
4. Add icons for the new plugin.
5. Run `pnpm install` from the repository root so the new package joins the
   workspace, then run `pnpm typecheck && pnpm test && pnpm validate`.

## Releasing

Pushing a `v*` tag triggers the `release` job in `.github/workflows/ci.yml`,
which runs `streamdeck pack` on each plugin and attaches the resulting
`.streamDeckPlugin` files to a GitHub release. Note that `streamdeck pack`
rewrites `manifest.json` in place (reformats indentation and drops the
trailing newline) before packing, so the packed artifact's manifest
formatting will differ from the tracked source in git; this is harmless in
CI's ephemeral checkout, but if you run `streamdeck pack` locally, revert the
resulting `manifest.json` change before committing anything else.

## License

MIT, see [LICENSE](./LICENSE).
