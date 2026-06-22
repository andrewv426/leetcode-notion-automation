# leetcode-notion-sync

A tiny **Cloudflare Worker** that, every ~3 minutes, checks your **public** LeetCode activity and
mirrors it into **Notion**: one row per problem you **solve** or **attempt**, plus a rolling
**profile-stats** summary. No LLM, no LeetCode login/cookie, runs on free tiers.

How it works: a cron-triggered Worker polls LeetCode's public GraphQL (by username), diffs against
**D1** (SQLite) state so it only writes new events, and upserts to Notion. The first run **seeds**
your current state silently (no flood); after that, only changes are written.

```
cron → Worker → LeetCode public GraphQL → diff vs D1 → upsert Notion (Problems + Stats)
```

## Prerequisites

- Node.js 20+, a Cloudflare account (free), a Notion account (free).
- Your LeetCode **username** (this uses public data — no password/cookie).

## 1. Create the two Notion databases

Create them as **inline or full-page databases**, with these **exact** property names/types:

**Problems** database
| Property | Type |
|---|---|
| `Problem` | Title |
| `Slug` | Text (rich_text) |
| `Status` | Select (options: `Attempted`, `Solved`) |
| `Difficulty` | Select (options: `Easy`, `Medium`, `Hard`, `Unknown`) |
| `Language` | Text |
| `First Attempted` | Date |
| `Solved At` | Date |
| `URL` | URL |

**Stats** database (holds a single row)
| Property | Type |
|---|---|
| `Name` | Title |
| `Solved Total` / `Solved Easy` / `Solved Medium` / `Solved Hard` | Number |
| `Ranking` | Number |
| `Updated` | Date |

> Tip: pre-add the Select options above so a value can't fragment into duplicates.

## 2. Notion integration token

1. https://www.notion.so/my-integrations → **New integration** (internal) → copy the token (`ntn_…`).
2. Open **each** database → `•••` → **Connections** → add your integration. (Without this every call 404s.)
3. Grab each database id from its URL (the 32-char hex before `?v=`).

## 3. Configure & deploy

```bash
npm install
wrangler login
wrangler d1 create leetcode-notion-sync     # paste the printed database_id into wrangler.toml
```

Edit `wrangler.toml` `[vars]`: set `LC_USERNAME`, `NOTION_PROBLEMS_DB`, `NOTION_STATS_DB`, and the
D1 `database_id`. Then:

```bash
npm run db:init -- --remote                 # create tables in the deployed D1
wrangler secret put NOTION_TOKEN            # paste your ntn_… token (the only secret)
npm run deploy                              # deploys + registers the cron
```

The first scheduled run seeds your baseline (no Notion rows). Subsequent runs write new
solves/attempts. Check `https://<your-worker>.workers.dev/health` for `last_ok` / `last_error` /
`last_warning`.

## Local development

```bash
cp .dev.vars.example .dev.vars              # put your real NOTION_TOKEN here (gitignored)
npm run db:init                             # local D1 (omit --remote)
npm run dev                                 # then, in another shell:
curl "http://localhost:8787/__scheduled?cron=*/3+*+*+*+*"   # trigger a tick
curl http://localhost:8787/health
npm test                                    # pure diff-logic unit tests
```

## Notes & limits

- **Free tier:** Workers (100k req/day), D1, and the Notion API are all comfortably free for one user.
- **No backfill:** seeding intentionally skips your existing history; only new activity is logged.
- **Latency:** a few minutes (cron min interval is 1 min). LeetCode endpoints are unofficial and can change.
- **If Cloudflare egress is blocked** by LeetCode's WAF: the same logic can run on **GitHub Actions
  cron** (Node runners) instead — `src/leetcode.ts` is plain `fetch` and portable. See `CLAUDE.md`.

## Layout

`src/{index,leetcode,diff,notion,state}.ts` · `schema.sql` · `test/diff.test.ts` ·
`CLAUDE.md` (agent guide) · `docs/PLAN_REVIEW.md`. MIT-style hobby project.
