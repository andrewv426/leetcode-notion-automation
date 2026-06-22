# leetcode-notion-sync

Cloudflare Worker (cron, every ~3 min) that polls LeetCode's **public** GraphQL for one username and
upserts newly **solved**/**attempted** problems + a profile-stats summary into **Notion**. No LLM.
No LeetCode cookie (public data only). State in **D1**.

## Commands

- `npm run dev` — `wrangler dev --test-scheduled`; trigger: `curl "localhost:8787/__scheduled?cron=*/3+*+*+*+*"` (or hit `/run`, `/health`)
- `npm test` — vitest, the pure `diff.ts` logic (no network)
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:init` — apply `schema.sql` to D1 (add `--remote` for the deployed DB)
- `npm run deploy` — `wrangler deploy`

## Architecture

`scheduled()` in `src/index.ts` → `run(env)`:
`leetcode.ts` (native-fetch public GraphQL) → `diff.ts` (PURE classify, unit-tested) →
`notion.ts` (upsert) → `state.ts` (D1). Idempotency = `problems` table (slug PK, forward-only
`attempted→solved`) + cached `notion_page_id`. A `meta` lease + Notion-first ordering prevent dup
rows; first run **seeds** baseline state with no Notion writes (anti-flood).

Invariants worth keeping:
- **Do NOT use `leetcode-query` in the Worker** — it pulls node-fetch and breaks under Workers V8. Raw `fetch` only.
- Only secret is `NOTION_TOKEN` (`wrangler secret put`). DB ids + username are `[vars]` in `wrangler.toml`.
- Notion client is pinned to API version `2022-06-28` (classic `database_id` calls).
- Solved iff `statusDisplay === "Accepted"`; skip non-terminal submissions.
- LeetCode `timestamp` is unix **seconds**; dates → `new Date(sec*1000).toISOString()`.

## Docs discipline

At the **end of every turn**, evaluate whether the change touched setup, commands, architecture,
secrets, or the data model. If yes, update `CLAUDE.md` (and `README.md` if user-facing) in the **same
turn** — terse, pointers over prose. If no docs change is needed, say so briefly.
