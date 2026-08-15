# Compatibility package contract

A compatibility package is an independently versioned compiler or runtime bridge from a
verified universal RoleHub role to one AI harness. It is trusted executable host code—not
an installer, permission broker, role field, or package manager.

## Required behavior

Every compatibility package must:

1. declare its id, package name, package version, supported harness range, implementation,
   transport, documentation, and capability matrix;
2. inspect a verified role and produce a plan without writing;
3. classify every material source field as `exact`, `advisory`, `degraded`, or
   `unsupported`;
4. fail strict mode when required behavior or an enforcement boundary cannot be preserved;
5. use only grants from a matching, digest-bound effective-policy receipt;
6. distinguish configuration isolation from process, filesystem, and network enforcement;
7. write only beneath an empty caller-selected output root;
8. preserve role ids and digests plus compatibility package identity in the report and
   lock;
9. never download or execute a capability provider while exporting;
10. never modify user-global harness configuration implicitly; and
11. produce deterministic output for the same role, package version, policy, bindings,
    and options.

The package may not add platform metadata to a role manifest or role catalog. Compatibility
discovery has its own registry, and loading a third-party entry requires an explicit
installed package specifier.

## Planning result

Conceptually, a package returns:

```ts
interface CompatibilityPlan {
  compatibilityId: string
  compatibilityVersion: string
  targetVersion?: string
  mappings: Array<{
    source: string
    target?: string
    fidelity: 'exact' | 'advisory' | 'degraded' | 'unsupported'
    message?: string
  }>
  requiredGrants: string[]
  effectiveCapabilities: string[]
  policyDigest?: string
  generatedFiles: string[]
  runnable: boolean
  warnings: string[]
}
```

The SDK type may add fields while the protocol is pre-stable, but these semantics remain
the contract. `.rolehub/compatibility-report.json` records the full plan;
`.rolehub/compatibility-lock.json` binds the output to the role and compatibility package.

## Prompt and skill assembly

When a target cannot attach scoped skills natively, prompt text is assembled in this
order:

1. source identity and purpose;
2. source prompt body;
3. selected instruction-only skill bodies;
4. generated capability and approval-boundary notes; and
5. provenance data when the target lacks a separate metadata channel.

Compiling a skill into a prompt is reported as a degraded mapping when native skill
isolation would be materially stronger. Compatibility output must not expose the role to
global skill discovery.

## Capability and policy mapping

Abstract capabilities map to the narrowest native mechanism available:

- native tool allow/deny and native sandbox policy when enforceable;
- a dedicated process/session or container when in-process scoping is insufficient;
- advisory prompt text only for non-security behavior; and
- strict failure when a security boundary would otherwise be advisory.

Host-owned `bindings` may translate abstract capabilities to native tool names. Bindings
never come from a role. Generated prompts never substitute for filesystem, network,
secret, approval, room, or external-side-effect enforcement.

The platform-neutral policy field `enforcement.configuration` records whether ambient
user/project harness configuration can be merged (`shared`) or the host supplies a sterile
configuration boundary (`isolated`). It is an independent claim: an isolated config
directory is not necessarily an OS sandbox, and a dedicated process can still inherit
ambient configuration.

## Runtime bridges

Runtime packages must additionally pin the role digest, rehydrate scoped state before a
resumed role can receive messages, revoke grants on leave, and fail closed when the locked
bundle or a required provider is unavailable.

DSHarness uses native Cordis Agent-scope setup and teardown. Because DeepSeek Harness is
currently a developer preview, this package must pin a tested target range and treat an
upstream API change as a compatibility-version event.

## CLI surface

```bash
rolehub compat list
rolehub compat inspect <id-or-installed-package>
rolehub compat catalog --out compatibility/index.json
rolehub compat export <role> --using <id-or-installed-package> \
  --policy <receipt.yaml> --bindings <bindings.json> --out <empty-directory>
```
