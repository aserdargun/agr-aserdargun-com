# The Agora archive

Verdict records, one JSON file each. The site builds `dist/timeline.json` from this
directory at build time, so the timeline is versioned, reviewable and revertible like any
other evidence in this portfolio.

## Why the archive is a directory and not an endpoint

A public write endpoint would let anyone publish a verdict. This one cannot: a record
enters only through a pull request, and it must survive `scripts/archive-contract.mjs`
before it ships. The integrity rule that matters is the same either way —

> A record is archivable only if the daily free-request counter moved by at least the cost
> the session declares.

Publishing therefore costs real free-model quota, so an invented record cannot be
published for free. The count is re-derived from the stored positions rather than accepted,
so a record that misreports its own tally is rejected rather than shown.

## Adding a record

1. Run a session in the browser and export it. The export is refused if the session cannot
   prove its own cost or if the count does not match the positions.
2. Validate and file it:

   ```bash
   node scripts/archive.mjs add ~/Downloads/agora-session-….json
   ```

3. Commit `archive/*.json`. CI runs `node scripts/archive.mjs verify` before the timeline is
   built, and a bad record fails the build instead of disappearing from the timeline.

## Reading it

- `node scripts/archive.mjs verify` — validate every record on its own.
- `node scripts/archive.mjs build` — validate, then write `dist/timeline.json`.
