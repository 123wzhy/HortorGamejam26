import { Beatmap, BeatSequence, Direction } from "../domain/Beatmap";
import { JudgeGrade, JudgeResult, JudgeSystem } from "./JudgeSystem";

export type EngineActionKind =
    | "accepted"
    | "ready"
    | "wrong"
    | "tooEarly"
    | "judged"
    | "missed"
    | "ignored";

export interface EngineAction {
    kind: EngineActionKind;
    sequenceIndex: number;
    enteredCount: number;
    finished: boolean;
    judgement?: JudgeResult;
    reason?: "wrong-direction" | "incomplete" | "expired" | "not-running" | "already-ready";
}

export interface SequenceSnapshot {
    running: boolean;
    finished: boolean;
    sequenceIndex: number;
    sequenceCount: number;
    enteredCount: number;
    score: number;
    combo: number;
    maxCombo: number;
    mistakes: number;
    lastJudgement: JudgeGrade | "";
}

/** Owns direction entry, beat confirmation, timeout misses, combo and score. */
export class SequenceEngine {
    private readonly beatmap: Beatmap;
    private readonly judgeSystem: JudgeSystem;
    private sequenceIndex: number = 0;
    private entered: Direction[] = [];
    private score: number = 0;
    private combo: number = 0;
    private maxCombo: number = 0;
    private mistakes: number = 0;
    private lastJudgement: JudgeGrade | "" = "";
    private running: boolean = false;
    private finished: boolean = false;

    public constructor(beatmap: Beatmap, judgeSystem: JudgeSystem) {
        if (!beatmap.sequences.length) {
            throw new Error("Beatmap must contain at least one sequence");
        }
        this.beatmap = beatmap;
        this.judgeSystem = judgeSystem;
    }

    public start(): void {
        this.sequenceIndex = 0;
        this.entered = [];
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.mistakes = 0;
        this.lastJudgement = "";
        this.running = true;
        this.finished = false;
    }

    public restart(): void {
        this.start();
    }

    public inputDirection(direction: Direction, songTimeMs: number): EngineAction {
        const expired = this.update(songTimeMs);
        if (expired.length > 0) {
            return expired[expired.length - 1];
        }
        const sequence = this.getCurrentSequence();
        if (!this.running || !sequence) {
            return this.action("ignored", "not-running");
        }
        if (this.entered.length >= sequence.directions.length) {
            return this.action("ignored", "already-ready");
        }
        const expected = sequence.directions[this.entered.length];
        if (direction !== expected) {
            this.entered = [];
            this.mistakes += 1;
            return this.action("wrong", "wrong-direction");
        }
        this.entered.push(direction);
        return this.action(this.entered.length === sequence.directions.length ? "ready" : "accepted");
    }

    public confirm(songTimeMs: number): EngineAction {
        const expired = this.update(songTimeMs);
        if (expired.length > 0) {
            return expired[expired.length - 1];
        }
        const sequence = this.getCurrentSequence();
        if (!this.running || !sequence) {
            return this.action("ignored", "not-running");
        }

        const deltaMs = songTimeMs - sequence.targetTimeMs;
        const windows = this.judgeSystem.getWindows();
        if (deltaMs < -windows.goodMs) {
            return this.action("tooEarly");
        }
        if (this.entered.length !== sequence.directions.length) {
            return this.resolveMiss(deltaMs, "incomplete");
        }

        const judgement = this.judgeSystem.judge(deltaMs);
        if (!judgement.hit) {
            return this.resolveMiss(deltaMs, "expired");
        }
        return this.resolveHit(judgement);
    }

    public update(songTimeMs: number): EngineAction[] {
        const actions: EngineAction[] = [];
        const goodWindow = this.judgeSystem.getWindows().goodMs;
        let sequence = this.getCurrentSequence();
        while (this.running && sequence && songTimeMs > sequence.targetTimeMs + goodWindow) {
            actions.push(this.resolveMiss(songTimeMs - sequence.targetTimeMs, "expired"));
            sequence = this.getCurrentSequence();
        }
        return actions;
    }

    public getCurrentSequence(): BeatSequence | null {
        return this.sequenceIndex < this.beatmap.sequences.length
            ? this.beatmap.sequences[this.sequenceIndex]
            : null;
    }

    public getSnapshot(): SequenceSnapshot {
        return {
            running: this.running,
            finished: this.finished,
            sequenceIndex: this.sequenceIndex,
            sequenceCount: this.beatmap.sequences.length,
            enteredCount: this.entered.length,
            score: this.score,
            combo: this.combo,
            maxCombo: this.maxCombo,
            mistakes: this.mistakes,
            lastJudgement: this.lastJudgement
        };
    }

    private resolveHit(judgement: JudgeResult): EngineAction {
        const resolvedIndex = this.sequenceIndex;
        this.combo += 1;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.score += judgement.baseScore + Math.min(20, this.combo - 1) * 10;
        this.lastJudgement = judgement.grade;
        this.advance();
        return {
            kind: "judged",
            sequenceIndex: resolvedIndex,
            enteredCount: 0,
            finished: this.finished,
            judgement
        };
    }

    private resolveMiss(deltaMs: number, reason: "incomplete" | "expired"): EngineAction {
        const resolvedIndex = this.sequenceIndex;
        const judgement = this.judgeSystem.judge(deltaMs);
        const miss: JudgeResult = judgement.hit
            ? { grade: "Miss", deltaMs, absoluteDeltaMs: Math.abs(deltaMs), baseScore: 0, hit: false }
            : judgement;
        this.combo = 0;
        this.lastJudgement = "Miss";
        this.advance();
        return {
            kind: "missed",
            sequenceIndex: resolvedIndex,
            enteredCount: 0,
            finished: this.finished,
            judgement: miss,
            reason
        };
    }

    private advance(): void {
        this.entered = [];
        this.sequenceIndex += 1;
        if (this.sequenceIndex >= this.beatmap.sequences.length) {
            this.running = false;
            this.finished = true;
        }
    }

    private action(kind: EngineActionKind, reason?: EngineAction["reason"]): EngineAction {
        return {
            kind,
            sequenceIndex: this.sequenceIndex,
            enteredCount: this.entered.length,
            finished: this.finished,
            reason
        };
    }
}
