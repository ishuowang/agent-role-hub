# Registry and distribution

RoleHub begins as a GitHub-native federated registry.

## Source and discovery

The official repository contains reference roles and the generated static catalog.
External publishers keep roles in their own repositories and submit a catalog entry that
points to an immutable artifact. GitHub Discussions hosts role requests and protocol
proposals; issues track actionable work.

Publisher names use reverse-domain ownership:

- `io.github.<owner>/<role>` for GitHub identities;
- `com.example/<role>` after DNS ownership verification; and
- a reserved project namespace for official roles.

## Artifacts

MVP artifacts are deterministic archives attached to immutable GitHub Releases. A
catalog row records the role id and version, source commit, artifact URL, SHA-256 digest,
manifest digest, publisher, license, requested-capability summary, compatible adapters,
trust tier, and revocation status.

The OCI phase publishes the same bundle with:

```text
artifactType: application/vnd.rolehub.agent-role.v1
config:       application/vnd.rolehub.agent-role.config.v1+json
```

Consumers install by digest. Human-friendly versions are resolution hints only.

## Locks

`bundle.lock.json` proves the exact files in one artifact. A runtime creates a separate
installation lock containing the resolved artifact digest, effective capability grant,
tool-provider identities, adapter and harness versions, and verification result.

Locks never contain secret values. An active session does not auto-upgrade when the
catalog changes.

## Revocation

Published content is not rewritten. A compromised version is added to
`catalog/revoked.json` with its digest, reason category, timestamp, and replacement when
available. New installation must fail. Existing runtimes apply local policy: warn,
quarantine, or terminate based on severity.

## Future service

A dedicated registry API is justified only when static discovery no longer meets search,
federation, mirroring, or enterprise-policy needs. It must retain content-addressed
artifacts and offline-verifiable metadata rather than becoming a mutable source of role
content.
