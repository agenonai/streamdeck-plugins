# streamdeck-plugins: Project Intelligence

This file is loaded automatically whenever an agent works in this repository.

## Repository shape

pnpm monorepo. Shared packages live in `packages/*`, individual Stream Deck
plugins live in `plugins/*`. Root `tsconfig.json` is a TypeScript solution
file: every package and plugin gets its own entry in `references` and
extends `tsconfig.base.json`.

## UUID namespace

All plugin and action UUIDs use the reverse-DNS namespace `ai.agenon`,
matching the Agenon company domain (agenon.ai). Example: the k3s context
plugin UUID is `ai.agenon.k3s-context`. Never use any other namespace when
creating a new plugin.

## kubectl and kubeconfig safety rules

- Plugins never spawn `kubectl` as a subprocess. All Kubernetes context
  operations go through the shared kubeconfig package, not shell-outs.
- Kubeconfig writes must be safe: read the existing file, apply the minimal
  change needed, and write back atomically. Never truncate or regenerate a
  user's kubeconfig from scratch.
- Never log or print kubeconfig contents, tokens, or certificates.

## Before every commit

Run and confirm green:

```bash
pnpm typecheck && pnpm test && pnpm validate
```

`pnpm validate` requires the Stream Deck CLI (`@elgato/cli`) and only
applies once a plugin exists under `plugins/*/*.sdPlugin`.

## Conventions

- English for all code, comments, and docs.
- Conventional Commits for commit messages.
- No em-dash or en-dash in any generated content.
