# Keep notes in files with an index

## Status

Accepted. Supersedes `2026-01-10-0900`.

## Context

There are more notes now, and scanning every file is slow. ADR
`2026-01-10-0900` left the files as the source of truth; the index is built
from them and keeps nothing of its own.

## Decision

The index is rebuilt from the files, and an edit goes into a file (I-2).
The check before a merge is run by `reviewer`.
