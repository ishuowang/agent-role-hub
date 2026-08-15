# Roadmap

## v0.1 — portable role foundation

- v1alpha1 universal, data-only role schema
- deterministic lock and role archive
- instruction-only `SKILL.md` bundles
- security validation and adversarial eval fixtures
- GitHub PR checks and Pages catalog

## v0.2 — independent compatibility packages

- zero harness names or platform fields in the role core and role catalog
- separate compatibility SDK and registry
- `rolehub compat ...` discovery, inspection, and explicit export
- native packages for Claude Code, Codex, OpenCode, Pi, and DSHarness
- digest-bound effective policy receipts and compatibility output locks
- strict-failure and report-only best-effort conformance tests

## v0.3 — verified federation and room runtimes

- external publisher and third-party compatibility entries
- immutable GitHub Release and OCI verification
- provenance, SBOM attestations, and namespace ownership verification
- generic invite/resume/leave lifecycle SDK
- DSHarness Role Runtime hardened after its developer-preview API stabilizes
- session managers for dedicated Claude, Codex, OpenCode, and Pi processes
- runtime cache reconciliation, revocation, and capability/behavior diffs

## v1.0 — stable ecosystem contracts

- stable role protocol and compatibility SDK
- signed role and compatibility catalog metadata with rollback protection
- compatibility certification suite and tested harness-version matrix
- private/enterprise registries and organization allowlists
- documented security response and publisher appeals

Executable tools remain outside ordinary role bundles. Any future code extension will use
a separate artifact kind, isolated runtime, permission flow, and trust policy; it will not
turn universal roles into plugins.
