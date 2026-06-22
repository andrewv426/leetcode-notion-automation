// Pure classification logic. No I/O, no Worker/Notion imports — unit-tested in test/diff.test.ts.
// Turns LeetCode recent-submission data + existing problem state into idempotent actions.

export interface RecentSubmission {
    titleSlug: string;
    title: string;
    timestamp: number; // unix seconds
    statusDisplay: string;
    lang: string;
}

export interface AcSubmission {
    id: string;
    titleSlug: string;
    title: string;
    timestamp: number; // unix seconds
}

export type ProblemStatus = "attempted" | "solved";

export interface ProblemState {
    slug: string;
    title: string;
    status: ProblemStatus;
    firstAttemptedAt: number | null;
    solvedAt: number | null;
}

export interface ProblemUpsert {
    slug: string;
    title: string;
    status: ProblemStatus;
    lang: string | null;
    firstAttemptedAt: number;
    solvedAt: number | null;
    acSubmissionId: string | null;
}

export type Action =
    | { kind: "create"; problem: ProblemUpsert }
    | { kind: "update"; problem: ProblemUpsert }; // attempted -> solved only

const PENDING = new Set(["pending", "started", "judging", ""]);

/** A submission is terminal once it has a real verdict (not queued/judging). */
export function isTerminal(statusDisplay: string): boolean {
    return !PENDING.has((statusDisplay ?? "").trim().toLowerCase());
}

export function isAccepted(statusDisplay: string): boolean {
    return statusDisplay === "Accepted";
}

interface SlugAgg {
    slug: string;
    title: string;
    firstTs: number;
    solvedAt: number | null;
    lang: string | null;
    acSubmissionId: string | null;
}

/**
 * Fold the recent window into per-problem desired state, then diff against what we already
 * recorded. Forward-only: a problem can go absent -> attempted/solved, or attempted -> solved.
 * Anything already in its target state produces no action.
 */
export function computeActions(
    recent: RecentSubmission[],
    acList: AcSubmission[],
    existing: Map<string, ProblemState>
): Action[] {
    const agg = new Map<string, SlugAgg>();

    // Oldest-first so `lang` ends on the most recent submission for each slug.
    const terminal = recent
        .filter((s) => isTerminal(s.statusDisplay))
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp);

    for (const s of terminal) {
        const accepted = isAccepted(s.statusDisplay);
        const cur = agg.get(s.titleSlug);
        if (!cur) {
            agg.set(s.titleSlug, {
                slug: s.titleSlug,
                title: s.title,
                firstTs: s.timestamp,
                solvedAt: accepted ? s.timestamp : null,
                lang: s.lang || null,
                acSubmissionId: null
            });
        } else {
            cur.firstTs = Math.min(cur.firstTs, s.timestamp);
            if (accepted && (cur.solvedAt === null || s.timestamp < cur.solvedAt)) {
                cur.solvedAt = s.timestamp;
            }
            cur.lang = s.lang || cur.lang;
            if (!cur.title) cur.title = s.title;
        }
    }

    // Merge the AC list: authoritative "solved" signal + the submission id (for a deep link).
    for (const ac of acList) {
        const cur = agg.get(ac.titleSlug);
        if (!cur) {
            agg.set(ac.titleSlug, {
                slug: ac.titleSlug,
                title: ac.title,
                firstTs: ac.timestamp,
                solvedAt: ac.timestamp,
                lang: null,
                acSubmissionId: ac.id
            });
        } else {
            cur.firstTs = Math.min(cur.firstTs, ac.timestamp);
            if (cur.solvedAt === null || ac.timestamp <= cur.solvedAt) {
                cur.solvedAt = ac.timestamp;
                cur.acSubmissionId = ac.id; // id of the earliest AC in the window
            } else if (cur.acSubmissionId === null) {
                cur.acSubmissionId = ac.id;
            }
        }
    }

    const actions: Action[] = [];
    for (const a of agg.values()) {
        const prior = existing.get(a.slug);
        const solved = a.solvedAt !== null;
        if (!prior) {
            actions.push({
                kind: "create",
                problem: {
                    slug: a.slug,
                    title: a.title,
                    status: solved ? "solved" : "attempted",
                    lang: a.lang,
                    firstAttemptedAt: a.firstTs,
                    solvedAt: a.solvedAt,
                    acSubmissionId: a.acSubmissionId
                }
            });
        } else if (prior.status === "attempted" && solved) {
            actions.push({
                kind: "update",
                problem: {
                    slug: a.slug,
                    title: prior.title || a.title,
                    status: "solved",
                    lang: a.lang,
                    firstAttemptedAt: prior.firstAttemptedAt ?? a.firstTs,
                    solvedAt: a.solvedAt,
                    acSubmissionId: a.acSubmissionId
                }
            });
        }
        // prior solved, or attempted with no AC in window => no-op
    }

    // Deterministic ordering (oldest first) for stable, replayable processing.
    actions.sort(
        (x, y) =>
            x.problem.firstAttemptedAt - y.problem.firstAttemptedAt ||
            x.problem.slug.localeCompare(y.problem.slug)
    );
    return actions;
}
