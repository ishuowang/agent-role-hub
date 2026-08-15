# RoleHub agent guide

RoleHub is a harness-neutral role protocol and community registry. DSH, Claude Code,
Codex, OpenCode, Pi, and future runtimes are adapters; none of them defines the core
schema.

## Repository rules

- Start work from a `feature/<short-name>` branch.
- Submit changes through a pull request, then delete the merged branch.
- Never use automation to star or watch repositories, or to follow users.
- Keep generated catalog and lock files reproducible. Never hand-edit generated files.
- Run `npm run check` before publishing a change.

## Protocol invariants

- A role bundle is data, not executable plugin code.
- A role may request capabilities; it can never grant itself permissions.
- Effective access is the intersection of role requests, adapter support, host policy,
  room policy, and the user's explicit grant.
- Core fields must remain vendor-neutral. Put harness-specific behavior in an adapter or
  an explicit adapter override.
- An adapter must never silently drop a required capability. Export must fail or emit a
  machine-readable incompatibility report.
- Runtime installation must pin an immutable digest. Active roles never float on a tag.
- Secrets are references only. Credentials never belong in a role, lock file, fixture,
  screenshot, or catalog entry.
- v1alpha1 role bundles must not contain scripts, binaries, symlinks, device files, or
  package-manager lifecycle hooks.

## Role authoring

- Keep the main prompt narrow, testable, and explicit about non-goals.
- Skills use the portable `SKILL.md` directory shape and remain instruction-only in
  v1alpha1.
- Add positive and adversarial eval cases for behavior or permission changes.
- Treat new required tools, broader network access, weaker approvals, and new secret
  references as security-sensitive changes.
- Behavior changes require at least a minor version bump. Permission expansion requires
  a major version bump.

## Adapter work

- Cite the target harness's official documentation in the adapter notes.
- Map from RoleHub capabilities to the target; never leak target-specific names back into
  the core schema.
- Prefer project-scoped output over user-global installation.
- Preserve the source role id, version, manifest digest, generated-at version, warnings,
  and unsupported fields in the export report.
- Test strict failure and best-effort output separately.
