# Registry and distribution

RoleHub begins as a GitHub-native federated registry with two independent indexes.

## Role catalog

The role catalog contains universal role identity, version, immutable digests, publisher,
license, tags, requested abstract capabilities, trust tier, and revocation state. It does
not contain a harness list, adapter field, compatibility declaration, target version, or
native tool mapping.

External publishers keep roles in their own repositories and submit entries pointing to
immutable artifacts. Publisher names use reverse-domain ownership:

- `io.github.<owner>/<role>` for GitHub identities;
- `com.example/<role>` after DNS ownership verification; and
- a reserved project namespace for official roles.

## Compatibility registry

The compatibility registry is generated separately. Each entry identifies a package,
compatibility id and version, supported harness range, transport, implementation summary,
and documentation. Updating this registry cannot change a role digest or role catalog row.

Built-in packages ship with the CLI. A third-party package must already be installed and
is loaded only through an explicit `--using <package-specifier>` choice. Registry presence
does not confer trust: compatibility packages are executable host-side code and require
normal dependency review and pinning.

Generate both indexes independently:

```bash
rolehub catalog build --roles roles --out catalog/index.json
rolehub compat catalog --out compatibility/index.json
```

## Artifacts and locks

Role artifacts are deterministic archives attached to immutable GitHub Releases. A
catalog row records the source commit, artifact URL, SHA-256 digest, manifest digest, and
provenance. The OCI phase will publish the same role bundle as:

```text
artifactType: application/vnd.rolehub.agent-role.v1
config:       application/vnd.rolehub.agent-role.config.v1+json
```

Consumers install roles by digest. `bundle.lock.json` proves the exact files in one role
artifact. Compatibility output creates a separate lock containing role digests,
compatibility identity/version, effective policy digest, and output file hashes. Neither
lock contains secret values, and active sessions never float to a newer catalog entry.

## Revocation

Published content is not rewritten. A compromised role or compatibility package version
is marked revoked with its digest/version, reason category, timestamp, and replacement
when available. New use must fail. Existing hosts apply their local response policy:
warn, quarantine, or terminate according to severity.

## Future service

A dedicated registry API is justified only when static discovery no longer serves search,
federation, mirroring, or enterprise policy. It must retain content-addressed artifacts,
separate role and compatibility indexes, and offline-verifiable metadata rather than
becoming a mutable source of role content.
