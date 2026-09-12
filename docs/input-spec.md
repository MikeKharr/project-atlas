# project-atlas — input specification, format 2

Status: proposed (2026-09-11; format 2 since 2026-09-12). Companions:
`docs/extraction-plan.md`, `docs/migration-plan.md`.

project-atlas reads a repository by an explicit list of paths and builds a
graph of its documents, rules, agents and deploy units: `graph.json` and
`texts.json` for a static showcase page, plus a derived Obsidian vault. It is
extracted from the `atlas/` package of `MikeKharr/ai-advent-2026`
(source commit `1d882f4`); everything that was hard-wired to that repository
now comes from a **project configuration file** plus a **manual overlay**.

This document is the contract for both files and for the outputs. The tool
supports **format 2 only**; a configuration with `"format": 1` is a finding
naming the three edits a consumer has to make. What changed between the
formats, and what format 1 was, is in "Format history" (§10.5).

## 1. Scope and non-goals

In scope: any repository that keeps its decisions and history as atomic
Markdown documents (ADR, development history, design specs, guides), cites
them in backticks, numbers its invariants, and optionally describes agent
roles, skills, a Compose deployment and an LLM provider list.

Not in scope for format 2:

- document conventions in languages other than Russian and English (§8);
  a third vocabulary is a file, not a format change;
- arbitrary document collections beyond the four fixed kinds (§4.1);
- any reading outside the configured list (§3.3), ever.

## 2. Invocation

```sh
node build.js [--root <dir>] [--config <file>] [--out <dir>] [--check] [--serve]
node build.js --samples
```

| Option | Default | Meaning |
|---|---|---|
| `--root` | current directory | repository to read; every path in the config is relative to it |
| `--config` | `<root>/atlas.config.json` | project configuration (§3) |
| `--out` | `<package>/dist` | output directory (§10); resolved with `realpath`; must not be `<root>` or one of its ancestors, must not contain any input and must not lie inside an input (`<root>/dist` is fine) |
| `--check` | off | validate only: nothing is written, exit 1 on any finding (§11); `--out` is neither resolved nor checked |
| `--serve` | off | after a build, serve `<out>/site` on `127.0.0.1:8080` |
| `--samples` | off | print the regex sources of the built-in key samples (§9), one per line, and exit 0 |

`--samples` is a stable interface for the consumer's CI: it compares its own
secrets grep with this list instead of keeping a second copy of the patterns.
It reads and writes nothing, prints nothing else, and does not combine with
any other argument (that is a usage error, exit 2). The sources are assembled
from pieces, so the output does not itself look like a key.

Exit codes: `0` — no findings; `1` — findings (printed, nothing written);
`2` — cannot start (config file missing or not JSON, bad CLI arguments,
`--out` refused per §10).

Node 22, no dependencies. Provenance (`sha`, `dirty`, `date`) is read with
git (`rev-parse`, `status`, `show`) only when `git rev-parse --show-toplevel`
run in `<root>` equals `realpath(<root>)`; otherwise — no git, or `<root>`
is a subdirectory of a repository — the provenance fields are absent and
the vault says so (same as today).

## 3. Project configuration file

### 3.1 Name, location, version

`atlas.config.json` at the repository root, or any file passed with
`--config`. Required top-level field `"format": 1`. Unknown top-level or
nested keys are a finding (typos must not silently disable an input).

### 3.2 Schema

Paths are repository-relative, POSIX separators. Every segment matches
`^(?!\.{1,2}$)[A-Za-z0-9._-]+$` — so no leading `/`, no empty, `.` or `..`
segment, no other characters. File fields require an extension by field:
`docs.rootDocs` and `docs.invariants` — `.md`; `deploy.providers.file`,
`overlay` and `agents.skillsLock` — `.json`; `deploy.compose` — `.yml` or
`.yaml`; `deploy.landing` — `.html`. A path that matches the deny list in
§3.3 is a finding even when listed.

```jsonc
{
  "format": 1,
  "project": {                     // required
    "name": "AI Advent 2026",      // showcase title and vault index
    "repo": "https://github.com/mikekharr/ai-advent-2026",  // links to files, pinned to the build sha
    "about": "agent_docs/adr/2026-09-10-0550-project-atlas.md"  // optional: "about this atlas" link in the page footer
  },
  "language": "ru",                // optional; vocabulary of document conventions, §8: "ru" or "en"; default "ru"
  "docs": {                        // required
    "root": "agent_docs",          // directory that holds the document collections
    "adr": "adr",                  // required; single path segment under root
    "history": "development-history", // optional; single segment
    "design": "design",            // optional; single segment
    "guides": "guides",            // optional; single segment
    "invariants": "invariants.md", // optional; file under root
    "rootDocs": ["agent_docs/architecture.md", "agent_docs/index.md", "agent_docs/glossary.md", "AGENTS.md"]
                                   // optional; full paths; become guide nodes and citation targets
  },
  "agents": {                      // optional block
    "roles": ".claude/agents",     // directory of role files
    "skills": ".agents/skills",    // directory of <name>/SKILL.md
    "skillsLock": "skills-lock.json", // vendored-skill marker
    "modelPrefix": "claude-"       // stripped from the model id in tier titles when the id starts with it (`startsWith`, not a regex); default ""
  },
  "units": {                       // optional block: numbered app units
    "dir": "days",                 // listed only, never read
    "prefix": "day"                // ^[A-Za-z][A-Za-z_-]*$; unit directories are named <prefix><number>; the number orders them
  },
  "deploy": {                      // optional block
    "compose": "deploy/compose.yml",
    "proxy": "caddy",              // compose service that runs the Caddyfile; required if caddyfile is set
    "caddyfile": "deploy/Caddyfile",
    "landing": "site/index.html",  // requires units
    "static": [                    // services that are files behind the proxy, not compose services
      { "name": "site", "dir": "site", "file": "site/index.html",
        "note": "Лендинг: статика, которую caddy отдаёт из bind-монтирования ../site." }
    ],
    "registry": { "prefix": "ghcr.io/", "external": "ghcr" }, // image prefix → overlay external id
    "providers": { "file": "router/config/providers.json", "service": "router" }
  },
  "overlay": "atlas/overlay.json"  // optional; manual facts, §7
}
```

Dependencies between fields (each violation is a finding at config load):

| Field | Requires |
|---|---|
| `deploy.caddyfile` | `deploy.compose`, `deploy.proxy` |
| `deploy.landing` | `units` |
| `deploy.static` | `deploy.compose`, `deploy.proxy` |
| `deploy.registry` | `deploy.compose`, `overlay` (the external must be declared there) |
| `deploy.providers` | `deploy.compose` (the service must be a compose service) |
| `agents.skillsLock` | `agents.skills` |

`docs.adr`, `docs.history`, `docs.design`, `docs.guides` names must be
distinct from each other and from every `rootDocs` basename: the citation
grammar (§5.3) is built from these names.

### 3.3 Boundary: the explicit list and the deny list

The tool reads **only** the files and directories named by the
configuration; directories are listed non-recursively, by file mask. Every
read goes through a single guard that checks the path against the resolved
list — the list is the intent, the guard is the guarantee (as in
the source package at `1d882f4`). Tests keep a golden copy of the resolved list
for the example configuration.

Every read and every directory listing checks the path with `lstat`, one
component at a time from `<root>` down: a component that is a symbolic link
is a finding and the path is not read. In addition the `realpath` of the
target must lie under `realpath(<root>)`; otherwise — a finding. The deny
list below is checked at config load **and** again at every read.

Never read, even if listed (config finding):

```text
.env, .env.*, *.env, **/*.env
temp/**, logs/**, data/**, **/data/**
*.sqlite, *.sqlite-journal, *.log
node_modules/**, .git/**
```

`units.dir` is **listed only**: directory names are taken, nothing under it
is opened. The deploy units' application code is never an input.

## 4. Where each node type comes from

### 4.1 Node table

Ids are `<type>/<key>`. Order in `graph.json` is the order of this table,
then the order rules in each row (layout depends on order; the
compatibility test in the plan is the authority).

| Type | Source | Key | Fields beyond `id, type, key, title` | Order |
|---|---|---|---|---|
| `adr` | `docs.root/docs.adr/*.md` except `README.md` | `YYYY-MM-DD-HHMM` from the filename; a name without it is a finding | `file, date, excerpt, status` | filename, sorted |
| `history` | `docs.root/docs.history/*.md` except README | same | `file, date, excerpt` | sorted |
| `design` | `docs.root/docs.design/*.md` except README | filename without `.md` | `file, date` (from a leading `YYYY-MM-DD` if present, else `null`), `excerpt` | sorted |
| `guide` | `docs.root/docs.guides/*.md` except README, then `docs.rootDocs` | guides: filename without `.md`; root docs: basename without `.md`, lower-cased | `file, date, excerpt` | guides sorted, then rootDocs in config order |
| `invariant` | `docs.root/docs.invariants` | `I-N` from lines `- **I-N.** text` | `text, file` | file order |
| `role` | `agents.roles/*.md` | filename without `.md` | `file, model, effort, skills, description, owns, never` | sorted |
| `tier` | derived from roles | `<model sanitized>-<effort>` | `model, effort`; title `<model without modelPrefix> / <effort>` | emitted right after the first role that uses it |
| `skill` | `agents.skills/<name>/SKILL.md` | directory name | `file, description, vendored` | sorted |
| `unit` | `units.dir/<name>` matching `^<units.prefix>(\d+)$` | directory name | `date, dir, route, image, envFiles` | by the number |
| `service` | compose services whose name is not `<units.prefix><number>`; then `deploy.static` | service name | compose: `image, envFiles, file`; static: `source` (`<dir>/`), `file`, `note` | compose order, then config order |
| `volume` | top-level `volumes:` of compose | volume name | `file` | file order |
| `external` | `deploy.providers.file` entries; then overlay `externals` | provider `id` / overlay `id` | providers: `kind, tier, model, source`; overlay: `kind, note, source` | file order, then overlay order |
| `class` | overlay `classes` | `id` | `what, note, source` | overlay order |
| `phase` | overlay `phases` | zero-padded `n` (`01`…) | `n, exit, human, source` | overlay order |

`source` is the config path string of the file the entry came from
(`atlas/overlay.json`, `router/config/providers.json`), `file` the config
path of a document or compose file. `x`, `y`, `z` (layout, `0…1`, six
decimals, deterministic) are appended to every node last; `z` before `x`.

The type name is `unit` — a numbered app unit. The key keeps whatever the
directory is called, so a project whose units live in `days/day1` has a node
`unit/day1`: the **type** is renamed by format 2, the **key** is data.

### 4.2 Edge table

| Kind | From → to | Derived from |
|---|---|---|
| `tier` | role → tier | role frontmatter `model` + `effort` |
| `preloads` | role → skill | role frontmatter `skills:`; unknown skill is a finding |
| `depends` | unit/service → unit/service | compose `depends_on` |
| `mounts` | unit/service → volume | compose `volumes:` of a service, named volumes only |
| `routes` | proxy service → unit/service | Caddyfile `reverse_proxy <service>:<port>` inside a `handle_path <prefix>*` block; one edge per service |
| `serves` | proxy service → static service | proxy bind-mounts a path that resolves (relative to the compose file's directory) to the static service's `dir` |
| `calls` | providers service → external | one per provider entry |
| `image` | unit/service → external | compose `image:` starts with `deploy.registry.prefix` |
| `publishes` | external → external | overlay `publishes` |
| `calls` | unit/service → external | overlay `calls` |
| `gates` | class → role | overlay `classes[].gates` |
| `runs` | phase → role, phase → class | overlay `phases[].roles`, `phases[].classes` |
| `cites` | adr/history/design/guide/role → adr/history/design/guide | citations, §5.3; once per (document, target) |
| `relies` | same → invariant | `I-N` mentions; once per pair |
| `mentions` | same → role | `` `role` `` in backticks; once per pair; never self |
| `replaces` | adr → adr | status lines, §5.5; `replacedBy` yields the reverse edge |
| `about` | adr/history/design → unit | a unit key as a whole word in the document's filename; overridden by overlay `about.<doc>.units` |
| `fired` | role → history | the gate-trace rule, §5.6; carries `line, excerpt, marks` |

Edge order in `graph.json` follows this table with two exceptions, kept
from the source code for equality:

- `depends` and `mounts` are emitted per compose service, in compose
  order: the service's `depends` edges, then its `mounts` edges, then the
  next service;
- `cites`, `relies` and `mentions` are emitted per citing document (adr,
  history, design, guides, then roles, each in node order), in the order
  the citations appear in the text — the three kinds interleave.

Within every other row the order is that of the source entries (roles,
providers, compose services, overlay arrays, ADR files; `replaces` per ADR:
its "replaces" lines, then its "replaced by" lines).

## 5. Document conventions

### 5.1 Filenames

Atomic documents (`adr`, `history`) are named `YYYY-MM-DD-HHMM-slug.md`;
the id is the leading timestamp, `date` is its date part. A file in these
directories without a timestamp is a finding. `design` files may or may not
carry one. `README.md` in any collection is skipped.

### 5.2 Frontmatter

Flat YAML subset, only where it is read:

- roles: `name`, `description`, `model`, `effort`, `skills:` (a `- item`
  list). `model` and `effort` form the tier; `skills` form `preloads`;
- skills (`SKILL.md`): `name`, `description`.

Documents may carry frontmatter; it is stripped from `texts.json` and
ignored otherwise.

### 5.3 Citation grammar

One expression, applied to the whole text (citations wrap across lines).
Guarded regions are matched first and never parsed: fenced code blocks,
text in double backticks (``` `` … `` ```) — used to *show* a citation
literally — and already-formed `[[wikilinks]]`.

| Form | Kind | Resolves to |
|---|---|---|
| ``ADR `<id or filename containing YYYY-MM-DD-HHMM>` `` | adr | `adr/<id>`; missing → finding |
| `` `[<docs.root>/]<coll>/<file>` `` where `<coll>` is one of the configured `adr`, `history`, `design`, `guides` names | path | for adr/history: node by id; for design/guides: node by filename without `.md`; a path with no node but an existing file passes; otherwise finding |
| `` `[<docs.root>/]<rootDoc basename>` `` from `docs.rootDocs` | path | the configured root doc; a bare basename maps to the configured path; a written prefix is taken literally and must exist (so `agent_docs/AGENTS.md` is a finding when the file lives at the root) |
| `I-<n>` as a whole word | invariant | `invariant/I-<n>`; unknown number → finding naming the known range |
| `` `<word>` `` matching `[a-z][a-z-]*` | word | `role/<word>` if such a role exists, else ignored |

Template placeholders are not citations: values containing `YYYY`, `HHMM`,
`<`, `*`, the vocabulary word for "name" (§8), `name.md`, or ending in
`/id`.

The same expression rewrites citations to wikilinks in the vault; a
citation that does not resolve stays as written.

### 5.4 Sections and excerpts

`## <name>` sections are read by the vocabulary names (§8): status of an
ADR (first paragraph, clipped to 200), and the excerpt source in order —
context, "what was done", task — falling back to the body after the H1;
the excerpt is the first paragraph, clipped to 400 at a word boundary.
Role files give `owns` and `never` from labeled paragraphs
`**<label>:** …` joined across line breaks.

### 5.5 ADR status and replacement

In the status section only: a line containing the vocabulary word for
"replaces" with backticked ids yields `replaces`; a line with "replaced
by" yields the reverse edge. An id without an ADR node is a finding. The
first word of the status maps to a vault tag (`status/accepted`,
`proposed`, `rejected`, `superseded`).

### 5.6 Gate traces (`fired`)

The rule is unchanged from the source project (`atlas/lib/fired.js`,
design note `2026-09-10-0550` §"Правило → его следы"): a role name as a
whole word next to a gate mark in the same unit of a history record; units
are table rows, or prose fragments split by `;` and sentence end; negations
cancel; one trace per (role, line); the excerpt is the whole sentence or
row; `marks` are UTF-16 half-open offsets of unit, role and mark inside the
excerpt. Marks and negations are vocabulary (§8); word boundaries use the
vocabulary's letter class.

## 6. Optional sources

| Source | Read as | Absent from config |
|---|---|---|
| `deploy.compose` | narrow parser: `services:` with `image`, `depends_on`, `volumes`, `env_file` (short and `path:` long form), top-level `volumes:`; any other line inside a parsed block is a finding | no `service`, `volume`, `unit` deploy fields; no `depends`, `mounts`, `image`, `routes`, `serves` |
| `deploy.caddyfile` | `handle_path <prefix>*` blocks by brace depth; `reverse_proxy <service>:<port>` inside; comments ignored | `route` is `null` on units; no `routes` edges |
| `deploy.landing` | anchors `<a class="app" href="/<unit>/" data-date="…">` with a `class="app-text"` title | unit `title` = key, `date` = `null` |
| `deploy.providers` | JSON array of `{ id, kind, tier, model, … }`; only these four fields are read — `baseUrl` and the rest are never output | no provider externals |
| `units` | directory names | no `unit` nodes; every compose service is a `service`; no `about` edges |
| `agents.roles` | §5.2 | no roles/tiers; overlay references to roles are findings |
| `agents.skills`, `agents.skillsLock` | `SKILL.md` frontmatter; `skills[<name>]` in the lock marks a skill vendored | no skills / all skills own |
| `overlay` | §7 | no classes, phases, externals, manual calls, about overrides |

Listed but unreadable or unparsable input → finding (`file:1`). Unlisted →
silently absent, as above; this is the only difference between "optional
and off" and "broken".

## 7. Manual overlay

The only hand-written input: facts that exist in no machine-readable file.
Format is the overlay already used by ai-advent-2026 (`atlas/overlay.json`
at `1d882f4`), unchanged; the overlay has no format field. The `"_"` key is
a free comment.

```jsonc
{
  "classes":   [{ "id": "A", "title": "…", "what": "…", "gates": ["reviewer"], "note": "…" }],
  "phases":    [{ "n": 1, "title": "…", "roles": ["product-analyst"], "classes": ["A"], "exit": "…", "human": false }],
  "externals": [{ "id": "ghcr", "title": "…", "kind": "registry", "note": "…" }],
  "publishes": [{ "from": "github-actions", "to": "ghcr" }],
  "calls":     [{ "from": "day1", "to": "anthropic-api" }],   // from: compose service or unit
  "about":     { "<doc key>": { "units": ["day4"], "why": "…" } } // overrides filename-derived unit binding
}
```

The key of an `about` entry is `units` (format 2). An entry that still
carries the format-1 key `days` is a finding naming the rename, and its
value is **not** read — a silent fallback would drop the bindings without
saying so.

Every name in the overlay is validated against the graph: roles against
`agents.roles`, services against compose, externals against `externals` and
providers, unit keys against `units`, documents against the three collections.
Each mismatch is a finding pointing at the overlay line that holds the
value. Every `id` (`classes`, `externals`) matches
`^[A-Za-z0-9][A-Za-z0-9_-]*$` and every `phases[].n` is a positive integer;
a value that is not is a finding of class 6 (§11). An external node with no edge at all is a finding (it is not part of
the working system, or an edge is missing).

## 8. Vocabulary (`language`)

Everything the grammar matches by *meaning* is a vocabulary entry: the
section headings of documents, the ADR status words and replacement lines,
the labels of role facts, the gate marks of the trace rule and the
placeholder word of the citation grammar. Format 1 ships two vocabularies
as built-in modules of constants, `lib/vocab/ru.js` and `lib/vocab/en.js`,
selected by the config key `language` (`"ru"` or `"en"`; absent means
`"ru"`, so the ai-advent example is unchanged; any other value is a
config finding). `markdown.js`, `extract.js`, `fired.js` and `vault.js`
take the selected module as an argument. Values are regex sources; changing
a value is a format change.

Case follows the code and differs by key: `status.*` (`statusTag` in
`lib/vault.js`) and `fired.marks` / `fired.negations` (`word()` in
`lib/fired.js`) are matched **case-insensitively**; `sections.*`
(`section()`), `labels.*` (`labeledParagraph()`), `replaces`, `replacedBy`
and `placeholder` are matched **literally as written**. Keys:

| Key | `ru` | `en` | Used by |
|---|---|---|---|
| `letters` | `A-Za-zА-Яа-яЁё0-9_` | `A-Za-z0-9_` | word boundaries in the gate-trace rule |
| `sections.status` | `Статус` | `Status` | ADR status, replacement lines |
| `sections.excerpt` | `Контекст`, `Что сделано`, `Задача` (in order) | `Context`, `What was done`, `Task` | node excerpt |
| `labels.owns`, `labels.never` | `Владеет`, `Никогда` | `Owns`, `Never` | role facts |
| `replaces`, `replacedBy` | `Заменяет`, `Заменено\s+на` | `Supersedes`, `Superseded\s+by` | `replaces` edges |
| `status.accepted/proposed/rejected/superseded` | `Принято`, `Предложено`, `Отклонено`, `Заменено` | `Accepted`, `Proposed`, `Rejected`, `Superseded` | vault tags |
| `placeholder` | `имя` | not set (the key is optional) | template placeholder detection |
| `fired.marks` | `вето`, `блокирующ[а-яё]*`, `находк[а-яё]*`, `правки`, `переделать` | `veto(?:ed)?`, `blocking`, `findings?`, `changes\s+requested`, `request(?:ed)?\s+changes`, `rework` | gate traces |
| `fired.negations` | `нет`, `без\s+(?:вето\|находок\|блокирующих\|правок\|переделки)`, `не\s+(?:ставил\|наложил\|дал)` | `no`, `none`, `without\s+(?:a\s+)?(?:veto\|findings\|blockers\|changes\|rework)`, `(?:did\|does)\s+not\s+(?:veto\|block\|request\|find)` | gate traces |

The `en` values follow the usual English ADR and change-log wording:
Nygard's `Status` / `Context` and `Supersedes` / `Superseded by`; the
review verdicts of this project's design-review rendered in English
(`changes requested`, `rework`); `What was done` and `Task` as the history
record headings.

`placeholder` is optional, and `en` deliberately does not set it. The word
`name` would add `\bname\b` to the template-placeholder rule, and ordinary
citations would silently stop being citations: `` `guides/name-format.md` ``
or ADR `` `2026-01-01-0000-name-service.md` ``. The literal `name.md` of
§5.3 is part of that rule regardless of the vocabulary, so the `имя.md`
case under `ru` is covered for `en` without the key.

Independent of `language`, the following stay Russian in format 2 and are
not part of the input contract: vault note bodies (the fixed text around
the document — provenance block, fact labels, index), finding messages,
and the showcase UI.

Implementation requirement: with `language` absent or `"ru"` the ai-advent
example produces exactly the bytes of the compatibility criterion
(plan, mandatory criterion); `en` changes nothing on that path.

## 9. Secrets

Built-in patterns (exact regexes in `lib/texts.js`, assembled from pieces
so the file does not look like a leak):

- **fail** — a key with a tail: Anthropic key prefix + 10 or more key
  characters, a PEM private-key header, Groq key prefix + 20 or more,
  GitHub tokens `gh[pousr]_` / `github_pat_` + 20 or more (not inside a
  word). Found in any read document, raw or after markup stripping → a
  finding naming the pattern and line, never the match; nothing is written.
- **mask** — legitimately mentioned samples: bare or short-tailed Anthropic
  and Groq prefixes, the OpenSSH key header, CGNAT addresses `100.x.x.x`.
  Replaced by `[скрыто]` in `texts.json` as the last step; the count per
  node is reported by the build.

Both lists are built-in and not extensible from the config in format 2. The
same built-in *fail* list is what the CI secrets scan greps over the whole
tree (plan T9, T11); the showcase guard test asserts that no `mask` or
`fail` sample survives in any file under `<out>/site`.

## 10. Output contract

```text
<out>/.project-atlas        empty marker: this directory is owned by the tool
<out>/graph.json            same bytes as <out>/site/graph.json
<out>/site/index.html       template with project meta injected (§10.4)
<out>/site/app.js, style.css
<out>/site/graph.json
<out>/site/texts.json
<out>/vault/<dirs>/…        adr, history, design, guides, invariants, roles, units, services, skills, classes, phases, index.md
```

`<out>` is resolved with `realpath`; when it or its parent does not exist,
the `realpath` of the nearest existing ancestor is taken and the remaining
path segments are appended to it, and the directory is created only after
all checks below pass. The build writes only under `<out>` and creates the
marker `<out>/.project-atlas`.
Before writing it deletes `<out>/site` and the vault directories it owns
(`.obsidian/` is left alone) — but only when `<out>` does not exist, is
empty, or contains the marker; any other directory is refused with exit 2,
so a mistyped `--out` cannot delete someone's files. `<out>` must not be
`<root>` or one of its ancestors, must not contain any resolved input and
must not lie inside one; a directory under `<root>` that touches no input
(`<root>/dist`) is allowed. The marker is never written on refusal. Before
any write or deletion `lstat` checks everything the build touches under
`<out>`: `.project-atlas`, `graph.json`, `site`, `vault`, `vault/index.md`
and every `vault/<collection dir>`; a symbolic link among them is a refusal
with exit 2 — nothing deleted, nothing written. Every write goes only into
a directory whose `realpath` lies under `realpath(<out>)`; a marker inside
the root never lets a write escape `<out>`. Size limits are
built-in and not configurable: `texts.json` 3072 KiB, `graph.json`
1024 KiB, page code 256 KiB; exceeding one is a finding.

### 10.1 `graph.json`

`{ provenance: { sha, dirty, date }, nodes: [...], edges: [...] }`, two-space
indented, trailing newline. `provenance` is absent-valued (`null`, `false`,
`null`) without git. Node and edge shapes and order: §4. No format field
inside the file — adding one is a format change (it would break equality
with every consumer reading the file today).

### 10.2 `texts.json`

One object `{ "<node id>": "<text>" }` in node order, no indentation,
trailing newline. Set: `adr`, `history`, `design`, `guide`, `role` nodes and
non-vendored `skill` nodes. Processing: frontmatter, heading hashes, `**`,
backticks, table pipes and separator rows removed; link syntax reduced to
its text; whitespace collapsed; then masking (§9).

### 10.3 Vault

As produced by `atlas/lib/vault.js` at `1d882f4`: frontmatter first, then
the provenance comment block (source path, commit, commit time, read-only
notice), then the body with citations rewritten to wikilinks. Every note is
byte-equal to the source project's **up to the rename map** (§10.5: the
directory `units/`, the frontmatter key `unit:`, the tags `type/unit` and
`unit/N`) — except two: `index.md`, whose
provenance block names the generator as `build.js` instead of
`atlas/build.js` (the title stays `Атлас проекта`, without a project name);
and `skills/skill-inspector.md`, whose "Происхождение" line takes the
vendored set from the lock file (`NVIDIA/SkillSpector`) — the source wrote
`addyosmani/agent-skills` for every vendored skill, a factual error. The
plan's checkpoint C verifies this with `diff -r`.

### 10.4 What the showcase takes from the configuration

Injected into `site/index.html` at build time by replacing the placeholder
`<!-- atlas:meta -->` with `<meta>` tags, the `<title>`/`<h1>` text and
the repository link inside `<noscript>`:

| Config | Meta / element | Page use |
|---|---|---|
| `project.name` | `<title>`, `<h1>`, `meta[name=atlas-project]` | title, noscript text |
| `project.repo` | `meta[name=atlas-repo]`, `<noscript>` link | file links `${repo}/blob/${sha}/${file}#L${line}`, footer, noscript |
| `project.about` | `meta[name=atlas-about]` | footer "how it works" link `${repo}/blob/HEAD/${about}`; absent → link not rendered |

`app.js` reads these from the DOM and holds no project constant, branch
name or ADR id: the "how it works" caption is generic, and the fallback
sentence shown when the build had no commit names no branch. The lede
sentence about the day cycle is rendered only when `phase` nodes exist.

### 10.5 Format history

The tool's `package.json` version tracks releases; a format bump is a major
version. The tool supports **one** format at a time — the current one.

**Format 1** — this tool before `v2.0.0` (commit `0d9eab4`). Defined by byte
equality with ai-advent-2026 at `1d882f4`: the same `graph.json` and
`texts.json` as `node atlas/build.js` in that checkout. Numbered app units
were the node type `day`.

**Format 2** — since `v2.0.0`. The whole change is the rename `day` → `unit`:

| Where | Format 1 | Format 2 |
|---|---|---|
| node type, id | `day`, `day/<key>` | `unit`, `unit/<key>` |
| edge ends (`depends`, `mounts`, `routes`, `image`, `calls`, `about`) | `day/…` | `unit/…` |
| vault directory | `days/` | `units/` |
| vault frontmatter of a unit note | `day: N` | `unit: N` |
| vault tags (unit notes and documents bound by `about`) | `type/day`, `day/N` | `type/unit`, `unit/N` |
| overlay | `about.<doc>.days` | `about.<doc>.units`; `days` is a finding naming the rename |
| config | `"format": 1` | `"format": 2`; `1` is a finding listing the three consumer edits |
| showcase | type `day`, labels «День / Дни / дней» | type `unit`, labels «Приложение / Приложения / приложений» |

Unchanged by the rename: the config block `units` (`dir`, `prefix`) and unit
**keys** — a unit directory named `day1` stays the key `day1`; `texts.json`
(no unit nodes in it); `x`, `y`, `z`; and `marks.unit` on `fired` edges,
where "unit" is a fragment of the excerpt — a homonym, not a node type, and
deliberately not renamed.

Equality with format 1 is still checked: `test/compat.test.js` builds
ai-advent at `1d882f4` with the old package and this tool with the example
config, and compares them **up to the map above** (`test/rename-map.js`).

## 11. Findings and `--check`

A finding is `{ file, line, message }`, printed as `file:line: message`
(GitHub annotation `::error file=…,line=…::…` under `GITHUB_ACTIONS`); at
most 50 are printed, then a count. Any finding → exit 1 and **nothing
written**, in both modes; `--check` additionally never writes even when
clean. Closed list of finding classes:

1. configuration: unknown key, bad path (segment grammar, extension),
   deny-listed path — at load or at read, missing dependency between
   fields, `language` outside `ru`/`en` (`file` = the config path);
2. input listed but unreadable / a symbolic link in its path / resolving
   outside `<root>` / not JSON / compose line outside the parser subset;
3. atomic document without a timestamp in its name;
4. citation not resolving: ADR id, collection path, root doc, invariant;
5. role preloads an unknown skill;
6. overlay reference to an unknown role, class, service, external, unit or
   document; the format-1 key `days` in an `about` entry; `publishes`
   between unknown externals; an `id` outside the grammar of §7;
7. `deploy.registry.external` not declared in the overlay;
   `deploy.providers.service` or `deploy.proxy` not a compose service;
8. external node without any edge;
9. node id built twice (two sources claim one id);
10. replacement line naming an unknown ADR;
11. key sample with a tail in a read document (§9);
12. output size over a limit.

Isolated nodes of other types are not findings; the build prints their
count by type.

## 12. Behaviour when an optional input is absent

Summarised from §6 and §3.2: an input **not listed** in the config is
absent — no nodes, no edges, no findings, and grammar alternatives that
depend on it are not generated (a citation `` `design/x.md` `` in a project
without `docs.design` is a plain backticked word). An input **listed but
missing or unreadable** is a finding. A field whose dependency is not
configured is a config finding, not a silent no-op.

## 13. Fixed in format 2 (not configurable)

- invariant id shape `I-<n>` and the line form `- **I-N.** text`;
- the four document kinds and their node types; root docs as `guide`;
- node type and id namespaces, including `unit`;
- landing card HTML shape; Compose subset; Caddyfile subset;
- role frontmatter keys; `SKILL.md` layout; lock file shape;
- size limits; masking replacement text `[скрыто]`;
- the two vocabularies `ru` and `en` (§8) and the secret patterns (§9);
- `--serve` address `127.0.0.1:8080`;
- layout seed and algorithm.

## Appendix A. Example: ai-advent-2026

`examples/ai-advent-2026/atlas.config.json` — the schema in §3.2 with the
values shown there. The overlay is the repository's own
`atlas/overlay.json`.

## Appendix B. Example: minimal project (test fixture)

`test/fixtures/minimal/` — a synthetic repository, no text copied from
ai-advent-2026: `docs/adr/` with two ADRs (the second replaces the first),
`docs/history/` with one record citing both and carrying one gate trace,
`docs/invariants.md` with two invariants, `README.md` as the only root doc,
`agents/reviewer.md` as the only role, an overlay with one class and one
phase, and no `design`, `guides`, `skills`, `units` or `deploy` blocks:

```json
{
  "format": 1,
  "project": { "name": "Minimal", "repo": "https://example.invalid/minimal" },
  "docs": { "root": "docs", "adr": "adr", "history": "history", "invariants": "invariants.md", "rootDocs": ["README.md"] },
  "agents": { "roles": "agents" },
  "overlay": "atlas.overlay.json"
}
```
