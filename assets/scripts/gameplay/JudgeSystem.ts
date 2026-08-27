export type JudgeGrade = "Perfect" | "Great" | "Good" | "Miss";

export interface JudgeWindows {
    perfectMs: number;
    greatMs: number;
    goodMs: number;
}

export interface JudgeResult {
    grade: JudgeGrade;
    deltaMs: number;
    absoluteDeltaMs: number;
    baseScore: number;
    hit: boolean;
}

export const DEFAULT_JUDGE_WINDOWS: JudgeWindows = {
    perfectMs: 45,
    greatMs: 90,
    goodMs: 150
};

export class JudgeSystem {
    private readonly windows: JudgeWindows;

    public constructor(windows: JudgeWindows = DEFAULT_JUDGE_WINDOWS) {
        if (windows.perfectMs < 0 || windows.greatMs < windows.perfectMs || windows.goodMs < windows.greatMs) {
            throw new Error("Judge windows must be ordered: 0 <= Perfect <= Great <= Good");
        }
        this.windows = {
            perfectMs: windows.perfectMs,
            greatMs: windows.greatMs,
            goodMs: windows.goodMs
        };
    }

    public judge(deltaMs: number): JudgeResult {
        const absoluteDeltaMs = Math.abs(deltaMs);
        if (absoluteDeltaMs <= this.windows.perfectMs) {
            return this.makeResult("Perfect", deltaMs, absoluteDeltaMs, 1000, true);
        }
        if (absoluteDeltaMs <= this.windows.greatMs) {
            return this.makeResult("Great", deltaMs, absoluteDeltaMs, 700, true);
        }
        if (absoluteDeltaMs <= this.windows.goodMs) {
            return this.makeResult("Good", deltaMs, absoluteDeltaMs, 400, true);
        }
        return this.makeResult("Miss", deltaMs, absoluteDeltaMs, 0, false);
    }

    public getWindows(): JudgeWindows {
        return {
            perfectMs: this.windows.perfectMs,
            greatMs: this.windows.greatMs,
            goodMs: this.windows.goodMs
        };
    }

    private makeResult(
        grade: JudgeGrade,
        deltaMs: number,
        absoluteDeltaMs: number,
        baseScore: number,
        hit: boolean
    ): JudgeResult {
        return { grade, deltaMs, absoluteDeltaMs, baseScore, hit };
    }
}
