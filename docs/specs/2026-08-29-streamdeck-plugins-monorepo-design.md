# Stream Deck Plugins Monorepo Design

- **Date**: 2026-08-29
- **Status**: Approved (design), pending implementation plan
- **Owner**: Kevin
- **Repo to create**: `~/development/agenon/products/streamdeck-plugins` → `github.com/agenonai/streamdeck-plugins` (public, MIT)

## 1. Purpose

Agenon needs a home for Elgato Stream Deck plugins. The repo is a pnpm monorepo so that
future plugins reuse shared code and build config instead of repeating a full
`streamdeck create` scaffold each time.

The first plugin, `k3s-context`, displays the active Kubernetes context on a key and
lets Kevin switch contexts without leaving the keyboard. The local kubeconfig currently
holds 14 contexts across Agenon and client clusters, which makes terminal-based switching
error-prone.

### Success criteria

1. `pnpm dev` inside a plugin package runs rollup watch plus `streamdeck dev` hot reload.
2. The `k3s-context` plugin installs into Stream Deck via `streamdeck link` and shows the
   active context within one second of a change made anywhere (Stream Deck key or terminal).
3. Switching context from a key changes what a freshly opened terminal reports from
   `kubectl config current-context`.
4. A second plugin can be added without editing any file outside `plugins/<new-plugin>/`
   and one workspace entry.

### Non-goals (v1)

- Cluster health or reachability checks.
- Namespace switching.
- Publishing to the Elgato Marketplace.
- Windows testing (the manifest declares Windows support; only macOS is verified).

## 2. Repository layout

```
streamdeck-plugins/
├── plugins/
│   └── k3s-context/
│       ├── ai.agenon.k3s-context.sdPlugin/
│       │   ├── manifest.json
│       │   ├── imgs/                     action + category icons
│       │   ├── ui/                       property inspector HTML
│       │   └── bin/                      rollup output (gitignored)
│       ├── src/
│       │   ├── plugin.ts                 entry point, registers actions
│       │   └── actions/
│       │       ├── cycle-context.ts
│       │       └── pin-context.ts
│       ├── rollup.config.mjs
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── kubeconfig/                       kubeconfig read/write/watch service
│   └── tsconfig/                         shared tsconfig base + rollup preset
├── .github/workflows/ci.yml
├── pnpm-workspace.yaml
├── package.json                          root scripts only, no runtime deps
├── CLAUDE.md
├── README.md
└── LICENSE                               MIT
```

Adding a plugin: run `streamdeck create`, move the result into `plugins/<name>/`, point its
`tsconfig.json` and rollup config at the shared preset, and depend on `@agenon/kubeconfig`
if it needs cluster state.

## 3. Naming

Reverse DNS from the company domain `agenon.ai`.

| Item | Value |
| --- | --- |
| Plugin UUID | `ai.agenon.k3s-context` |
| Plugin directory | `ai.agenon.k3s-context.sdPlugin` |
| Cycle action UUID | `ai.agenon.k3s-context.cycle` |
| Pin action UUID | `ai.agenon.k3s-context.pin` |
| Manifest `Author` | `Agenon` |
| Manifest `URL` | `https://agenon.ai` |
| npm package names | `@agenon/streamdeck-k3s-context`, `@agenon/kubeconfig` (private, never published) |

UUIDs use only lowercase letters, digits, hyphen, period, and underscore, as the Stream Deck
manifest requires.

## 4. Plugin: k3s-context

### 4.1 Cycle Context action (`ai.agenon.k3s-context.cycle`)

- Key title shows the active context name verbatim. No truncation or prefix stripping;
  Stream Deck already wraps long titles.
- Pressing the key advances to the next context in the cycle list and wraps at the end.
- If the active context is not in the cycle list, the first entry of the list is selected.
- Property Inspector: a checkbox list of every context in the kubeconfig, in kubeconfig
  order. Settings store the selected names as an array in that same order.
- With an empty cycle list, the key shows `no contexts` and a press is a no-op.

### 4.2 Pin Context action (`ai.agenon.k3s-context.pin`)

- Property Inspector: a single-select dropdown of contexts.
- Two manifest states: state `0` (dimmed) when the pinned context is not active, state `1`
  (highlighted) when it is.
- Pressing switches to the pinned context. Pressing while already active is a no-op.
- If the pinned context no longer exists in the kubeconfig, the key shows an alert
  (`showAlert`) on press and stays in state `0`.

### 4.3 State propagation

Every visible key of both action types reflects the same active context. When the context
changes for any reason, all visible keys update.

## 5. Kubeconfig service (`packages/kubeconfig`)

A plain TypeScript module with no Stream Deck dependency, so it can be unit tested and
reused by later plugins.

### API

```ts
type KubeconfigService = {
  getContexts(): string[];
  getCurrent(): string | null;
  setCurrent(name: string): Promise<void>;
  onChange(listener: (state: { contexts: string[]; current: string | null }) => void): () => void;
  dispose(): void;
};
```

### Behaviour

- **Path**: `$KUBECONFIG` when set (first entry if it is a colon-separated list),
  otherwise `~/.kube/config`.
- **Read**: parse with `yaml`'s `parseDocument` so comments and formatting survive a
  round trip. Read `contexts[].name` and `current-context`.
- **Write**: mutate only the `current-context` node, then serialise. Write to a temp file in
  the same directory and `rename` over the original, so a crash mid-write cannot truncate
  the kubeconfig. Preserve the original file mode (`0600`).
- **Backup**: before the first write of a process, copy the kubeconfig to
  `<path>.streamdeck-bak`. Overwrite that backup on later runs.
- **No `kubectl` subprocess.** The Stream Deck plugin process does not inherit the user's
  shell `PATH`, so `/opt/homebrew/bin/kubectl` would not resolve.
- **Watch**: `fs.watch` on the kubeconfig directory, filtered to the config filename, so
  editor-style atomic replacements are still detected. Debounce 150 ms, re-read, and notify
  listeners only when contexts or current context actually changed.
- **Failure handling**: if the file is missing or fails to parse, the service reports
  `current: null` with an empty context list and keeps watching. Writes are refused while in
  that state, so a malformed kubeconfig is never overwritten.

## 6. Manifest and runtime

| Field | Value | Reason |
| --- | --- | --- |
| `SDKVersion` | `3` | Current SDK generation |
| `Software.MinimumVersion` | `"6.5"` | First version shipping the Node 20 runtime |
| `Nodejs.Version` | `"20"` | Widest install base; `24` needs a much newer app |
| `OS` | mac 12, windows 10 | Code is cross-platform; only macOS is tested |
| `CodePath` | `bin/plugin.js` | rollup bundle |

Development loop: `pnpm dev` in a plugin package runs rollup in watch mode and
`streamdeck dev`, which restarts the plugin on rebuild. `streamdeck link` registers the
`.sdPlugin` directory with the installed Stream Deck app once, during setup.

## 7. Testing

Vitest, run from the workspace root.

**`packages/kubeconfig`** (the bulk of the coverage, against fixture files in a temp dir):

- parses contexts and `current-context` from a representative multi-context kubeconfig;
- `setCurrent` changes only `current-context`, leaving comments, key order, and every other
  field byte-identical;
- `setCurrent` rejects a context name absent from the file;
- a malformed YAML file yields an empty state and refuses writes;
- a missing file yields an empty state without throwing;
- the watcher fires after an external rewrite and does not fire when the file is rewritten
  with identical content;
- file mode stays `0600` after a write.

**Actions** (with a stubbed Stream Deck SDK and a fake service):

- cycle advances and wraps;
- cycle with an active context outside the list selects the first entry;
- cycle with an empty list is a no-op;
- pin sets state `1` only for the active context;
- pin on a deleted context calls `showAlert` and does not write.

The Property Inspector HTML is not tested.

## 8. CI

`.github/workflows/ci.yml`, on push and pull request:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`
5. `streamdeck validate` for each directory matching `plugins/*/*.sdPlugin`

On a `v*` tag, an additional job runs `streamdeck pack` per plugin and attaches each
`.streamDeckPlugin` file to the GitHub release.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Corrupting a kubeconfig that holds 14 real cluster credentials | Atomic temp-and-rename writes, a backup before the first write, only the `current-context` node is ever modified, and writes refused when parsing fails |
| Switching context affects every terminal and tool on the machine | Intended behaviour, and it is what makes the key useful; the key always shows the current value, so the state is never hidden |
| `fs.watch` is unreliable on some filesystems | Watch the directory rather than the file, and re-read on every Stream Deck `willAppear` event as a fallback |
| Stream Deck Node runtime version drifts | `Nodejs.Version` is pinned in the manifest and CI runs `streamdeck validate` |
