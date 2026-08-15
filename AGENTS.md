# RoleHub agent guide

RoleHub has two independent extension surfaces: universal role data and executable
harness compatibility packages. Never add a platform field to a role or role catalog.

## Repository rules

- Start work from a `feature/<short-name>` branch.
- Submit changes through a pull request, then delete the merged branch.
- Never use automation to star or watch repositories, or to follow users.
- Keep generated role and compatibility catalogs, locks, and archives reproducible.
  Never hand-edit generated files.
- Run `npm run check` before publishing a change.

## Universal role invariants

- A role bundle is platform-neutral data, not executable plugin code.
- A role may request capabilities; it can never grant itself permissions.
- Roles must not name a harness, compatibility package, native tool, launcher, or target
  version. Platform behavior belongs only in a compatibility package.
- Runtime installation pins an immutable role digest. Active roles never float on a tag.
- Secrets are references only. Credentials never belong in a role, lock, fixture,
  screenshot, or catalog entry.
- v1alpha1 role bundles must not contain scripts, binaries, symlinks, device files, or
  package-manager lifecycle hooks.

## Effective access invariant

Effective access is the intersection of the role request, selected compatibility support,
host policy, room policy, and explicit user grant. A compatibility package must never
silently drop a required capability or turn a request into permission. It must fail or
emit a machine-readable, report-only incompatibility result.

## Role authoring

- Keep the main prompt narrow, testable, and explicit about non-goals.
- Skills use the portable `SKILL.md` directory shape and remain instruction-only in
  v1alpha1.
- Add positive and adversarial eval cases for behavior or permission changes.
- Treat new required tools, broader network access, weaker approvals, and new secret
  references as security-sensitive changes.
- Behavior changes require at least a minor version bump. Permission expansion requires
  a major version bump.

## Compatibility package work

- Release compatibility packages independently from roles and the core protocol.
- Cite the target harness's official documentation in its compatibility notes.
- Map abstract RoleHub capabilities to native mechanisms; never leak those mechanisms
  back into the role schema or role catalog.
- Prefer session-scoped or isolated output over user-global installation.
- Preserve the source role id, version, digests, compatibility package version, mappings,
  warnings, and unsupported fields in the export report.
- Test strict failure and best-effort output separately.
- Treat an explicitly loaded third-party compatibility package as trusted executable
  host code; never auto-install or auto-discover it from a role.

Useful commands:

```bash
npm exec --prefix packages/cli -- rolehub validate roles
npm exec --prefix packages/cli -- rolehub compat list
npm exec --prefix packages/cli -- rolehub compat inspect <id-or-installed-package>
npm exec --prefix packages/cli -- rolehub compat export <role> --using <id-or-installed-package> --mode best-effort
```
