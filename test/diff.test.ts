import { describe, expect, it } from "vitest";
import {
    type AcSubmission,
    type ProblemState,
    type RecentSubmission,
    computeActions,
    isAccepted,
    isTerminal
} from "../src/diff";

function sub(
    slug: string,
    statusDisplay: string,
    timestamp: number,
    lang = "python3"
): RecentSubmission {
    return { titleSlug: slug, title: slug, timestamp, statusDisplay, lang };
}

function ac(slug: string, id: string, timestamp: number): AcSubmission {
    return { titleSlug: slug, title: slug, id, timestamp };
}

const empty = () => new Map<string, ProblemState>();

describe("status helpers", () => {
    it("treats only 'Accepted' as solved", () => {
        expect(isAccepted("Accepted")).toBe(true);
        expect(isAccepted("Wrong Answer")).toBe(false);
        expect(isAccepted("accepted")).toBe(false);
    });

    it("treats pending/judging/empty as non-terminal", () => {
        expect(isTerminal("Accepted")).toBe(true);
        expect(isTerminal("Wrong Answer")).toBe(true);
        expect(isTerminal("Pending")).toBe(false);
        expect(isTerminal("Judging")).toBe(false);
        expect(isTerminal("")).toBe(false);
    });
});

describe("computeActions", () => {
    it("creates an Attempted row for a new non-AC submission", () => {
        const actions = computeActions([sub("a", "Wrong Answer", 100)], [], empty());
        expect(actions).toHaveLength(1);
        expect(actions[0]).toMatchObject({
            kind: "create",
            problem: { slug: "a", status: "attempted", firstAttemptedAt: 100, solvedAt: null }
        });
    });

    it("creates a Solved row for a new AC submission, carrying the AC id", () => {
        const actions = computeActions(
            [sub("a", "Accepted", 200)],
            [ac("a", "999", 200)],
            empty()
        );
        expect(actions).toHaveLength(1);
        expect(actions[0]).toMatchObject({
            kind: "create",
            problem: { slug: "a", status: "solved", solvedAt: 200, acSubmissionId: "999" }
        });
    });

    it("folds attempt+AC in the same window into one Solved create with earliest first-attempt", () => {
        const actions = computeActions(
            [sub("a", "Wrong Answer", 100), sub("a", "Accepted", 150)],
            [ac("a", "1", 150)],
            empty()
        );
        expect(actions).toHaveLength(1);
        expect(actions[0]).toMatchObject({
            kind: "create",
            problem: { slug: "a", status: "solved", firstAttemptedAt: 100, solvedAt: 150 }
        });
    });

    it("updates attempted -> solved for an existing problem", () => {
        const existing = new Map<string, ProblemState>([
            ["a", { slug: "a", title: "a", status: "attempted", firstAttemptedAt: 50, solvedAt: null }]
        ]);
        const actions = computeActions([sub("a", "Accepted", 300)], [ac("a", "7", 300)], existing);
        expect(actions).toHaveLength(1);
        expect(actions[0]).toMatchObject({
            kind: "update",
            problem: { slug: "a", status: "solved", firstAttemptedAt: 50, solvedAt: 300 }
        });
    });

    it("no-ops when the problem is already solved", () => {
        const existing = new Map<string, ProblemState>([
            ["a", { slug: "a", title: "a", status: "solved", firstAttemptedAt: 50, solvedAt: 80 }]
        ]);
        const actions = computeActions([sub("a", "Accepted", 300)], [ac("a", "7", 300)], existing);
        expect(actions).toHaveLength(0);
    });

    it("no-ops when an attempted problem only has further non-AC submissions", () => {
        const existing = new Map<string, ProblemState>([
            ["a", { slug: "a", title: "a", status: "attempted", firstAttemptedAt: 50, solvedAt: null }]
        ]);
        const actions = computeActions([sub("a", "Time Limit Exceeded", 300)], [], existing);
        expect(actions).toHaveLength(0);
    });

    it("skips non-terminal (judging) submissions entirely", () => {
        const actions = computeActions([sub("a", "Pending", 100)], [], empty());
        expect(actions).toHaveLength(0);
    });

    it("handles a slug present only in the AC list", () => {
        const actions = computeActions([], [ac("b", "42", 500)], empty());
        expect(actions).toHaveLength(1);
        expect(actions[0]).toMatchObject({
            kind: "create",
            problem: { slug: "b", status: "solved", solvedAt: 500, acSubmissionId: "42" }
        });
    });

    it("orders actions oldest-first and handles multiple problems", () => {
        const actions = computeActions(
            [sub("late", "Accepted", 900), sub("early", "Wrong Answer", 100)],
            [ac("late", "1", 900)],
            empty()
        );
        expect(actions.map((a) => a.problem.slug)).toEqual(["early", "late"]);
    });
});
