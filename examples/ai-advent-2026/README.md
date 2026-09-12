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

On a tree that predates the migration the same command exits 1 and writes
nothing: such a tree's `atlas/overlay.json` still carries the format-1 key
`about.<doc>.days`, and the tool says so instead of guessing:

```text
atlas/overlay.json:125: в about ключ `days` переименован в `units` (формат 2)
```

That is the tool working, not a defect — the finding names the edit a consumer
still on format 1 has to make.

## Pinned output

The `compat` CI job builds this example against a pinned commit of the consumer
and compares three `sha256` sums with `test/golden/ai-advent-2026.txt`. The same
job checks with `cmp` that this file is byte-equal to the consumer's own
`atlas/atlas.config.json`: a drift between them is a failed job, not a surprise
at build time. See "Compatibility" in the main [README](../../README.md) for the
commands and for the rule on regenerating the golden.
