// Minimal public LeetCode GraphQL client using the Worker-native fetch.
// No auth/cookies in v1 — all queries here are public (keyed by username / slug).
// (Deliberately NOT using `leetcode-query`: it pulls cross-fetch/node-fetch and breaks under Workers.)

import type { AcSubmission, RecentSubmission } from "./diff";

const GRAPHQL = "https://leetcode.com/graphql";

export class LeetCodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LeetCodeError";
    }
}

export interface ProfileStats {
    ranking: number | null;
    byDifficulty: Record<string, number>; // keys: All, Easy, Medium, Hard
}

function looksLikeHtml(text: string): boolean {
    const t = text.trim().toLowerCase();
    return t.startsWith("<!doctype html") || t.startsWith("<html");
}

async function gql<T>(
    query: string,
    variables: Record<string, unknown>
): Promise<T> {
    const res = await fetch(GRAPHQL, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/json",
            referer: "https://leetcode.com",
            origin: "https://leetcode.com"
        },
        body: JSON.stringify({ query, variables })
    });

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok || !contentType.includes("application/json")) {
        const body = await res.text().catch(() => "");
        if (looksLikeHtml(body)) {
            throw new LeetCodeError(
                `LeetCode returned HTML (blocked or rate-limited), status ${res.status}`
            );
        }
        throw new LeetCodeError(`LeetCode request failed, status ${res.status}`);
    }

    const json = (await res.json()) as {
        data?: T;
        errors?: Array<{ message: string }>;
    };
    if (json.errors && json.errors.length > 0) {
        throw new LeetCodeError(`LeetCode GraphQL error: ${json.errors[0].message}`);
    }
    if (!json.data) {
        throw new LeetCodeError("LeetCode response missing data");
    }
    return json.data;
}

export async function fetchRecentSubmissions(
    username: string,
    limit = 20
): Promise<RecentSubmission[]> {
    const data = await gql<{
        recentSubmissionList: Array<{
            title: string;
            titleSlug: string;
            timestamp: string;
            statusDisplay: string;
            lang: string;
        }> | null;
    }>(
        `query recentSubmissions($username: String!, $limit: Int) {
            recentSubmissionList(username: $username, limit: $limit) {
                title titleSlug timestamp statusDisplay lang
            }
        }`,
        { username, limit }
    );
    return (data.recentSubmissionList ?? []).map((s) => ({
        title: s.title,
        titleSlug: s.titleSlug,
        timestamp: Number(s.timestamp),
        statusDisplay: s.statusDisplay,
        lang: s.lang
    }));
}

export async function fetchRecentAcSubmissions(
    username: string,
    limit = 20
): Promise<AcSubmission[]> {
    const data = await gql<{
        recentAcSubmissionList: Array<{
            id: string;
            title: string;
            titleSlug: string;
            timestamp: string;
        }> | null;
    }>(
        `query recentAcSubmissions($username: String!, $limit: Int) {
            recentAcSubmissionList(username: $username, limit: $limit) {
                id title titleSlug timestamp
            }
        }`,
        { username, limit }
    );
    return (data.recentAcSubmissionList ?? []).map((s) => ({
        id: String(s.id),
        title: s.title,
        titleSlug: s.titleSlug,
        timestamp: Number(s.timestamp)
    }));
}

export async function fetchProfileStats(username: string): Promise<ProfileStats> {
    const data = await gql<{
        matchedUser: {
            profile: { ranking: number | null };
            submitStats: {
                acSubmissionNum: Array<{ difficulty: string; count: number }>;
            };
        } | null;
    }>(
        `query userStats($username: String!) {
            matchedUser(username: $username) {
                profile { ranking }
                submitStats { acSubmissionNum { difficulty count } }
            }
        }`,
        { username }
    );
    if (!data.matchedUser) {
        throw new LeetCodeError(`LeetCode user not found: ${username}`);
    }
    const byDifficulty: Record<string, number> = {};
    for (const d of data.matchedUser.submitStats.acSubmissionNum) {
        byDifficulty[d.difficulty] = d.count;
    }
    return { ranking: data.matchedUser.profile.ranking ?? null, byDifficulty };
}

/** Best-effort difficulty for a problem slug. Caller should catch and treat failures as Unknown. */
export async function fetchDifficulty(slug: string): Promise<string | null> {
    const data = await gql<{
        question: { difficulty: string } | null;
    }>(
        `query questionDifficulty($titleSlug: String!) {
            question(titleSlug: $titleSlug) { difficulty }
        }`,
        { titleSlug: slug }
    );
    return data.question?.difficulty ?? null;
}
