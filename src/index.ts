// Worker entry. Cron-triggered: seed on first run, then on each tick diff LeetCode against D1
// and upsert new solved/attempted problems + a profile-stats summary into Notion.

import type {
    ExecutionContext,
    ExportedHandler,
    Request as CfRequest,
    ScheduledController
} from "@cloudflare/workers-types";
import { computeActions } from "./diff";
import {
    fetchDifficulty,
    fetchProfileStats,
    fetchRecentAcSubmissions,
    fetchRecentSubmissions,
    LeetCodeError
} from "./leetcode";
import { makeNotion, upsertProblemRow, upsertStatsRow } from "./notion";
import {
    acquireLease,
    getMeta,
    getProblemDifficulty,
    getProblemPageId,
    loadProblems,
    releaseLease,
    setMeta,
    upsertProblem
} from "./state";

export interface Env {
    DB: import("@cloudflare/workers-types").D1Database;
    NOTION_TOKEN: string;
    NOTION_PROBLEMS_DB: string;
    NOTION_STATS_DB: string;
    LC_USERNAME: string;
}

const LEASE_TTL_SEC = 600; // must exceed the 180s cron interval so a slow run keeps its lease
const WINDOW = 20;

export default {
    async scheduled(
        _controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext
    ): Promise<void> {
        ctx.waitUntil(run(env));
    },

    async fetch(req: CfRequest, env: Env): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname === "/health") {
            const [lastOk, lastError, lastWarning, seeded] = await Promise.all([
                getMeta(env.DB, "last_ok"),
                getMeta(env.DB, "last_error"),
                getMeta(env.DB, "last_warning"),
                getMeta(env.DB, "seeded")
            ]);
            return Response.json({ lastOk, lastError, lastWarning, seeded });
        }
        if (url.pathname === "/run") {
            await run(env);
            return new Response("ran\n");
        }
        return new Response("leetcode-notion-sync\n");
    }
} satisfies ExportedHandler<Env>;

export async function run(env: Env): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);

    const lease = await acquireLease(env.DB, nowSec, LEASE_TTL_SEC);
    if (!lease) {
        console.log("lease held by another run; skipping tick");
        return;
    }

    let failures = 0;
    let warning = "";
    try {
        const username = env.LC_USERNAME;
        const existing = await loadProblems(env.DB);
        const seeded = (await getMeta(env.DB, "seeded")) === "1";

        const [recent, acList] = await Promise.all([
            fetchRecentSubmissions(username, WINDOW),
            fetchRecentAcSubmissions(username, WINDOW)
        ]);
        const actions = computeActions(recent, acList, existing);

        if (seeded && actions.length >= Math.ceil(WINDOW * 0.8)) {
            // Many new events at once — older ones may have scrolled past the 20-item window.
            warning = `high new-event count (${actions.length}/${WINDOW}); some history may have been missed`;
            console.warn(warning);
        }

        const notion = makeNotion(env.NOTION_TOKEN);

        if (!seeded) {
            // Cold start: record current state as the baseline, NO Notion writes (avoids a flood).
            for (const a of actions) {
                const p = a.problem;
                await upsertProblem(env.DB, {
                    slug: p.slug,
                    title: p.title,
                    difficulty: null,
                    status: p.status,
                    first_attempted_at: p.firstAttemptedAt,
                    solved_at: p.solvedAt,
                    notion_page_id: null
                });
            }
            await setMeta(env.DB, "seeded", "1");
            console.log(`seeded ${actions.length} problems (no Notion writes)`);
        } else {
            for (const a of actions) {
                const p = a.problem;
                try {
                    // Difficulty: reuse cached value, else best-effort fetch (never fatal).
                    let difficulty = await getProblemDifficulty(env.DB, p.slug);
                    if (!difficulty) {
                        try {
                            difficulty = await fetchDifficulty(p.slug);
                        } catch {
                            difficulty = null;
                        }
                    }
                    // Notion write FIRST; only mark D1 after it succeeds, so a failure self-heals next tick.
                    const cachedPageId = await getProblemPageId(env.DB, p.slug);
                    const pageId = await upsertProblemRow(
                        notion,
                        env.NOTION_PROBLEMS_DB,
                        p,
                        difficulty,
                        cachedPageId
                    );
                    await upsertProblem(env.DB, {
                        slug: p.slug,
                        title: p.title,
                        difficulty,
                        status: p.status,
                        first_attempted_at: p.firstAttemptedAt,
                        solved_at: p.solvedAt,
                        notion_page_id: pageId
                    });
                    console.log(`${a.kind} ${p.status} ${p.slug}`);
                } catch (e) {
                    // Isolate per-problem failures: one bad slug must not sink the rest.
                    failures++;
                    console.error(`failed ${p.slug}: ${redact(String(e))}`);
                }
            }
        }

        // Profile-stats summary — idempotent, runs every tick (incl. seed).
        try {
            const stats = await fetchProfileStats(username);
            const by = stats.byDifficulty;
            const statsPageId = await getMeta(env.DB, "stats_page_id");
            const id = await upsertStatsRow(
                notion,
                env.NOTION_STATS_DB,
                {
                    ranking: stats.ranking,
                    total: by.All ?? 0,
                    easy: by.Easy ?? 0,
                    medium: by.Medium ?? 0,
                    hard: by.Hard ?? 0,
                    updatedSec: nowSec
                },
                statsPageId
            );
            if (!statsPageId) await setMeta(env.DB, "stats_page_id", id);
        } catch (e) {
            failures++;
            console.error(`stats update failed: ${redact(String(e))}`);
        }

        await setMeta(env.DB, "last_ok", new Date(nowSec * 1000).toISOString());
        await setMeta(
            env.DB,
            "last_error",
            failures > 0 ? `${failures} write(s) failed this tick (see logs)` : ""
        );
        await setMeta(env.DB, "last_warning", warning);
    } catch (e) {
        const msg = e instanceof LeetCodeError ? e.message : "sync error";
        await setMeta(env.DB, "last_error", redact(msg)).catch(() => {});
        console.error(`run failed: ${redact(String(e))}`);
    } finally {
        await releaseLease(env.DB, lease).catch(() => {});
    }
}

/** Strip anything secret-looking before persisting/logging an error string. */
function redact(s: string): string {
    return s
        .replace(
            /(LEETCODE_SESSION|csrftoken|secret_[A-Za-z0-9]+|ntn_[A-Za-z0-9]+)=?[^\s;]*/gi,
            "[redacted]"
        )
        .slice(0, 300);
}
