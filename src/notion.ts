// Notion writes via @notionhq/client. Pinned to API version 2022-06-28 so the classic
// `databases.query` + `{ database_id }` parent shapes are used (the newer 2025-09-03 default
// replaces these with data-source-scoped calls).

import { Client } from "@notionhq/client";
import type { ProblemUpsert } from "./diff";

// Derive the SDK's exact property-bag types from the client methods (avoids `as never`,
// which would silence all property-shape checks at the call site).
type CreateProps = Parameters<Client["pages"]["create"]>[0]["properties"];
type UpdateProps = Parameters<Client["pages"]["update"]>[0]["properties"];

export function makeNotion(token: string): Client {
    return new Client({ auth: token, notionVersion: "2022-06-28" });
}

const DIFFICULTIES = new Set(["Easy", "Medium", "Hard"]);

function normDifficulty(d: string | null): string {
    return d && DIFFICULTIES.has(d) ? d : "Unknown";
}

function isoFromSec(sec: number | null): string | null {
    return sec === null ? null : new Date(sec * 1000).toISOString();
}

function problemUrl(p: ProblemUpsert): string {
    if (p.status === "solved" && p.acSubmissionId) {
        return `https://leetcode.com/submissions/detail/${p.acSubmissionId}/`;
    }
    return `https://leetcode.com/problems/${p.slug}/`;
}

// `properties` is typed loosely: the SDK's exact property union is verbose and adds no safety here.
function problemProperties(
    p: ProblemUpsert,
    difficulty: string | null
): Record<string, unknown> {
    const props: Record<string, unknown> = {
        Problem: { title: [{ text: { content: p.title || p.slug } }] },
        Slug: { rich_text: [{ text: { content: p.slug } }] },
        Status: { select: { name: p.status === "solved" ? "Solved" : "Attempted" } },
        Difficulty: { select: { name: normDifficulty(difficulty) } },
        URL: { url: problemUrl(p) }
    };
    if (p.lang) {
        props.Language = { rich_text: [{ text: { content: p.lang } }] };
    }
    const firstAt = isoFromSec(p.firstAttemptedAt);
    if (firstAt) props["First Attempted"] = { date: { start: firstAt } };
    const solvedAt = isoFromSec(p.solvedAt);
    if (solvedAt) props["Solved At"] = { date: { start: solvedAt } };
    return props;
}

/** Create or update the Notion row for a problem. Returns the page id (cache it in D1). */
export async function upsertProblemRow(
    notion: Client,
    databaseId: string,
    p: ProblemUpsert,
    difficulty: string | null,
    cachedPageId: string | null
): Promise<string> {
    const properties = problemProperties(p, difficulty);

    let pageId = cachedPageId;
    if (!pageId) {
        const q = await notion.databases.query({
            database_id: databaseId,
            filter: { property: "Slug", rich_text: { equals: p.slug } },
            page_size: 1
        });
        if (q.results.length > 0) pageId = q.results[0].id;
    }

    if (pageId) {
        await notion.pages.update({
            page_id: pageId,
            properties: properties as unknown as UpdateProps
        });
        return pageId;
    }
    const created = await notion.pages.create({
        parent: { database_id: databaseId },
        properties: properties as unknown as CreateProps
    });
    return created.id;
}

export interface StatsInput {
    ranking: number | null;
    total: number;
    easy: number;
    medium: number;
    hard: number;
    updatedSec: number;
}

/** Upsert the single profile-stats row. Returns its page id (cache it in meta). */
export async function upsertStatsRow(
    notion: Client,
    databaseId: string,
    s: StatsInput,
    cachedPageId: string | null
): Promise<string> {
    const properties: Record<string, unknown> = {
        Name: { title: [{ text: { content: "LeetCode Stats" } }] },
        "Solved Total": { number: s.total },
        "Solved Easy": { number: s.easy },
        "Solved Medium": { number: s.medium },
        "Solved Hard": { number: s.hard },
        Updated: { date: { start: new Date(s.updatedSec * 1000).toISOString() } }
    };
    if (s.ranking !== null) properties.Ranking = { number: s.ranking };

    let pageId = cachedPageId;
    if (!pageId) {
        // Self-identify the stats row so we never clobber an unrelated row in a shared DB.
        const q = await notion.databases.query({
            database_id: databaseId,
            filter: { property: "Name", title: { equals: "LeetCode Stats" } },
            page_size: 1
        });
        if (q.results.length > 0) pageId = q.results[0].id;
    }

    if (pageId) {
        await notion.pages.update({
            page_id: pageId,
            properties: properties as unknown as UpdateProps
        });
        return pageId;
    }
    const created = await notion.pages.create({
        parent: { database_id: databaseId },
        properties: properties as unknown as CreateProps
    });
    return created.id;
}
