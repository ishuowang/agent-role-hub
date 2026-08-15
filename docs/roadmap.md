# Roadmap

## v0.1 — portable, data-only roles

- v1alpha1 JSON Schema and security validator
- deterministic lock and role archive
- static catalog generation
- instruction-only `SKILL.md` bundles
- Claude Code, Codex, OpenCode, Pi, and DSH adapter reports
- reference roles and adversarial eval fixtures
- GitHub PR checks and Pages catalog

## v0.2 — verified federation

- external publisher entries
- immutable GitHub Release verification
- OCI publication to GHCR
- provenance and SBOM attestations
- namespace ownership verification
- capability and behavior diffs in pull requests

## v0.3 — room runtimes

- generic invite/leave lifecycle SDK
- DSH Role Runtime adapter
- Claude and Pi sidecar session managers
- effective-permission approval UI contract
- runtime locks, cache reconciliation, and revocation handling

## v1.0 — stable ecosystem contract

- stable schema and adapter interface
- signed catalog metadata and rollback protection
- private/enterprise registries and organization allowlists
- compatibility certification suite
- documented security response and publisher appeals

Executable tools remain outside ordinary role bundles. If RoleHub later supports code
extensions, they will use a separate artifact kind, isolated runtime, permission flow,
and trust policy.
