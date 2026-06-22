# Plan review

A lightweight, repeatable way to pressure-test a plan **before** executing it. Use it for any
non-trivial change (new feature, multi-file change, anything touching external APIs or data).

## Method

1. Draft the plan.
2. Spawn **N independent reviewers**, each with a **distinct lens** (don't give one reviewer all
   lenses — separation is what surfaces blind spots):
   - **Feasibility / correctness** — do the named APIs, fields, signatures, and runtime assumptions
     actually exist and behave as claimed? Verify against real docs/live endpoints where cheap.
   - **Simplicity / scope** — what's over-built or duplicated; what can be deleted or reused —
     *without* hurting correctness (reviewer must flag cuts that would).
   - **Ops / failure-modes** — cold start, races, partial state, retries, rate limits, expiry.
   - **Security / secrets** — secret handling, token scope, redaction, injection, blast radius.
3. Keep only **concrete, actionable** findings (a vague "consider X" doesn't count). Optionally have
   a second pass adversarially verify a finding before acting on it.
4. **Fold confirmed findings back into the plan**, and note what changed so the diff is auditable.

## Rules of thumb

- A reviewer that finds nothing should say so explicitly (don't manufacture findings).
- Blockers/majors must be resolved or consciously accepted (with a why) before building.
- Prefer deleting scope over adding it; prefer reusing existing code over new code.

## Example (this project)

The initial plan was reviewed across feasibility / simplicity / ops+security. Confirmed findings
changed the design materially: switched LeetCode reads from the authenticated `submissionList` to
the **public** `recentSubmissionList` + `recentAcSubmissionList` (and so dropped the session cookie
from v1), added a **cold-start seed** to prevent a first-run Notion flood, dropped a redundant
`seen_submissions` table, pinned the Notion API version, and flagged Worker-egress blocking with a
GitHub Actions fallback.
