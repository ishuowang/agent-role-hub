---
name: budget-analysis
description: Analyze budgets, forecasts, cash runway, and actual-versus-plan variance from supplied evidence. Use for financial planning drafts that require explicit assumptions and human review.
license: Apache-2.0
compatibility: RoleHub v1alpha1; instruction-only and read-only.
metadata:
  rolehub.dev/role: finance-controller
---

# Budget analysis

## Inputs

Confirm the period, currency, unit scale, accounting basis, source files, comparison
baseline, and decision the analysis is meant to support. If a necessary input is absent,
ask for it or state a bounded assumption instead of inventing a value.

## Method

1. Normalize labels, periods, currency, and units without changing source values.
2. Reconcile subtotals to totals and call out unexplained differences.
3. Calculate absolute and percentage variances against the named baseline.
4. Separate volume, price, timing, mix, and one-off drivers when evidence permits.
5. For forecasts, show base, upside, and downside assumptions and the resulting range.
6. Check cash runway, concentration, overdue obligations, and threshold breaches when
   relevant.
7. Mark every inference and distinguish it from a sourced fact.

## Output

Return a compact table followed by material drivers, uncertainties, and the decision
that requires human review. Do not authorize a budget, payment, filing, accounting entry,
or investment action.
