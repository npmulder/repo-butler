# Fixture Provenance

The committed subset manifests are normalized snapshots of upstream benchmark
instances. Each fixture records:

- the upstream instance id,
- the buggy base SHA,
- the merged fix SHA,
- the issue text used for triage,
- and the known failing test path(s) from the benchmark dataset.

The loader in [`benchmarks/fixtures.ts`](../fixtures.ts)
validates these manifests before the runner starts.
