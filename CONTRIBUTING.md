# Contributing to RoleHub

RoleHub welcomes role authors, harness maintainers, security reviewers, and people who
write evals. The shared protocol stays deliberately smaller than any one harness.

## Add a role

1. Create `roles/<publisher>/<role-name>/` from an existing example.
2. Use a publisher namespace you control, such as `io.github.<github-user>`.
3. Keep the bundle data-only: `role.yaml`, Markdown prompts, instruction-only skills,
   eval fixtures, documentation, and small presentation assets.
4. Run `npm run validate` and `npm test`.
5. Open a pull request from a `feature/<short-name>` branch.

The pull request must explain the role's job, non-goals, requested capabilities,
network/filesystem posture, human approval gates, and how its evals exercise those
boundaries.

## Add or change an adapter

An adapter translates RoleHub's capability model into one harness format. Include:

- a link to the harness's official specification or source;
- a capability matrix marking each field as exact, degraded, advisory, or unsupported;
- strict-mode behavior for every unsupported required field;
- golden export fixtures; and
- a machine-readable export report.

Do not guess undocumented target fields. A changing or experimental format must be
version-gated and described as such.

## Review gates

The following changes require security-focused review:

- required capabilities or denied-capability removal;
- network, filesystem, shell, secret, or external publishing access;
- approval-policy changes;
- executable content or external package references;
- schema, lock, digest, archive, or signature logic.

Roles that impersonate regulated professionals, promise autonomous legal/financial
authority, hide their requested permissions, or embed credentials will not be accepted.

By contributing, you agree that your contribution is licensed under Apache-2.0 unless a
role directory clearly carries a compatible role-specific license.
