# Security policy

Role prompts and skills are executable _instructions_ even when they contain no native
code. Treat every community bundle as untrusted input.

## Supported versions

Security fixes target the latest pre-1.0 release. The v1alpha1 format may change, but a
published artifact and its digest remain immutable.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a public
issue for credential exposure, archive traversal, signature bypass, permission
escalation, cross-role data leakage, or a malicious catalog entry.

Include the affected role or package digest, RoleHub version, compatibility package and harness
version, reproduction steps, observed impact, and any suggested containment. Never
include live secrets.

## Security model

RoleHub assumes:

- role archives, manifests, prompts, skills, and catalog rows are attacker-controlled
  until verified; compatibility packages are executable host code and require a separate
  trust decision;
- signatures prove provenance and integrity, not safety;
- a requested capability is not an authorization;
- host policy and explicit user grants are authoritative;
- secrets are injected by logical reference at runtime and are never serialized into a
  role bundle;
- extraction rejects absolute paths, traversal, symlinks, devices, excessive file
  counts, oversized files, and oversized total payloads;
- installed compatibility packages never change a role manifest or role-catalog row;
- unsupported required capabilities fail closed in strict mode; and
- leaving a room revokes future access but cannot erase content already written to a
  model transcript.

v1alpha1 deliberately rejects executable role content. Tool providers, MCP servers,
extensions, plugins, and package installations require a separate trusted installation
and consent path.
