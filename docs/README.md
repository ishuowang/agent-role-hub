# RoleHub documentation

RoleHub keeps universal role data and executable harness compatibility packages in
separate schemas, packages, catalogs, and release lifecycles.

- [Architecture](architecture.md)
- [Compatibility package contract](compatibility-contract.md)
- [Effective policy receipts](effective-policy.md)
- [Registry and distribution](registry.md)
- [Roadmap](roadmap.md)
- Native compatibility implementations:
  - [Claude Code](compatibility/claude-code.md)
  - [Codex](compatibility/codex.md)
  - [OpenCode](compatibility/opencode.md)
  - [Pi](compatibility/pi.md)
  - [DeepSeek Harness / DSHarness](compatibility/dsharness.md)

The role schema in `packages/core/schema/` and compatibility/policy schemas in
`packages/compat-sdk/schema/` are normative. Documentation explains intent but cannot
override a schema, lock format, validator, or compatibility report.
