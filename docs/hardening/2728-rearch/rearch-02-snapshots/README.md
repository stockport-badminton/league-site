# REARCH-02 step 4 snapshots

The argument sets used to prove the move from `team${season}` archives to the
`<entity>_at` views. They cover every season with history, plus 20202021, the current
season by name, and the current season by omission. The results are gitignored (37 MB).
To retake them against the local database, from the repository root:

    S=docs/hardening/2728-rearch/rearch-02-snapshots
    for a in $S/*.args.json; do f=$(basename $a .args.json)
      node tools/query-snapshot.js $f --args $a --out $S/$f.after.json; done

For a "before", run the same loop from a checkout of `d82a43d`. The brief's step 4 lists
every expected difference.
