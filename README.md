# project-atlas

[Русская версия](README.ru.md)

project-atlas reads a repository through an explicit list of paths and builds
a graph of its documents, rules, agents and deploy units: ADRs, history
records, design specs, guides, invariants, agent roles and their model tiers,
skills, gate classes and cycle phases from a manual overlay, numbered app
units, Compose services, volumes and external services. Edges are citations,
replacements, reliance on invariants, role mentions, routes, dependencies,
mounts, calls and gate traces in history records.

The build writes:

- `graph.json` and `texts.json` for a static showcase page (`web/`);
- a derived Obsidian vault with citations rewritten to `[[wikilinks]]`;
- nothing else — the source repository is never modified.

Node 22, no dependencies.

## Usage

```sh
node build.js --root test/fixtures/minimal --check                  # validate only, writes nothing
node build.js --root test/fixtures/minimal --out temp/minimal       # graph, showcase and vault
node build.js --root test/fixtures/minimal --out temp/minimal --serve   # same, then serve the showcase on 127.0.0.1:8080
node build.js --samples                                             # the built-in key samples, one per line
node --test test/*.test.js
```

`--samples` is the stable interface a consumer's CI uses to compare its own
secrets grep with the tool's list; it reads and writes nothing.

| Option | Default | Meaning |
|---|---|---|
| `--root` | current directory | repository to read |
| `--config` | `<root>/atlas.config.json` | project configuration |
| `--out` | `<package>/dist` | output directory |
| `--check` | off | validate only: nothing is written, exit 1 on any finding |
| `--serve` | off | after a build, serve `<out>/site` on `127.0.0.1:8080` |

Exit codes: `0` — no findings; `1` — findings (printed as `file:line: message`,
GitHub annotations under Actions; nothing written); `2` — cannot start (config
file missing or not JSON, bad arguments, unsafe output directory).

## Configuration

Everything project-specific comes from two files in the target repository:

- `atlas.config.json` — which paths to read and how the project names its
  collections, units and deploy pieces;
- the manual overlay (its path is in the config) — gate classes, cycle phases,
  external services and the facts no machine-readable file holds.

The contract for both, and for the outputs, is
[`docs/input-spec.md`](docs/input-spec.md) (format 1). Two complete examples:

- [`test/fixtures/minimal/`](test/fixtures/minimal/) — a synthetic project with
  no design, guides, skills, units or deploy blocks;
- [`examples/ai-advent-2026/atlas.config.json`](examples/ai-advent-2026/atlas.config.json)
  — the project the tool was extracted from; see
  [its README](examples/ai-advent-2026/README.md).

Document conventions (section names, status words, gate marks) come from the
vocabulary `lib/vocab/ru.js`. Format 1 ships Russian only; the showcase UI,
vault note bodies and finding messages are Russian too.

## Boundaries

- **Only listed paths are read.** Directories are listed non-recursively, by
  file mask. Every read and listing goes through one guard: the path must lie
  under a configured input, must not match the deny list (`.env*`, `*.env`,
  `temp/`, `logs/`, `data/` at any depth, `*.sqlite*`, `*.log`,
  `node_modules/`, `.git/`), must contain no symbolic link on the way from the
  root, and its real path must stay under the real root. A violation is a
  finding and the file is not read. The units directory is only listed:
  application code is never an input.
- **Only the output directory is written.** `<out>` is resolved to its real
  path. It must not be the root or an ancestor of it and must not overlap any
  input. Nothing the build deletes or writes may be a symbolic link, and every
  written file's real directory must stay under the real `<out>` — so `<out>`
  inside the root (a `dist/`) is allowed: a planted marker cannot lead a write
  outside it. The build deletes `<out>/site/` and the vault directories it owns, and
  only when `<out>` is new, empty or carries the `.project-atlas` marker of a
  previous build; otherwise it refuses and deletes nothing. `.obsidian/` inside
  the vault is left alone. `--check` does not resolve or check `--out`.
- **Provenance** (commit, its date, dirty flag) is read from git only when the
  root is the top of a git working tree. Otherwise the fields are empty and the
  vault says the commit is unknown.

## Outputs

### `graph.json`

`{ provenance: { sha, dirty, date }, nodes, edges }`, two-space indented.
Node and edge order is fixed by the spec; layout depends on it.

- `x`, `y` on every node — unit square `0…1`, six decimals, a deterministic
  force layout with a fixed seed.
- `z` on every node — depth for the 3D view, `0…1`, computed after `x`, `y`
  without changing them; nodes without edges sit at `0.5`. It is placed before
  `x` in the object.
- `marks` on `fired` edges — `{ unit, role, sign }`, half-open UTF-16 offsets
  into `excerpt` before any markup processing.
- Trace excerpts are never clipped: a whole sentence or table row.

### `texts.json`

One object `{ "<node id>": "<text>" }` in node order, no indentation, trailing
newline, for full-text search in the showcase. Documents, roles and own skills;
frontmatter, heading hashes, emphasis, backticks and table syntax removed.

Secrets, last step:

- **Key-like samples with a tail** (an Anthropic or Groq key prefix followed by
  a key-length tail, a PEM private-key header, GitHub tokens with a tail) in
  any read document are a finding: nothing is written, and the message names
  the pattern and line, never the match. The same list (`KEY_SAMPLES` in
  `lib/texts.js`) is what the `secrets` CI job greps over the whole tree.
- **Legitimately mentioned samples** (bare key prefixes, the OpenSSH key
  header, CGNAT addresses) are replaced by `[скрыто]` in `texts.json`.

### Showcase

`web/` — `index.html`, `app.js`, `style.css`: no dependencies, browser APIs
only, relative paths. The build injects the project name, repository URL and
the optional "about this atlas" document as `<meta name="atlas-…">` tags;
`app.js` holds no project constant. File links point at the build commit.

### Vault

Frontmatter, a provenance comment block (source path, commit, commit time,
read-only notice) and the document body with citations rewritten to
`[[wikilinks]]`. Rebuilding an unchanged repository gives byte-identical notes:
the time is the commit time, not "now".

### Size limits

`texts.json` 3072 KiB, `graph.json` 1024 KiB, page code 256 KiB (`LIMITS` in
`build.js`). Exceeding one is a finding; nothing is truncated.

## Code

```text
build.js         CLI: --root, --config, --out, --check, --serve; output safety
lib/config.js    loads and validates atlas.config.json, resolves the input list
lib/sources.js   reads inputs through the guard; symlinks and deny list are findings
lib/markdown.js  frontmatter, sections, citation grammar built from the config
lib/compose.js   narrow Compose subset parser; an unknown line is a finding
lib/fired.js     gate traces: a role name next to a gate mark in a history record
lib/layout.js    deterministic force layout: x, y and z of every node
lib/extract.js   nodes, edges and findings
lib/texts.js     texts.json and secret samples
lib/vault.js     Obsidian notes
lib/vocab/ru.js  document-convention vocabulary
```

## Compatibility (format 2)

The tool speaks format 2: numbered app units are `unit` nodes. Format 1 was
the same tool before `v2.0.0` — see "Format history" in
[`docs/input-spec.md`](docs/input-spec.md) §10.5 for the full rename map and
for what the two formats are.

Equality with format 1 is still checked, up to that map.
`test/compat.test.js` builds `MikeKharr/ai-advent-2026` at
`1d882f40f8c37370b4dfbc3add650f10d1b11c1c` with its own old package, builds
the same checkout with this tool and the example configuration, and compares
the outputs through `test/rename-map.js` — the single implementation of the
map, which also runs as a command:

```sh
node test/rename-map.js <reference dist> <our out>
```

Beyond the map, `site/` and `vault/` differ only in four named files:

| File | Difference |
|---|---|
| `site/index.html` | the `<meta name="atlas-…">` tags, and «дней» → «приложений» in a comment |
| `site/app.js` | no project constants; generic footer wording |
| `vault/index.md` | `ИСТОЧНИК: build.js` instead of `atlas/build.js`; the sections list says `units/` |
| `vault/skills/skill-inspector.md` | the vendor set is taken from the skills lock file |

The test is skipped unless `ATLAS_REFERENCE_ROOT` points at a clean checkout of
that commit; the `compat` CI job provides one. It checks that checkout by
content — no `assume-unchanged` bit, overlay equal to `HEAD` — before building
and again afterwards, because it rewrites the overlay's `about` key to the
format-2 `units` for the duration of the run and restores it in `finally`.
Both builds must run in the same timezone: commit times are formatted in
local time.

## Origin

Extracted from the `atlas/` package of
[`MikeKharr/ai-advent-2026`](https://github.com/MikeKharr/ai-advent-2026) at
commit `1d882f4`. The extraction plan is
[`docs/extraction-plan.md`](docs/extraction-plan.md).

MIT — see [LICENSE](LICENSE).
