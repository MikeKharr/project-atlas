# Example: ai-advent-2026

`atlas.config.json` here describes
[`MikeKharr/ai-advent-2026`](https://github.com/MikeKharr/ai-advent-2026), the
project project-atlas was extracted from. The manual overlay is that
repository's own `atlas/overlay.json`.

The configuration is pinned to commit
`1d882f40f8c37370b4dfbc3add650f10d1b11c1c`: on that commit the tool's
`graph.json` and `texts.json` are byte-for-byte equal to the repository's own
`node atlas/build.js` (format 1, see the main [README](../../README.md)).

## Run against a checkout

From the root of project-atlas:

```sh
git clone https://github.com/MikeKharr/ai-advent-2026 temp/reference
git -C temp/reference checkout --detach 1d882f40f8c37370b4dfbc3add650f10d1b11c1c
node build.js --root temp/reference --config examples/ai-advent-2026/atlas.config.json --out temp/ai-advent
```

The output lands in `temp/ai-advent/` (`graph.json`, `site/`, `vault/`).
Nothing is written into the checkout.

## Compare with the source package

```sh
ATLAS_REFERENCE_ROOT=temp/reference node --test test/compat.test.js
```

The test requires a clean checkout at that exact commit. It runs the
reference build (which writes only the ignored `atlas/dist/` of the checkout),
then this tool with the configuration above, and compares the outputs.
