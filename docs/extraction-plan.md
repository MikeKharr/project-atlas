# Extraction plan: `atlas/` → `MikeKharr/project-atlas`

For the `backend` role. Spec: `docs/input-spec.md`. Source: `atlas/` in
`MikeKharr/ai-advent-2026` at commit `1d882f4`
(a local checkout, `<ai-advent checkout>` below). Target: this directory,
`<project-atlas>`, a new public repository with a clean history.

The source repository is **not touched** by this plan: its `atlas/`, CI and
deployment keep working as they are. Migrating ai-advent-2026 onto the
tool is a separate task (options in the ADR).

## Acceptance criterion (mandatory)

On the clean checkout of ai-advent-2026 at `1d882f4`:

```sh
cd <ai-advent checkout> && git status --porcelain   # must be empty
node atlas/build.js                                 # reference
cd <project-atlas>
node build.js --root <ai-advent checkout> \
              --config examples/ai-advent-2026/atlas.config.json \
              --out temp/compat
cmp temp/compat/graph.json      <ai-advent checkout>/atlas/dist/graph.json
cmp temp/compat/site/texts.json <ai-advent checkout>/atlas/dist/site/texts.json
diff -r --exclude=index.md --exclude=skill-inspector.md --exclude=.obsidian \
        temp/compat/vault <ai-advent checkout>/atlas/dist/vault
diff -r --exclude=index.html --exclude=app.js \
        temp/compat/site  <ai-advent checkout>/atlas/dist/site
```

Both `cmp` and both `diff -r` exit 0. Both builds run on the same machine in the same
process environment: `provenance.date` and the vault's commit time are
formatted in the local timezone (`git show --date=format:`), so a reference
built under another `TZ` differs by design, not by defect. The showcase is
checked on the same data: `--serve` on `temp/compat/site` shows the same
graph and the same file links (pinned to the same sha); the footer differs
by design — a generic caption on the "how it works" link and `blob/HEAD` in
its address (spec §10.4).

Where equality is **not** expected, and why:

| File | Difference | Reason |
|---|---|---|
| `site/index.html` | `<meta name="atlas-*">` tags present | project values move from `app.js` constants to the page (spec §10.4) |
| `site/app.js` | no `REPO` / `ATLAS_ADR` constants | same |
| `vault/index.md` | `ИСТОЧНИК: build.js` | generator path is no longer a literal (spec §10.3); the title stays `Атлас проекта` |
| `vault/skills/skill-inspector.md` | "Происхождение" names `NVIDIA/SkillSpector` | the vendored set comes from `skills[<key>].source` in the lock file; the source wrote `addyosmani/agent-skills` for every vendored skill — a factual error (spec §10.3) |

Nothing else is allowed to differ. If a step below cannot preserve
equality, stop and record where and why in the PR — do not adjust the
reference.

## Architecture decisions carried into the code

- One new module, `lib/config.js`: loads, validates and resolves
  `atlas.config.json` into the structure the rest of the code consumes
  (paths, the unit prefix, grammar pieces). Everything downstream takes
  that structure as an argument; no module reads the config file itself.
- No `INPUTS` constant. `sources.js` builds the read guard from the config;
  the golden list in `test/sources.test.js` becomes the resolved list for
  the ai-advent example. The guard is the only place that touches the file
  system for inputs: `lstat` per component, `realpath` under the root, deny
  list at every read (spec §3.3).
- Vocabulary is a module of constants per language (`lib/vocab/ru.js`,
  `lib/vocab/en.js`), selected by `language` in the config, default `ru`;
  `markdown.js`, `extract.js`, `fired.js`, `vault.js` take it as an
  argument. `en` is T13, after the first commit.
- Project values reach the page through `<meta>` tags, not `graph.json`.
- Port, do not rewrite: the layout, compose parser, fired rule, texts and
  vault code move as they are; only literals become parameters. Rewriting
  is how equality is lost.

## Task list

Sizes: S 1–2 files, M 3–5 files. Each task ends with `node --test` green.

### Phase 0 — skeleton

- [ ] **T0. Copy the package.** Copy `atlas/{build.js,lib,web,test,README.md,package.json}` from the source checkout into the root of this repository (`lib/`, `web/`, `test/`, `build.js`). Do not copy `Dockerfile` and `Caddyfile` — they are ai-advent-2026 delivery, not the tool. Add `.gitignore` (`dist/`, `temp/`, `node_modules/`), `package.json` (`name: project-atlas`, `type: module`, `engines.node >=22`, scripts `build`, `check`, `test`; `license: MIT` and a `LICENSE` file — the owner's decision of 2026-09-12). First step after the copy, before running anything: redirect `ROOT` and `TEMP` in `test/helpers.js` to this repository (package root and `temp/`) — as copied they resolve into the source checkout, and a test run would read and write there.
  - Verify: `test/helpers.js` holds no path outside this repository; `node --test test/*.test.js` runs and fails only on inputs missing under the new `ROOT` — record the list of failing files, they are the ones to port in T7/T8.
  - Files: many, mechanical. Size M.

### Phase 1 — configuration and boundary

- [ ] **T1. `lib/config.js`.** `loadConfig(path)` → `{ config, findings }`; `resolveInputs(config)` → the resolved list of readable paths and list-only directories; validation per spec §3.2 (required fields, unknown keys, segment grammar `^(?!\.{1,2}$)[A-Za-z0-9._-]+$`, extension per field, deny list, field dependencies including `deploy.static` → `deploy.proxy`, distinct collection names, non-empty `units.prefix`).
  - Acceptance: every rule in spec §3.2–3.3 has a test; the ai-advent example config loads with zero findings; the minimal fixture config loads with zero findings.
  - Files: `lib/config.js`, `test/config.test.js`, `examples/ai-advent-2026/atlas.config.json`. Size M.

- [ ] **T2. `lib/sources.js` from config.** Replace `INPUTS` by the resolved inputs; `readSources(root, resolved)` returns the same shape as today with empty arrays / empty strings / `[]` / `{ skills: {} }` for unlisted inputs, and a finding for listed-but-missing ones. Landing, compose, caddy, providers, lock, overlay are each optional. Every read and every listing goes through the guard: `lstat` of each path component from the root down, a symlink component is a finding and the path is not read; `realpath` of the target must lie under `realpath(root)`; the deny list is re-checked at read time.
  - Acceptance: `test/sources.test.js` asserts the resolved list for the example equals today's `EXPECTED` list exactly; reading a deny-listed path throws; a symlink placed in a temp fixture (file and directory) yields a finding and no read; a path resolving outside the root yields a finding; unlisted input yields no finding.
  - Files: `lib/sources.js`, `test/sources.test.js`. Size S.

### Checkpoint A

- [ ] `node --test test/config.test.js test/sources.test.js` green.

### Phase 2 — grammar and extraction

- [ ] **T3. `lib/markdown.js` grammar from config; `lib/vocab/ru.js`.** `makeGrammar({ docsRoot, collections, rootDocs, vocab })` returns `scanCitations`, `mapCitations`, `replacementRefs`, `section` helpers bound to the project. The regex is assembled from the configured names, root-doc basenames regex-escaped; the placeholder word comes from the vocabulary. Keep the single-expression property (one regex for scan and rewrite).
  - Acceptance: with the ai-advent values the assembled regex source equals today's `CITE` source (golden string test); with the minimal fixture, `` `docs/adr/…` `` and `` `adr/…` `` both resolve, `` `design/x.md` `` is a plain word.
  - Files: `lib/markdown.js`, `lib/vocab/ru.js`, `test/markdown.test.js`. Size M.

- [ ] **T4. `lib/extract.js` parametrised.** Replace literals: `agent_docs/…` paths, `ROOT_DOCS`, `/^day\d+$/` and `/\b(day\d+)\b/` (both from `units.prefix`), `'service/caddy'`, `'service/router'`, `'ghcr.io/'`, the `site` node, `'atlas/overlay.json'`, `'router/config/providers.json'`, `'deploy/compose.yml'`, `'agent_docs/invariants.md'`, `.replace(/^claude-/, '')`, Russian section names. Add the new findings (spec §11 item 6 — overlay `id` grammar `^[A-Za-z0-9][A-Za-z0-9_-]*$`; item 7). Preserve node and edge order exactly (spec §4), including the two interleavings of §4.2: `depends` then `mounts` per compose service in compose order; `cites`/`relies`/`mentions` per citing document in citation order.
  - Acceptance: `test/extract.test.js` passes on the minimal fixture; the compatibility test (T7) is the real gate.
  - Files: `lib/extract.js`, `test/extract.test.js`. Size S in files, the largest diff of the plan.

- [ ] **T5. `lib/fired.js`, `lib/texts.js`, `lib/vault.js`.** Fired: marks, negations and the letter class from the vocabulary. Texts: built-in patterns only, nothing from the config. Vault, every literal of `atlas/lib/vault.js` at `1d882f4`: the collection prefixes of the wikilink resolver (lines 117–124: `development-history/`, `adr/`, `design/`, `guides/`, `AGENTS.md`, `agent_docs/`) from the configured collection names and root docs; `'agent_docs/invariants.md'` (172) from `docs.invariants`; `'deploy/compose.yml'` (290) from `deploy.compose`; `'нет: статика за caddy'` (305) with the `deploy.proxy` name; `` 'вендорный набор `addyosmani/agent-skills`' `` (339) with `skills[<key>].source` from the lock file; `ИСТОЧНИК` of the index note = `build.js`; index title unchanged (`Атлас проекта`, no project name); the `days` note number = key without `units.prefix` instead of `key.slice(3)`; status words from the vocabulary.
  - Acceptance: existing fired/texts/vault tests pass on the minimal fixture; `SAMPLES` still equals `MASKED + KEY_SAMPLES`; `grep -n "slice(3)\|agent_docs\|deploy/\|caddy\|addyosmani\|development-history" lib/vault.js` shows no project literal.
  - Files: three modules and their tests. Size M.

- [ ] **T6. `build.js` CLI and page meta.** `--root`, `--config`, `--out`, `--check`, `--serve` (fixed `127.0.0.1:8080`, no port argument). Output safety replaces `isDistDir` (spec §2, §10): `<out>` resolved with `realpath`; must not be `realpath(root)` or one of its ancestors, must not contain any resolved input and must not lie inside one (`<root>/dist` is allowed); `site/` and the owned vault dirs are deleted only when `<out>` does not exist, is empty, or contains the marker `.project-atlas` — otherwise exit 2; the marker is written on a successful build; before any write or deletion `lstat` every touched entry under `<out>` (marker, `graph.json`, `site`, `vault`, `vault/index.md`, collection dirs) — a symlink is exit 2 with nothing touched, and every write lands only in a directory whose `realpath` is under `realpath(<out>)` (spec §10). Provenance only when `git rev-parse --show-toplevel` equals `realpath(root)`. Page: `<!-- atlas:meta -->` in `web/index.html` replaced by the meta tags; `<title>`/`<h1>` from `project.name`; the `<noscript>` repository link (`web/index.html:19`) substituted from `project.repo` at build time, no literal left in the template. In `web/app.js`: read `atlas-repo` and `atlas-about` from the DOM; `ATLAS_ADR` (line 1106) becomes `${repo}/blob/HEAD/${about}`; the caption `'Как это устроено (ADR 2026-09-10-0550)'` (2560) becomes a generic one without an id; `'Схема собрана из ветки main.'` (2554) becomes a wording that names no branch; render the about link only when present; render the day-cycle sentence only when phases exist. In `build.js` the size-limit finding (lines 123–125) drops the ai-advent process text (`file: 'build.js'`, message without "PR класса B", `atlas/build.js` or the ADR id).
  - Acceptance: `node build.js --check` on the minimal fixture exits 0; `--out /`, `--out <root>`, `--out <root>/docs` and `--out` of a non-empty unmarked directory refuse with exit 2; a marked directory is rebuilt in place; page tests (`test/web.test.js` pure parts) pass on the fixture graph; `grep -rn "mikekharr\|ai-advent\|blob/main\|2026-09" web/index.html web/app.js build.js` shows no match outside comments. `web/style.css` is not edited: T7 compares it byte-for-byte.
  - Files: `build.js`, `web/index.html`, `web/app.js`, `test/build.test.js`. Size M.

### Checkpoint B — compatibility

- [ ] **T7. Compatibility test.** `test/compat.test.js`: skipped unless `ATLAS_REFERENCE_ROOT` is set; runs the reference `node atlas/build.js` in that root and this tool with the example config, then compares `graph.json` and `site/texts.json` byte-for-byte, runs `diff -r` over `vault/` (excluding `index.md`, `skills/skill-inspector.md` and `.obsidian`) and over `site/` (excluding `index.html` and `app.js`), and asserts the checkout is clean (`git status --porcelain` empty) and at `1d882f4`. Prints the first differing line (or the first differing file) on failure.
  - Acceptance: the mandatory criterion above passes locally.
  - Files: `test/compat.test.js`. Size S.

### Phase 3 — second project, CI, publication

- [ ] **T8. Minimal fixture and its tests.** `test/fixtures/minimal/` per spec Appendix B — synthetic text only, no sentences copied from ai-advent-2026. Port the tests that today copy inputs from the source repository (`test/helpers.js` `makeFixture`) to copy from the fixture instead; drop assertions that encode ai-advent numbers (e.g. "compliance has 11 traces") — the compatibility test covers them. Add tests for: absent optional inputs produce no nodes and no findings; listed-but-missing input is a finding; config findings for each dependency rule; `about` from filename with a custom `units.prefix`.
  - Acceptance: `node --test test/*.test.js` green without `ATLAS_REFERENCE_ROOT`; `node build.js --root test/fixtures/minimal --check` exits 0.
  - Files: fixture directory, `test/helpers.js`, touched tests. Size M.

- [ ] **T9. CI.** `.github/workflows/ci.yml`: job `test` — Node 22, `node --test test/*.test.js`, `node build.js --root test/fixtures/minimal --check`; job `secrets` — the same grep as ai-advent-2026 `docs-guard` (built-in fail patterns, `-l` only, exit codes handled); job `compat` — `actions/checkout` of `MikeKharr/ai-advent-2026` with `ref: 1d882f40f8c37370b4dfbc3add650f10d1b11c1c` (the full sha, not the short form) into `reference/`, then `ATLAS_REFERENCE_ROOT=reference node --test test/compat.test.js`. No secrets, `permissions: contents: read`.
  - Acceptance: all three jobs green on the first PR of the new repository.
  - Files: one workflow. Size S.

- [ ] **T10. Documentation.** `README.md` (English: what it is, invocation, config pointer, format-1 statement, source provenance), `README.ru.md` (same, Russian), `examples/ai-advent-2026/README.md` (how to run against a checkout). The original `atlas/README.md` content folds into `README.md` with paths updated.
  - Acceptance: every command in the READMEs runs as written.
  - Size S.

- [ ] **T11. Pre-publication secrets scan.** Over the whole tree, before the first commit: the built-in fail patterns (T9 grep), the mask samples (bare prefixes, the OpenSSH key header, CGNAT `100.x.x.x` addresses), `.env` files, private hostnames from the source project. Expected: **zero hits**. Known sources (line numbers as copied from `atlas/` at `1d882f4`) to fix first: `test/secrets.test.js:29` — the tailnet address from the source project, replace with a synthetic address of the same shape; `test/secrets.test.js:51` and the OpenSSH header sample in the README — write them from parts, as `lib/texts.js:34` does, so the literal never appears; the regex sources in `lib/texts.js` are already assembled from pieces and do not match themselves.
  - Acceptance: the grep returns nothing; result recorded in the first PR description.
  - Size S.

- [ ] **T12. First commit and repository.** `git init`, single first commit `chore: extract atlas from MikeKharr/ai-advent-2026 at 1d882f4` (no `Co-Authored-By` trailer). The public repository is created by the orchestrator after `reviewer` + `compliance` consensus (owner's decision); default branch `main`, branch protection as in the source project (PR required, CI required).

### Phase 4 — English vocabulary (owner's decision of 2026-09-12: now)

- [ ] **T13. `lib/vocab/en.js` and `language`.** Add the `en` module with the values of spec §8, key for key with `ru.js` except the optional `placeholder`, which `en` does not set (§8); `lib/config.js` accepts `language` (`ru` | `en`, absent → `ru`, anything else → class-1 finding) and hands the selected module to the modules that take a vocabulary. Test fixture `test/fixtures/minimal-en/` — the English twin of the minimal fixture (same files and graph, English headings, statuses, labels and one gate trace with an English mark and one cancelled by a negation) with `"language": "en"` in its config.
  - Acceptance: `node build.js --root test/fixtures/minimal-en --check` exits 0 and its graph has the same node and edge counts as the `ru` fixture; a config with `"language": "de"` is a finding; under `en` a citation whose name merely contains the word (`` `guides/name-format.md` ``, ADR `` `2026-01-01-0000-name-service.md` ``) is still a citation; T7 stays green with `language` absent and with `"language": "ru"` added to the example config (byte equality unchanged); no module matches input by a Russian literal. The guard is `test/vocab.test.js`, and it takes the words from the **values of `lib/vocab/ru.js`**, not from a list written in the test, so it grows with the vocabulary. It flags a string or regex literal whose whole content is such a word, with or without regex wrapping (`'Контекст'`, `'^Принято'`, `/вето/i`, `` /Заменено\s+на/ ``) — the shape a re-hardcoded matcher has. Russian prose is **output**, not matching: finding messages and the fixed text of vault notes stay Russian under any `language` (spec §8, "Independent of `language`…"), and the note text is part of the byte-for-byte vault comparison of the mandatory criterion, so it must not change. The test names the two kinds of exception: the note fallbacks `'нет'` in `lib/vault.js` (`Образ: нет` and the like — allowed by an explicit list together with their count, three), and the role-fact labels `` `- Владеет:` `` and `` `- Никогда:` `` there, each asserted to be exactly one line. A positive control proves the guard catches `section(text, 'Контекст')`; a negative control proves it stays quiet on a phrase that merely contains a word. Any new occurrence anywhere fails the test.
  - Files: `lib/vocab/en.js`, `lib/config.js`, fixture directory, `test/config.test.js`, `test/extract.test.js`. Size M.

### Checkpoint C — done

- [ ] Mandatory criterion passes locally and in the `compat` job.
- [ ] `node --test` and `--check` green on the minimal fixture without the reference checkout.
- [ ] Secrets scan (T11) returns zero hits; no file from the source repository's documents copied into fixtures.
- [ ] Both `diff -r` runs of the criterion are empty: the four files of the table above are the only differences — under `<out>/vault` `index.md` and `skills/skill-inspector.md`, under `<out>/site` `index.html` and `app.js` (spec §10.3, §10.4).

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Node or edge order drifts while parametrising `extract.js` → layout differs → equality fails | High | Port line by line; run T7 after every change to `extract.js`; the compat test prints the first differing line |
| A literal missed (e.g. `'deploy/compose.yml'` in a finding path or vault note) | Medium | grep the tree for `agent_docs`, `deploy/`, `days/`, `router`, `caddy`, `ghcr`, `claude-`, `mikekharr`, `zpq` before T7 |
| Timezone of the compat job vs local goldens | Low | no stored goldens; both builds run in the same job |
| `web.test.js` and friends depend on the ai-advent graph (counts, specific ids) | Medium | run them on the fixture graph; move count assertions to T7 |
| The overlay of ai-advent at `1d882f4` gains a field later and the example stops matching | Low | the example is pinned to `1d882f4`; migrating ai-advent is a separate task |
| Publishing widens what is public | Low | the code and docs are already public in ai-advent-2026; only the spec, plan, fixture and example config are new text — T11 checks them |

## Owner's decisions (2026-09-12)

1. The `language` key and the `en` vocabulary — now (spec §8, T13).
2. License of `project-atlas` — MIT (T0).
3. Rename node type `day` → `unit` (format 2) — at the ai-advent
   migration, which is the next task after this plan.
