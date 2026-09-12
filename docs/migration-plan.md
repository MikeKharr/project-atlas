# Migration plan: format 2 (`day` → `unit`) and the ai-advent-2026 switch

Continues `docs/extraction-plan.md`. Decision record (proposed, owner
accepts): `agent_docs/adr/2026-09-12-0440-atlas-migration-to-project-atlas.md`
in `MikeKharr/ai-advent-2026` — the ADR holds the decisions and the PR
sequence; this file holds the per-file tasks for **this** repository. The
ai-advent side (workflows, script, config, deletion of `atlas/`) is in the
ADR, section 7, and is not repeated here.

Sequence: **P1** (this repo: format 2, `en` status-tag test, compat with a
rename map, `v2.0.0`) → **T** (tag) → **A1** (ai-advent switches, class A)
→ **A2** (ai-advent docs, class C) → **P2** (this repo: `compat` becomes a
golden job pinned to post-migration ai-advent).

Owner's decisions (2026-09-12), not revisited here: the tool is consumed by
a tag-pinned clone in CI; `day` → `unit` happens now; the `en` status-tag
gap is closed now; nothing under `days/dayN/` of ai-advent is touched;
tags are created by the agent after the merge and a green CI (the
ruleset `protect-version-tags` in this repository protects `v*` from being
moved or deleted); the showcase label is «Приложение» with no config key
for it; the golden job pins the ai-advent commit **after A2**.

## Rename map (format 2)

This table is the whole format change. It is the normalisation in the
compat test (R6), the new "Format history" section of the spec (R8) and
the consumer's migration checklist.

| Where | Format 1 | Format 2 |
|---|---|---|
| node type, id | `day`, `day/<key>` | `unit`, `unit/<key>` |
| edge ends (`depends`, `mounts`, `routes`, `image`, `calls`, `about`) | `day/…` | `unit/…` |
| vault directory | `days/` | `units/` |
| vault frontmatter of a unit note | `day: N` | `unit: N` |
| vault tags (unit notes and documents bound by `about`) | `type/day`, `day/N` | `type/unit`, `unit/N` |
| overlay | `about.<doc>.days` | `about.<doc>.units`; `days` is a finding naming the rename |
| config | `"format": 1` | `"format": 2`; `1` is a finding listing the three consumer edits |
| showcase | family "Система": `day`; labels «День / Дни / дней»; panel `case 'day'` | `unit`; «Приложение / Приложения / приложений»; `case 'unit'` |

Unchanged: the config block `units` (`dir`, `prefix`); `texts.json` (no
unit nodes in it); `marks.unit` on `fired` edges (there "unit" is a text
fragment — a homonym, named in the spec, not renamed); `x`, `y`, `z`
(expected unchanged: every unit of ai-advent is in the main component; if
the compat test shows them moving, that is a component-order tie in
`lib/layout.js` — fix or document it, never fold it into the map);
the internal name `sources.days` becomes `sources.units` — not a format
matter. The tool supports format 2 **only**.

## P1 — format 2, `en` guard, compat with the map, release

Sizes: S 1–2 files, M 3–5 files. Each task ends with `node --test
test/*.test.js` green. One PR; commits per task are fine. **The first
commit of the PR is this file**, `docs/migration-plan.md` — until then it
lives only in the owner's working copy and is not in git.

- [ ] **R1. `lib/extract.js`, `lib/sources.js` — nodes and edges.**
  `id: \`unit/${name}\``, `type: 'unit'`, `unitId()` → `unit/`, the
  `about` loop reads `override.units`; `sources.days` → `sources.units`
  in both modules. Finding texts: «в about указан день …» → «… указана
  единица …». New finding: an `about` entry carrying `days` →
  `` в about ключ `days` переименован в `units` (формат 2) `` at the
  overlay line of that key, and the entry's `days` is **not** read.
  - Acceptance: `test/extract.test.js` ids read `unit/app1`, `unit/app2`;
    the `about` override test uses `units`; a fixture overlay with `days`
    yields exactly that finding and no `about` edge.
  - Files: `lib/extract.js`, `lib/sources.js`, `test/extract.test.js`,
    `test/check.test.js` (lines 175, 180: `days` → `units`),
    `test/sources.test.js` (`src.days` → `src.units`). Size M.

- [ ] **R2. `lib/vault.js` — notes of units.** `VAULT_DIRS`: `days` →
  `units`; `DIR_OF.unit = 'units'`; the units loop filters `type ===
  'unit'` and writes `{ type: 'unit', …, unit: n, tags: ['type/unit',
  \`unit/${n}\`] }`; document notes bound by `about` get `unit/${n}`
  (line 167 today). Note bodies stay Russian and otherwise byte-identical.
  - Acceptance: `test/vault.test.js` on the deploy fixture (`addDeploy`)
    finds `units/app1.md` with `unit: 1` and tags `[type/unit, unit/1]`,
    and the history note bound to `app2` carries `unit/2`; no file or tag
    under `days`/`day/` anywhere in the vault.
  - Files: `lib/vault.js`, `test/vault.test.js`. Size S.

- [ ] **R3. `lib/config.js` — format 2.** `raw.format !== 2` → finding
  `` `format` — поддерживается только формат 2, задан 1: узлы `day` стали `unit`, в overlay `about.*.days` → `about.*.units`, поднимите `format` до 2 `` (for `1`); any other value → the generic message. Fixture configs
  (`test/fixtures/minimal`, `minimal-en`) and `examples/ai-advent-2026/atlas.config.json`
  get `"format": 2`.
  - Acceptance: `test/config.test.js`: format 1 → that message; format 2
    loads; both fixtures `--check` exit 0.
  - Files: `lib/config.js`, `test/config.test.js`, three JSON files.
    Size M.

- [ ] **R4. Showcase.** `web/app.js`: `FAMILIES` (`sys` types), `TYPE_NAME`
  / `TYPE_PLURAL` / `TYPE_MANY` keys `unit` with «Приложение /
  Приложения / приложений», the panel `case 'unit'` (fields unchanged:
  date, route, dir, image, env files). `grep -n "'day'\|\"day\"\|День\|Дни\|дней" web/` must show only the new labels or nothing. `web/index.html`: no change expected — verify by grep.
  - Acceptance: `test/web.test.js` (pure parts) passes on a synthetic graph
    with `unit/` ids; `familyOf('unit') === 'sys'`; `familyOf('day')`
    falls to the default and is asserted **not** to be `sys` (proof the
    old key is gone).
  - Files: `web/app.js`, `test/web.test.js`. Size S.

- [ ] **R5. `en` status tags — the missing guard.** New
  `test/vault-en.test.js` (or a block in `test/vault.test.js`): copy
  `FIXTURE_EN` into `TEMP`, `run({ root, out })`, read
  `vault/adr/2026-01-15-1000-indexed-storage.md` and assert its
  frontmatter `tags` contain `status/accepted`; read
  `vault/adr/2026-01-10-0900-plain-storage.md` and assert
  `status/superseded`. Negative control in the same test: rewrite the
  first ADR's status line to `Принято.` in the copy, rebuild, and assert
  the note has **no** `status/` tag — the `en` vocabulary must not
  recognise the Russian word. Mutation check before committing: replace
  `vocab.status[key]` in `statusTag` with `'При' + 'нято'` for `accepted`
  and confirm the new test fails (it did not before: 408 pass, compat 4/4).
  - Acceptance: the test fails on the mutant and passes on `main`.
  - Files: one test file. Size S.

- [ ] **R6. `test/rename-map.js` and `test/compat.test.js` — equality up
  to the map.** The reference stays the pre-migration source commit
  (immutable; the old package inside it still builds).

  `test/rename-map.js` is the single implementation of the map: it exports
  `normalizeGraph(text)` (parse; map `nodes[].id`, `nodes[].type`,
  `edges[].from`, `edges[].to`; drop `provenance`; re-serialise with
  `JSON.stringify(_, null, 2) + '\n'`), `normalizeNote(text)` (frontmatter
  key `day:` → `unit:`, tags `type/day` → `type/unit`, `day/N` →
  `unit/N`, provenance block lines dropped) and `compareOutputs(refDir,
  ourDir)` which returns the first difference or `null` over: `graph.json`
  (normalised both sides), `site/texts.json` (bytes), and `vault/` — the
  reference's file list with `vault/days/` → `vault/units/`, each note
  after `normalizeNote`, including document notes bound by `about`. It also
  runs as a command, `node test/rename-map.js <ref-dist> <our-out>`,
  printing the first difference and exiting 1, or «различий нет» and 0 —
  the ai-advent migration PR uses that command on its own tree (ADR §6).
  Coordinates are **not** mapped.

  `test/compat.test.js`, `buildBoth()`: **first** assert the reference is
  clean **by content**, not by `git status` — `git ls-files -v | grep
  '^[a-z]'` is empty (no file carries `assume-unchanged`) and
  `git hash-object atlas/overlay.json` equals `git rev-parse
  HEAD:atlas/overlay.json`; on mismatch fail before any build with the
  repair commands in the message (`git update-index --no-assume-unchanged
  atlas/overlay.json; git checkout -- atlas/overlay.json`). Then build the
  reference as today; rewrite `reference/atlas/overlay.json` in place —
  every `about.<doc>.days` → `units`, formatting otherwise preserved — and
  run `git update-index --assume-unchanged atlas/overlay.json` so
  `provenance.dirty` stays `false` (the `source` string
  `atlas/overlay.json` on class/phase/external nodes is unchanged too);
  build ours with the example config (format 2). In `finally`:
  `--no-assume-unchanged`, `git checkout -- atlas/overlay.json`, and the
  same two content checks again. Comparison via `compareOutputs`, keeping
  the four existing `EXCEPTIONS` for `site/index.html`, `site/app.js`,
  `vault/index.md`, `vault/skills/skill-inspector.md`.
  - Acceptance: `ATLAS_REFERENCE_ROOT=<clean pre-migration checkout> node --test test/compat.test.js` — green locally and in the `compat` job; after a run, and after a deliberately failed run, both content checks pass on the checkout; with `assume-unchanged` left set by hand, the test fails **before** building and names the repair; `node test/rename-map.js` on two identical outputs exits 0 and on a one-tag difference in a vault note exits 1 naming the file.
  - Files: `test/rename-map.js`, `test/compat.test.js`. Size S.

- [ ] **R7. `node build.js --samples`.** Prints the regex sources of
  `KEY_SAMPLES` (`lib/texts.js`), one per line, and exits 0; nothing else
  is printed, nothing is read or written; the flag is documented in
  `docs/input-spec.md` §2 and the README as the stable interface the
  consumer's CI uses to compare its own secrets grep with the tool's list
  (ai-advent `test/secrets-step.test.js`, ADR §3). The sources are already
  assembled from pieces, so the output does not look like a key.
  - Acceptance: `node build.js --samples | wc -l` equals
    `KEY_SAMPLES.length`; each line equals the corresponding `.source`;
    `--samples --check` is a usage error (exit 2); the `secrets` CI job
    stays green (the output is not committed anywhere).
  - Files: `build.js`, `test/build.test.js`, `docs/input-spec.md`,
    `README.md`. Size S.

- [ ] **R8. Spec, READMEs, example, version.** `docs/input-spec.md`:
  title and intro say format 2; §4.1 row `unit`, drop the "`day` is kept"
  paragraph; §4.2 edge ends; §6 table (`unit` nodes, `route` null on
  units); §7 overlay `units` and the `days` finding; §10 vault dirs
  `units`; §11 class 6 wording; §13 «including `unit`»; new section
  **Format history**: format 1 = this tool before `v2.0.0` (commit
  `0d9eab4`), defined by byte equality with pre-migration ai-advent; format 2
  = the rename map above, and the `marks.unit` homonym. `README.md`,
  `README.ru.md`: "Compatibility" section describes the format-2 compat
  (P1) and points to Format history. `examples/ai-advent-2026/README.md`:
  the example is the consumer's `atlas/atlas.config.json` after its
  migration; the pre-migration run instructions move to the compat section
  and note the overlay key rewrite. `package.json` → `2.0.0`.
  - Acceptance: every command in the READMEs runs as written;
    `grep -rn "day/" docs/input-spec.md README*.md examples/` shows only
    Format history.
  - Files: five documents, `package.json`. Size M.

### Checkpoint P1

- [ ] `test`, `secrets`, `compat` green on the PR.
- [ ] `node build.js --root test/fixtures/minimal --check` and `… minimal-en …` exit 0.
- [ ] Mutation check of R5 recorded in the PR description (fails on the mutant).
- [ ] No `days/`, `day/`, `'day'` left in `lib/`, `web/`, `test/` except the compat map and Format history.

- [ ] **T. Tag.** After the merge and a green CI on `main` (the agent does
  this — owner's decision): `git tag -a v2.0.0 <merge sha> -m "format 2:
  day → unit"`; `git push origin v2.0.0`; `TOOL_SHA` for ai-advent's
  `.github/scripts/atlas-tool.sh` is taken with `git rev-parse v2.0.0^{}`,
  never copied from a description (ADR §4). The ruleset
  `protect-version-tags` forbids moving or deleting `v*`; a bad release
  gets `v2.0.1`.

## P2 — `compat` becomes the golden job (after **A2** merges in ai-advent)

- [ ] **G1. Golden file.** `test/golden/ai-advent-2026.txt`: three lines
  `<sha256>  graph.json`, `<sha256>  site/texts.json`, `<sha256>  vault`
  plus a header comment with the pinned ai-advent sha — the merge commit
  of A2 (owner's decision: the migration documents are already in the
  graph). Generated once, locally, with the exact commands of G2
  (`TZ=UTC`).
  - Files: one file. Size S.

- [ ] **G2. Workflow.** Job id stays `compat` (the branch's required
  checks are not edited): checkout `MikeKharr/ai-advent-2026` at the
  pinned post-migration sha (full 40 hex) into `reference/`,
  `persist-credentials: false`; `env: TZ: UTC`;
  `cmp examples/ai-advent-2026/atlas.config.json reference/atlas/atlas.config.json`;
  `node build.js --root reference --config reference/atlas/atlas.config.json --out temp/golden`;
  `sha256sum` of `graph.json` and `site/texts.json`; for the vault
  `(cd temp/golden/vault && find . -type f | LC_ALL=C sort | xargs sha256sum) | sha256sum`;
  compare with G1 (`diff`). On mismatch print node and edge counts by
  type so the reader sees the shape of the drift.
  - Acceptance: green on `main` after G1; a deliberate one-character change
    in `lib/extract.js` output makes it red.
  - Files: `.github/workflows/ci.yml`. Size S.

- [ ] **G3. Retire the pre-migration reference.** Delete `test/compat.test.js`
  and `test/rename-map.js`; `README.md` / `README.ru.md` "Compatibility"
  describes the golden job and the regeneration rule: a PR that changes
  output bytes regenerates G1 in the same PR and says why.
  - Files: test file, two READMEs. Size S.

### Checkpoint P2

- [ ] `compat` green with the golden content; the pre-migration checkout is no longer referenced anywhere.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Layout coordinates move after the rename (component-order tie) | Medium | R6 does not map coordinates; a diff there is investigated in `lib/layout.js`, not normalised away |
| `assume-unchanged` left set on the reference checkout after a crashed run — `git status` would then be empty over a replaced file | Medium | R6 checks the reference **by content** (`ls-files -v`, `hash-object` vs `HEAD:`) before building and in `finally`, and fails before any comparison when it is not clean |
| The A1 PR of ai-advent edits an input and the "empty diff" criterion cannot hold | Medium | the ADR splits A1 (code, overlay key) from A2 (docs); reviewer checks the file list |
| Golden regenerated to hide an accidental change | Medium | the regeneration rule requires a written reason; the reviewer reads it against the diff |
| Timezone in the golden job | Low | `TZ=UTC` in the job and in the generating command |
