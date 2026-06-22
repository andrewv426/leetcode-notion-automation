// D1 (SQLite) state helpers: the `problems` table is the idempotency ledger,
// `meta` holds run health + a coarse lease to prevent overlapping invocations.

import type { D1Database } from "@cloudflare/workers-types";
import type { ProblemState, ProblemStatus } from "./diff";

export interface ProblemRow {
    slug: string;
    title: string;
    difficulty: string | null;
    status: ProblemStatus;
    first_attempted_at: number | null;
    solved_at: number | null;
    notion_page_id: string | null;
}

export async function loadProblems(
    db: D1Database
): Promise<Map<string, ProblemState>> {
    const { results } = await db
        .prepare(
            "SELECT slug, title, status, first_attempted_at, solved_at FROM problems"
        )
        .all<{
            slug: string;
            title: string;
            status: ProblemStatus;
            first_attempted_at: number | null;
            solved_at: number | null;
        }>();
    const map = new Map<string, ProblemState>();
    for (const r of results ?? []) {
        map.set(r.slug, {
            slug: r.slug,
            title: r.title,
            status: r.status,
            firstAttemptedAt: r.first_attempted_at,
            solvedAt: r.solved_at
        });
    }
    return map;
}

export async function getProblemPageId(
    db: D1Database,
    slug: string
): Promise<string | null> {
    const row = await db
        .prepare("SELECT notion_page_id FROM problems WHERE slug = ?")
        .bind(slug)
        .first<{ notion_page_id: string | null }>();
    return row?.notion_page_id ?? null;
}

export async function getProblemDifficulty(
    db: D1Database,
    slug: string
): Promise<string | null> {
    const row = await db
        .prepare("SELECT difficulty FROM problems WHERE slug = ?")
        .bind(slug)
        .first<{ difficulty: string | null }>();
    return row?.difficulty ?? null;
}

/**
 * Insert or merge a problem row. first_attempted_at never moves backward; difficulty,
 * solved_at and notion_page_id are only overwritten when a non-null value is supplied.
 */
export async function upsertProblem(
    db: D1Database,
    row: ProblemRow
): Promise<void> {
    await db
        .prepare(
            `INSERT INTO problems
                (slug, title, difficulty, status, first_attempted_at, solved_at, notion_page_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(slug) DO UPDATE SET
                title = excluded.title,
                difficulty = COALESCE(excluded.difficulty, problems.difficulty),
                status = CASE WHEN problems.status = 'solved' THEN 'solved' ELSE excluded.status END,
                first_attempted_at = COALESCE(problems.first_attempted_at, excluded.first_attempted_at),
                solved_at = COALESCE(excluded.solved_at, problems.solved_at),
                notion_page_id = COALESCE(excluded.notion_page_id, problems.notion_page_id)`
        )
        .bind(
            row.slug,
            row.title,
            row.difficulty,
            row.status,
            row.first_attempted_at,
            row.solved_at,
            row.notion_page_id
        )
        .run();
}

export async function getMeta(
    db: D1Database,
    key: string
): Promise<string | null> {
    const row = await db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .bind(key)
        .first<{ value: string }>();
    return row?.value ?? null;
}

export async function setMeta(
    db: D1Database,
    key: string,
    value: string
): Promise<void> {
    await db
        .prepare(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )
        .bind(key, value)
        .run();
}

/**
 * Coarse single-row lease so two overlapping cron invocations don't double-process.
 * Returns an ownership token on success (pass it to releaseLease), or null if a live lease is held.
 * The stored value is `<expiry>:<nonce>`; `CAST(value AS INTEGER)` still reads the expiry prefix,
 * so the conditional (atomic) UPDATE only wins when the prior lease has expired.
 */
export async function acquireLease(
    db: D1Database,
    nowSec: number,
    ttlSec: number
): Promise<string | null> {
    await db
        .prepare(
            "INSERT INTO meta (key, value) VALUES ('lock_until', '0') ON CONFLICT(key) DO NOTHING"
        )
        .run();
    const token = `${nowSec + ttlSec}:${crypto.randomUUID()}`;
    const res = await db
        .prepare(
            "UPDATE meta SET value = ?1 WHERE key = 'lock_until' AND CAST(value AS INTEGER) < ?2"
        )
        .bind(token, nowSec)
        .run();
    return Number(res.meta?.changes ?? 0) === 1 ? token : null;
}

/** Release only if we still own the lease, so a slow prior run can't clear a newer run's lease. */
export async function releaseLease(
    db: D1Database,
    token: string
): Promise<void> {
    await db
        .prepare(
            "UPDATE meta SET value = '0' WHERE key = 'lock_until' AND value = ?1"
        )
        .bind(token)
        .run();
}
