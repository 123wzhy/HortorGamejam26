export type JudgeGrade = "Perfect" | "Good" | "Bad" | "Miss";

export interface JudgeWindows {
    perfectMs: number;
    goodMs: number;
    badMs: number;
}

export interface JudgeResult {
    grade: JudgeGrade;
    deltaMs: number;
    absoluteDeltaMs: number;
    baseScore: number;
    hit: boolean;
}

export const DEFAULT_JUDGE_WINDOWS: JudgeWindows = {
    perfectMs: 50,
    goodMs: 100,
    badMs: 180
};

export const NOTE_SCORES: { [grade: string]: number } = {
    Perfect: 1000,
    Good: 700,
    Bad: 350,
    Miss: 0
};

export class JudgeSystem {
    private readonly windows: JudgeWindows;

    public constructor(windows: JudgeWindows = DEFAULT_JUDGE_WINDOWS) {
        if (windows.perfectMs < 0 || windows.goodMs < windows.perfectMs || windows.badMs < windows.goodMs) {
            throw new Error("Judge windows must be ordered: 0 <= Perfect <= Good <= Bad");
        }
        this.windows = {
            perfectMs: windows.perfectMs,
            goodMs: windows.goodMs,
            badMs: windows.badMs
        };
    }

    public judge(deltaMs: number): JudgeResult {
        const absoluteDeltaMs = Math.abs(deltaMs);
        if (absoluteDeltaMs <= this.windows.perfectMs) {
            return this.makeResult("Perfect", deltaMs);
        }
        if (absoluteDeltaMs <= this.windows.goodMs) {
            return this.makeResult("Good", deltaMs);
        }
        if (absoluteDeltaMs <= this.windows.badMs) {
            return this.makeResult("Bad", deltaMs);
        }
        return this.makeResult("Miss", deltaMs);
    }

    public miss(deltaMs: number): JudgeResult {
        return this.makeResult("Miss", deltaMs);
    }

    public getWindows(): JudgeWindows {
        return {
            perfectMs: this.windows.perfectMs,
            goodMs: this.windows.goodMs,
            badMs: this.windows.badMs
        };
    }

    private makeResult(grade: JudgeGrade, deltaMs: number): JudgeResult {
        return {
            grade,
            deltaMs,
            absoluteDeltaMs: Math.abs(deltaMs),
            baseScore: NOTE_SCORES[grade],
            hit: grade !== "Miss"
        };
    }
}
