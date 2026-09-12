# Example: ai-advent-2026

`atlas.config.json` here describes
[`MikeKharr/ai-advent-2026`](https://github.com/MikeKharr/ai-advent-2026), the
project project-atlas was extracted from. After that repository migrates onto
the tool, this file is a copy of its own `atlas/atlas.config.json`, and its CI
compares the two with `cmp` — a drift between them is a failed job, not a
surprise at build time. The manual overlay stays in the consumer's repository
(`atlas/overlay.json`).

The configuration is format 2: nodes of numbered app units are `unit`, and the
overlay binds documents to units with `about.<doc>.units`.

## Run against a checkout

From the root of project-atlas, against a checkout **after** the migration —
one whose overlay uses the format-2 key `about.<doc>.units`:

```sh
git clone https://github.com/MikeKharr/ai-advent-2026 temp/reference
node build.js --root temp/reference --config examples/ai-advent-2026/atlas.config.json --out temp/ai-advent
```

The output lands in `temp/ai-advent/` (`graph.json`, `site/`, `vault/`).
Nothing is written into the checkout.

At the pinned commit `1d882f40f8c37370b4dfbc3add650f10d1b11c1c` that same
command exits 1 and writes nothing. That tree predates the migration: its
`atlas/overlay.json` still carries the format-1 key `about.<doc>.days`, and
the tool says so instead of guessing:

```text
atlas/overlay.json:125: в about ключ `days` переименован в `units` (формат 2)
```

That is the tool working, not a defect — the finding names the edit the
consumer has to make. To build that commit anyway, use the compatibility
test below: it rewrites the key for the duration of the run and restores it
in `finally`.

## Compare with the source package

```sh
ATLAS_REFERENCE_ROOT=temp/reference node --test test/compat.test.js
```

The test requires a clean checkout at that exact commit. It runs the
reference build (which writes only the ignored `atlas/dist/` of the checkout),
rewrites the overlay key to `units` in place for the duration of the run, and
compares the outputs **up to the rename map** — see "Compatibility" in the
main [README](../../README.md). It checks the checkout's cleanliness by
content before and after, and restores the overlay in `finally`.
