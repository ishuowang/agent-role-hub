# Adapter contract

An adapter is a compiler from a verified RoleHub role to one versioned harness target.
It is not an installer, permission broker, or package manager.

## Required behavior

Every adapter must:

1. declare its id, adapter version, supported harness range, and capability matrix;
2. inspect a role and produce an export plan without writing;
3. classify every material source field as exact, advisory, degraded, or unsupported;
4. fail strict mode when a required capability or approval boundary cannot be enforced;
5. write only beneath the caller-selected output root;
6. preserve source id, version, manifest digest, and adapter version in `export-report.json`;
7. avoid user-global installation unless the user explicitly selects that scope;
8. never download or execute a tool provider while exporting; and
9. produce deterministic output for the same role, adapter version, and options.

Runnable output additionally requires a matching effective-policy receipt. The adapter
must use only capabilities present in that receipt, record its digest and enforcement
claims, and refuse to generate launch material when any required grant or enforcement
boundary is missing. Best-effort may render a report in that state, but not a launcher.

## Planning result

Conceptually, an adapter returns:

```ts
interface ExportPlan {
  target: string
  targetVersion?: string
  mappings: Array<{
    source: string
    target?: string
    fidelity: 'exact' | 'advisory' | 'degraded' | 'unsupported'
    message?: string
  }>
  requiredGrants: string[]
  generatedFiles: string[]
  runnable: boolean
}
```

The implementation type is versioned with the CLI and may add fields, but these
semantics are stable.

## Prompt assembly

Prompt text is assembled in this order:

1. source identity and purpose;
2. source prompt body;
3. selected instruction-only skill bodies when the target cannot attach skills natively;
4. generated capability and approval boundary notes; and
5. provenance footer for targets that lack a separate metadata channel.

An adapter may compile skills into a prompt only when it records that mapping as
`degraded`. It must not claim native skill isolation in that case.

## Permission mapping

Adapters map abstract capabilities to the narrowest target mechanism available:

- native tool allow/deny or sandbox policy when enforceable;
- a dedicated process/session boundary when tool-level scoping is unavailable;
- advisory prompt text only for non-security behavior; and
- strict failure when a security boundary would be advisory.

Generated prompts never substitute for filesystem, network, secret, approval, or
external-side-effect enforcement.

## Runtime adapters

Some targets need a runtime integration rather than static files. Runtime adapters must
additionally pin the role digest, rehydrate scoped content on resume, revoke grants on
leave, and fail closed when a locked bundle or capability provider is unavailable.
