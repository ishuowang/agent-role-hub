# Pi coding agent adapter

> **Safe CLI default:** current RoleHub emits Pi launch material only with a matching
> effective-policy receipt, a dedicated process, and OS-sandbox enforcement for any file
> or shell tool. Required unsupported behavior produces report-only output. Native skills
> are enabled only when the receipt grants read access inside that sandbox; otherwise
> optional skill instructions may be compiled into the prompt without adding `read`.

Pi is supported as a RoleHub execution harness, not as the RoleHub package format. Pi
does not currently have a native named-role or subagent configuration, so the adapter
creates one isolated Pi session/process for each Room member.

## Compatibility baseline

This document was checked against Pi `v0.84.2` (released 2026-08-14). The former
`badlogic/pi-mono` repository redirects to the current official
[`earendil-works/pi`](https://github.com/earendil-works/pi) repository, and current SDK
imports use `@earendil-works/pi-coding-agent`.

Every export must record the Pi version and adapter version. An unknown newer Pi version
is unsupported in strict mode until its CLI, resource loader, tool API, and security
behavior pass compatibility tests.

## Adapter model

Pi deliberately has no built-in subagents, MCP client, permission popups, or sandbox.
It does provide the primitives needed by a trusted outer runtime:

- headless JSONL RPC mode;
- a TypeScript SDK with `AgentSession` and configurable resource loading;
- an appendable system prompt;
- portable `SKILL.md` discovery and explicit `--skill` paths;
- Markdown prompt templates and explicit `--prompt-template` paths;
- a strict tool-name allowlist; and
- extensions that can register tools and intercept calls.

RoleHub therefore owns identity, invitations, routing, approval, process lifetime, and
isolation. A Pi process is the execution engine for one role; it is not the registry or
the room.

## Support matrix

| RoleHub concept                 | Pi target                                        | Support              | Notes                                                                               |
| ------------------------------- | ------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------- |
| Role id and description         | Process/session name plus export metadata        | Adapter              | Pi has no native role file.                                                         |
| Role prompt                     | `--append-system-prompt` or SDK composition      | Native primitive     | Append by default so Pi's own tool guidance remains intact.                         |
| Named primary agent             | One Pi RPC/SDK session                           | Adapter              | The broker owns the member id.                                                      |
| Subagent / room member          | Separate Pi RPC/SDK session                      | Adapter              | Pi explicitly documents that subagents are not built in.                            |
| Skills                          | Explicit `--skill` paths or SDK `skillsOverride` | Native               | Pi implements the Agent Skills standard with lenient validation.                    |
| Skill visibility                | Process-local resource set                       | Adapter              | Start each member with only its approved skills.                                    |
| Prompt commands                 | Explicit `--prompt-template` paths               | Native               | Portable placeholders are supported; target-only syntax remains optional.           |
| Built-in tool requests          | `--tools` strict allowlist                       | Native               | Allowlist is by tool name, not arguments or paths.                                  |
| Approval (`ask`)                | Trusted guard extension / broker                 | Adapter only         | Pi core has no permission popup. Without a guard, required approval semantics fail. |
| Path or command constraints     | Guard extension and OS sandbox                   | Adapter only         | A name allowlist alone cannot enforce them.                                         |
| Exact provider/model            | `--provider`, `--model`, `--thinking`            | Partial              | Generic model requirements need host resolution.                                    |
| Temperature / top-p / max turns | No equivalent role setting                       | Unsupported          | Do not silently discard a required limit.                                           |
| Child-agent delegation          | Broker starts/routes another member              | Adapter              | There is no native Pi `task`/subagent capability.                                   |
| Local or remote MCP             | Host-installed extension                         | Host binding only    | Pi explicitly has no built-in MCP client.                                           |
| Custom tool implementation      | Pi extension or SDK `customTools`                | Rejected by v1alpha1 | It is executable target-specific code.                                              |
| Lifecycle hooks / UI            | Pi extension                                     | Rejected by v1alpha1 | Extensions execute with the Pi process's full permissions.                          |
| Secrets                         | Broker-injected credential reference             | Reference only       | Values never enter a role export or lock file.                                      |

### Portable skills

Pi reads skills from `SKILL.md` directories and supports the shared fields `name`,
`description`, `license`, `compatibility`, and metadata. Pi also documents experimental
`allowed-tools` and `disable-model-invocation` fields. RoleHub does not use either field
as a permission grant or portable behavioral requirement.

Pi is intentionally lenient when a skill name differs from its directory. The RoleHub
exporter is stricter for cross-harness compatibility: the directory and `name` must
match, the name uses only lowercase alphanumerics and single hyphens, and the description
is 1-1024 characters.

Pi advertises skill metadata and expects the model to use the `read` tool to load the
full `SKILL.md`. Consequently, a role with a required skill also needs the Pi `read`
tool. Strict export fails if effective policy denies `read`; it must not inline the skill
silently because that changes progressive-disclosure semantics and context cost.

### Portable prompt templates

Pi prompt templates are Markdown files whose filename becomes `/name`. Frontmatter may
contain `description` and `argument-hint`. Pi supports `$1`, `$2`, `$@`, `$ARGUMENTS`,
defaults, and argument slices.

The cross-harness subset is plain Markdown plus `$ARGUMENTS` and positional `$1`, `$2`,
... placeholders. Default values, slices, and `argument-hint` may be emitted only as an
optional Pi override. OpenCode shell-output interpolation and automatic file references
have no safe Pi equivalent and are rejected when required.

## Capability mapping

Suggested native bindings are intentionally small:

| Abstract capability | Pi tool | Important behavior                            |
| ------------------- | ------- | --------------------------------------------- |
| `workspace.read`    | `read`  | Also required for on-demand skill loading.    |
| `workspace.search`  | `grep`  | `grep` is available when explicitly selected. |
| `workspace.find`    | `find`  | File matching; separate from `read`.          |
| `workspace.list`    | `ls`    | Directory listing; separate from `read`.      |
| `workspace.edit`    | `edit`  | Exact-text editing.                           |
| `workspace.write`   | `write` | Creates or overwrites files.                  |
| `process.exec`      | `bash`  | Runs with the Pi process user's permissions.  |

Pi has no native equivalents for `network.fetch`, `network.search`, `user.question`,
`agent.delegate`, or MCP capabilities. They may resolve only to a separately installed,
host-approved tool supplied by the trusted adapter extension. The role records an
abstract request; it never selects an extension package or command to install.

The effective tool list is computed before process start. `--tools` is a strict
allowlist across built-in, extension, and SDK custom tools. `--exclude-tools` may narrow
it further but must not be used to approximate argument-level policy.

## Generated output

For `io.github.ishuowang/finance-controller@1.2.0`, the pure export is materialized as:

```text
exports/pi/<manifest-sha256>/
├── prompt.md
├── skills/
│   ├── finance-controller-budget-review/
│   │   ├── SKILL.md
│   │   └── references/
│   └── finance-controller-financial-report/
│       └── SKILL.md
├── prompts/
│   └── finance-controller-close-month.md
├── rolehub-pi.json
└── rolehub-export.json
```

`rolehub-pi.json` contains only resolved, non-secret runtime inputs: member name, prompt
path, explicit skill/template paths, effective tool names, context policy, model
requirements, required host binding ids, and the source/export digests. It is adapter
metadata, not a file consumed directly by Pi.

The runtime additionally creates a per-member directory outside the immutable export:

```text
runtime/<room-id>/<member-id>/
├── agent/       # PI_CODING_AGENT_DIR; no inherited user resources
├── sessions/    # omitted for ephemeral sessions
└── state.json   # broker state; no credentials
```

Do not turn a v1alpha1 role into a Pi package and do not call `pi install`. Pi packages
may install dependencies, and their extensions run arbitrary code with full user
permissions. Explicit verified paths are both lighter and safer.

## Starting a role

The production adapter should use `AgentSession` directly when it is implemented in
TypeScript. A custom resource loader can supply exactly the prompt, skills, prompt
templates, and trusted extensions selected for this member.

A subprocess implementation uses RPC mode and direct argv spawning. Its effective
invocation is equivalent to:

```text
PI_CODING_AGENT_DIR=/run/rolehub/<room>/<member>/agent
pi --mode rpc --no-session --no-approve
   --no-extensions
   --no-skills --skill /verified/export/skills/<skill>
   --no-prompt-templates --prompt-template /verified/export/prompts/<prompt>.md
   --no-context-files
   --tools read,grep,find,ls
   --append-system-prompt <contents of verified prompt.md as one argv value>
```

The runner must spawn an argv array directly; it must not concatenate a shell command or
evaluate role content. Repeat `--skill` and `--prompt-template` for each approved path.
If a trusted RoleHub guard supplies approved custom tools, keep discovery disabled and
load only that host file explicitly with `--no-extensions -e /trusted/pi-guard.ts`, then
include the approved tool names in `--tools`.

`--no-approve` prevents project-local Pi resources from being trusted for this run.
`PI_CODING_AGENT_DIR` prevents user-global Pi skills, extensions, prompts, settings, and
system-prompt files from entering the member scope. Provider authentication is supplied
separately by the host through a minimal credential mechanism; it is never copied into
the export.

The example uses `--no-context-files` for an isolated role. When room policy explicitly
selects workspace context, omit that flag so Pi can read project `AGENTS.md` or
`CLAUDE.md`. Pi documents that these context files load independently of project trust,
so the choice must be visible in the export report.

## Room transport and lifetime

Pi RPC mode is a JSONL protocol over stdin/stdout. It accepts prompts asynchronously and
supports steering and follow-up messages while a turn is active. The Room broker can
therefore route a message to a Pi member without blocking other members, while retaining
ownership of ordering and backpressure.

Invitation and removal follow this sequence:

1. Verify and pin the role bundle by digest.
2. Intersect requested capabilities with adapter support, host policy, room policy, and
   the user's explicit grants.
3. Create the immutable export and an empty per-member runtime directory.
4. Start one Pi SDK/RPC session with the exact prompt, resources, tools, model, context
   policy, and short-lived secret handles.
5. Persist source/export digests, Pi version, session id, effective tools, and context
   policy in the membership record.
6. Route Room messages through the broker; never let one Pi process discover another
   member's files, environment, session store, or credentials.
7. On leave, stop new delivery, abort or settle the active turn according to room policy,
   terminate the process/session, revoke secret handles, and remove its runtime
   directory. Preserve audit history and the immutable verified bundle as policy allows.

An update is a new invitation/resolution operation. An active member never follows a
moving git branch, tag, npm version range, or catalog row.

## Isolation and security limits

A separate process and config directory prevent accidental RoleHub resource pollution,
but they are not a security sandbox. Pi runs built-in tools and extensions with the OS
permissions of its process. Pi's project trust is an input-loading guard only and does
not restrict what the model can ask an enabled tool to do.

For community roles, unattended work, or untrusted repositories, run each member in a
container, VM, micro-VM, or equivalent policy-controlled sandbox. Mount only approved
workspace paths, restrict network egress, and inject the minimum short-lived credentials.
An extension-based approval gate improves UX but is not a substitute for OS isolation.

Extensions are host code, never role content. Pi extensions can register or replace
tools, alter prompts, intercept events, execute commands, and add UI. They therefore
need a separate install, review, signature, and consent lifecycle outside RoleHub's
community role registry.

## Strict failure boundaries

Strict export fails with a machine-readable incompatibility when any of the following is
true:

- a required capability has no approved native or host-provided Pi tool binding;
- effective policy denies a capability marked required by the role;
- a required skill is present but `read` is not in the effective tool set;
- a role requires `ask`, path patterns, command patterns, or network restrictions but no
  trusted guard and OS enforcement are available;
- a role requires native subagent, MCP, browser, web search/fetch, or user-question
  semantics and no explicit host binding exists;
- a role asks to ship an extension, custom tool, package, dependency, executable script,
  binary, symlink, lifecycle hook, or literal secret;
- exact temperature, top-p, maximum-turn, UI, or other unsupported semantics are marked
  required;
- a required model constraint cannot be resolved to an available permitted Pi model;
- a prompt requires replacement of Pi's complete built-in system prompt rather than an
  append operation, without an explicit trusted Pi override;
- generated skill or prompt names collide or violate the portable format;
- the installed Pi version is outside the adapter's tested range; or
- any required field would be silently omitted, broadened, or weakened.

Best-effort mode may omit only optional behavior and must record every omission. It may
never add `bash`, add a custom extension, broaden a filesystem/network boundary, turn an
approval into an allow, or serialize a credential.

## Official sources

- [Pi coding agent README and CLI reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)
- [Pi skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
- [Pi prompt templates](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/prompt-templates.md)
- [Pi extensions and custom tools](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- [Pi SDK and resource loader](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Pi RPC mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- [Pi settings and project trust](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)
- [Pi environment variables](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/environment-variables.md)
- [Pi security model](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)
- [Official Pi repository](https://github.com/earendil-works/pi)
