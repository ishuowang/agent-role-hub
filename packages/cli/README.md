# `@ishuowang/rolehub`

CLI for validating and packing universal roles, generating the neutral catalog, and
explicitly selecting a trusted compatibility package at export time.

## Install

After the v0.2.0 npm release:

```bash
npm install --save-dev @ishuowang/rolehub@0.2.0
```

## Minimal CLI

```bash
npx rolehub validate ./roles
npx rolehub pack ./roles/io.github.ishuowang/research-librarian
npx rolehub compat list
npx rolehub compat export ./roles/io.github.ishuowang/research-librarian \
  --using codex --policy ./policy.yaml --out ./exports/codex
```

`compat export` writes only into an empty output directory. Use `--bindings` when the
selected compatibility package needs a trusted capability-to-native-tool map.

## Trust and isolation boundary

Validation proves bundle shape and digest consistency; it does not authorize or run a
role. Compatibility packages are executable modules. Built-ins are pinned with the CLI,
and any third-party package is loaded only when explicitly named with `--using`; the CLI
does not auto-install it. Export produces plans, receipts, and launch artifacts—the host
still owns credentials, capability grants, approvals, process creation, and hard
filesystem/network/configuration isolation.

## v0.2.0 documentation

- [Documentation index](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/README.md)
- [Registry model](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/registry.md)
- [Compatibility package contract](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility-contract.md)
