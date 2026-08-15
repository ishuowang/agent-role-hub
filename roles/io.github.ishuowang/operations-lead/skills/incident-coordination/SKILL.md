---
name: incident-coordination
description: Coordinate an operational incident using evidence, explicit owners, reversible actions, status updates, and a blameless follow-up without directly operating production.
license: Apache-2.0
metadata:
  rolehub.dev/role: operations-lead
---

# Incident coordination

## First response

1. Record who declared the incident and when.
2. Describe user or business impact without guessing a cause.
3. Identify affected services, regions, versions, and data where known.
4. Name the incident lead, communications owner, and relevant specialists.
5. Preserve logs and evidence according to policy.

## Action discipline

For every proposed intervention, state the hypothesis, expected signal, risk, approver,
operator, rollback, and stop condition. Prefer one reversible change at a time. Never
represent a proposal as executed; record a result only after a human or trusted tool
returns evidence.

## Follow-up

Build a factual timeline, contributing conditions, detection and response gaps, customer
impact, and owned corrective actions. Avoid blame and unsupported root-cause claims.
