# Governance

RoleHub separates authorship, technical compatibility, and trust. A popular role is not
automatically a safe role.

## Trust tiers

- **official** — maintained in this repository, reviewed, evaluated, and released by the
  project workflow.
- **verified-publisher** — maintained externally by a publisher whose namespace and
  release provenance are verified.
- **community** — indexed for discovery but not manually endorsed.
- **quarantined** — hidden from new installs while a security or ownership issue is
  investigated.
- **revoked** — blocked by catalog metadata; clients must refuse new installs.

Trust is catalog-owned metadata. A role author cannot declare their own trust tier.

## Compatibility decisions

The core specification represents role intent. Adapters represent harness mechanics.
When a harness cannot enforce an intent, the adapter must either fail in strict mode or
surface a precise warning in best-effort mode. Convenience is never a reason to silently
broaden permissions.

Schema changes start as proposals, include compatibility fixtures for at least two
harnesses, and document migration and security impact. The maintainer makes the final
merge decision after public review.

## Releases and removal

Published role versions are immutable. Catalog entries point to content digests, not
floating branches. A vulnerable release is revoked and replaced with a new version; it
is never overwritten. Running rooms and sessions keep their lock unless an operator
explicitly upgrades or policy blocks the digest.
