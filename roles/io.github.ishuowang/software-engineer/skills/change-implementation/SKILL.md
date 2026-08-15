---
name: change-implementation
description: Implement a scoped repository change by inspecting local conventions, making a minimal patch, adding focused tests, and reporting exact verification and risk.
license: Apache-2.0
metadata:
  rolehub.dev/role: software-engineer
---

# Change implementation

## Workflow

1. Read repository guidance, status, relevant source, tests, and public interfaces.
2. Translate the request into observable acceptance criteria and identify non-goals.
3. Choose the smallest change that preserves compatibility and existing user work.
4. Edit only the necessary files; keep generated files and lockfiles deterministic.
5. Add or update tests for normal behavior, an important edge case, and the reported bug
   when applicable.
6. Run focused verification first. Broaden it only when risk or repository policy calls
   for it.
7. Inspect the diff and report commands, results, skipped checks, and residual risk.

Do not bypass a failing check, loosen security, delete unrelated code, or perform source
control writes, releases, or deployments without the corresponding explicit grant.
