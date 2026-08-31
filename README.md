# streamdeck-plugins

Elgato Stream Deck plugins built and maintained by Agenon (agenon.ai).

This repository is a pnpm monorepo. Shared packages live under `packages/`,
individual Stream Deck plugins live under `plugins/`. Every plugin uses the
reverse-DNS namespace `ai.agenon`, matching the Agenon company domain.

## Prerequisites

- Node.js 20 or newer
- pnpm 10
- `@elgato/cli` (installed globally: `npm install -g @elgato/cli`)
- Stream Deck app 6.9 or newer (the minimum declared in each plugin's `manifest.json`)

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

`pnpm typecheck` builds every project listed in the root `tsconfig.json`
`references` array. Each package has two: `tsconfig.json` for its sources and
`tsconfig.test.json` for its `*.test.ts` files, so test code is typechecked
under the same strict settings as the code it tests.

## Running a plugin in development

Each plugin exposes a `dev` script. To run the k3s context plugin in
development mode with the Stream Deck app:

```bash
pnpm --filter @agenon/streamdeck-k3s-context dev
```

## Cluster health status

Both k3s context actions show a second title line with the reachability of
the active context's API server:

- `ok`: the API server answered `GET /readyz` with a 200 response.
- `down`: anything else, a refused connection, a timeout, a TLS failure, or a
  non-200 response.
- `...`: the first probe for that context has not completed yet.

Only the active context is probed, over mutual TLS using the certificate and
key already in the kubeconfig, with a 5 second timeout. A probe runs on
plugin start, on every context change (including one made outside the
plugin), when a key appears, and on a 30 second interval while at least one
cycle or pin key is visible; the interval stops once none are. Switching
context is never blocked by a probe: the key updates immediately and the
status line catches up once the new probe resolves. Health is cached per
context, so cycling back to a context that was already probed shows its last
known status instead of flickering back to `...`.

The `no kubeconfig`, `no contexts` and `pick context` messages are unchanged
and never carry a status line.

## Adding a new plugin

1. Copy `plugins/k3s-context` to a new directory under `plugins/`.
2. Rename the `.sdPlugin` directory to match the new plugin.
3. Update every UUID in the copied files to use the `ai.agenon` namespace
   (for example `ai.agenon.<new-plugin-name>`), including the manifest,
   package name, and any references in source files.
4. Add icons for the new plugin.
5. Add the new package to the `references` array in the root
   `tsconfig.json`, both its `tsconfig.json` and its `tsconfig.test.json`.
   A package that is not referenced there is silently skipped by
   `pnpm typecheck`, source and tests alike.
6. Run `pnpm install` from the repository root so the new package joins the
   workspace, then run `pnpm typecheck && pnpm test && pnpm validate`.

## Verified setup

Confirmed working on a real Mac with Stream Deck app 7.5.1 and a physical
Stream Deck + XL, using `@elgato/cli` from `~/.volta/bin/streamdeck`.

```bash
pnpm install
pnpm -r build
pnpm typecheck
pnpm test
pnpm validate
cd plugins/k3s-context
streamdeck link ai.agenon.k3s-context.sdPlugin
```

`streamdeck link` symlinks the plugin into the Stream Deck app's `Plugins`
directory and registers it with `streamdeck list`. The Stream Deck SDK only
starts the plugin's Node process once an action instance is placed on a
visible key; linking alone does not launch it. On this machine the process
did not appear until the Stream Deck app itself was relaunched after
linking, so if the new actions do not show up in the action list right
away, quit and reopen the Stream Deck app once.

The plugin writes its own log file to
`ai.agenon.k3s-context.sdPlugin/logs/` only when something is actually
logged (for example a failed context switch); a healthy, idle plugin with
no key presses yet produces an empty `logs/` directory, which is expected
and not a sign of failure.

Both property inspectors (`ui/cycle-context.html` and
`ui/pin-context.html`) load `sdpi-components` from
`https://sdpi-components.dev/releases/v4/sdpi-components.js` over the
network on first open. An internet connection is required the first time a
property inspector is opened; there is no vendored fallback.

For the manual, on-device verification checklist (cycle key, pin keys,
external-change detection, kubeconfig integrity), see
[docs/manual-verification.md](./docs/manual-verification.md).

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
