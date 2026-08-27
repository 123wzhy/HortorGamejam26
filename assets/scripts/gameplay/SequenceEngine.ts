import { BeatGroup, BeatNote, Beatmap, Direction } from "../domain/Beatmap";
import { JudgeGrade, JudgeResult, JudgeSystem } from "./JudgeSystem";

export type EngineActionKind = "tooEarly" | "judged" | "missed" | "ignored";
export type EngineActionReason = "too-early" | "wrong-direction" | "expired" | "not-running";

export interface EngineAction {
    kind: EngineActionKind;
    groupIndex: number;
    noteIndex: number;
    finished: boolean;
    groupCompleted: boolean;
    judgement?: JudgeResult;
    reason?: EngineActionReason;
}

export interface GroupNoteStatus {
    note: BeatNote;
    judgement: JudgeResult | null;
    current: boolean;
}

export interface BeatGroupStatus {
    group: BeatGroup;
    groupIndex: number;
    completed: boolean;
    notes: GroupNoteStatus[];
}

export interface SequenceSnapshot {
    running: boolean;
    finished: boolean;
    groupIndex: number;
    groupCount: number;
    noteIndex: number;
    noteCount: number;
    settledNoteCount: number;
    totalNoteCount: number;
    score: number;
    combo: number;
    maxCombo: number;
    mistakes: number;
    lastJudgement: JudgeGrade | "";
}

/** Settles exactly the earliest unresolved note and advances groups automatically. */
export class SequenceEngine {
    private readonly beatmap: Beatmap;
    private readonly judgeSystem: JudgeSystem;
    private readonly totalNoteCount: number;
    private groupIndex: number = 0;
    private noteIndex: number = 0;
    private resolutions: Array<Array<JudgeResult | null>> = [];
    private settledNoteCount: number = 0;
    private score: number = 0;
    private combo: number = 0;
    private maxCombo: number = 0;
    private mistakes: number = 0;
    private lastJudgement: JudgeGrade | "" = "";
    private running: boolean = false;
    private finished: boolean = false;

    public constructor(beatmap: Beatmap, judgeSystem: JudgeSystem) {
        this.validateBeatmap(beatmap);
        this.beatmap = beatmap;
        this.judgeSystem = judgeSystem;
        this.totalNoteCount = beatmap.groups.reduce((sum, group) => sum + group.notes.length, 0);
        this.resetResolutions();
    }

    public start(): void {
        this.groupIndex = 0;
        this.noteIndex = 0;
        this.resetResolutions();
        this.settledNoteCount = 0;
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

    public inputDirection(direction: Direction, songTimeMs: number): EngineAction[] {
        const actions = this.update(songTimeMs);
        if (!this.running) {
            return actions.length > 0 ? actions : [this.makeAction("ignored", false, "not-running")];
        }

        const note = this.getCurrentNote();
        if (!note) {
            return actions.length > 0 ? actions : [this.makeAction("ignored", false, "not-running")];
        }

        const deltaMs = songTimeMs - note.targetTimeMs;
        const badWindow = this.judgeSystem.getWindows().badMs;
        if (deltaMs < -badWindow) {
            actions.push(this.makeAction("tooEarly", false, "too-early"));
            return actions;
        }
        if (direction !== note.direction) {
            actions.push(this.resolve(this.judgeSystem.miss(deltaMs), "wrong-direction"));
            return actions;
        }

        const judgement = this.judgeSystem.judge(deltaMs);
        actions.push(judgement.hit
            ? this.resolve(judgement)
            : this.resolve(this.judgeSystem.miss(deltaMs), "expired"));
        return actions;
    }

    public update(songTimeMs: number): EngineAction[] {
        const actions: EngineAction[] = [];
        const badWindow = this.judgeSystem.getWindows().badMs;
        let note = this.getCurrentNote();
        while (this.running && note && songTimeMs > note.targetTimeMs + badWindow) {
            actions.push(this.resolve(this.judgeSystem.miss(songTimeMs - note.targetTimeMs), "expired"));
            note = this.getCurrentNote();
        }
        return actions;
    }

    public getCurrentNote(): BeatNote | null {
        const group = this.beatmap.groups[this.groupIndex];
        return this.running && group ? group.notes[this.noteIndex] || null : null;
    }

    public getGroupStatus(index: number): BeatGroupStatus | null {
        const group = this.beatmap.groups[index];
        if (!group) {
            return null;
        }
        return {
            group,
            groupIndex: index,
            completed: this.finished || index < this.groupIndex,
            notes: group.notes.map((note, noteIndex) => ({
                note,
                judgement: this.resolutions[index][noteIndex],
                current: this.running && index === this.groupIndex && noteIndex === this.noteIndex
            }))
        };
    }

    public getSnapshot(): SequenceSnapshot {
        const currentGroup = this.beatmap.groups[this.groupIndex];
        const finalGroup = this.beatmap.groups[this.beatmap.groups.length - 1];
        return {
            running: this.running,
            finished: this.finished,
            groupIndex: this.groupIndex,
            groupCount: this.beatmap.groups.length,
            noteIndex: this.noteIndex,
            noteCount: currentGroup ? currentGroup.notes.length : finalGroup.notes.length,
            settledNoteCount: this.settledNoteCount,
            totalNoteCount: this.totalNoteCount,
            score: this.score,
            combo: this.combo,
            maxCombo: this.maxCombo,
            mistakes: this.mistakes,
            lastJudgement: this.lastJudgement
        };
    }

    private resolve(judgement: JudgeResult, reason?: "wrong-direction" | "expired"): EngineAction {
        const resolvedGroupIndex = this.groupIndex;
        const resolvedNoteIndex = this.noteIndex;
        this.resolutions[resolvedGroupIndex][resolvedNoteIndex] = judgement;
        this.settledNoteCount += 1;
        this.lastJudgement = judgement.grade;

        if (judgement.hit) {
            this.combo += 1;
            this.maxCombo = Math.max(this.maxCombo, this.combo);
            this.score += judgement.baseScore;
        } else {
            this.combo = 0;
            this.mistakes += 1;
        }

        this.noteIndex += 1;
        let groupCompleted = false;
        const group = this.beatmap.groups[resolvedGroupIndex];
        if (this.noteIndex >= group.notes.length) {
            groupCompleted = true;
            this.groupIndex += 1;
            this.noteIndex = 0;
        }
        if (this.groupIndex >= this.beatmap.groups.length) {
            this.running = false;
            this.finished = true;
        }

        return {
            kind: judgement.hit ? "judged" : "missed",
            groupIndex: resolvedGroupIndex,
            noteIndex: resolvedNoteIndex,
            finished: this.finished,
            groupCompleted,
            judgement,
            reason
        };
    }

    private makeAction(kind: EngineActionKind, groupCompleted: boolean, reason?: EngineActionReason): EngineAction {
        return {
            kind,
            groupIndex: Math.min(this.groupIndex, this.beatmap.groups.length - 1),
            noteIndex: this.noteIndex,
            finished: this.finished,
            groupCompleted,
            reason
        };
    }

    private resetResolutions(): void {
        this.resolutions = this.beatmap.groups.map((group) => group.notes.map(() => null));
    }

    private validateBeatmap(beatmap: Beatmap): void {
        if (!beatmap.groups.length) {
            throw new Error("Beatmap must contain at least one group");
        }
        let previousTarget = Number.NEGATIVE_INFINITY;
        beatmap.groups.forEach((group) => {
            if (!group.notes.length) {
                throw new Error("Beat groups must contain at least one note");
            }
            group.notes.forEach((note) => {
                if (!isFinite(note.targetTimeMs) || note.targetTimeMs <= previousTarget) {
                    throw new Error("Beat notes must have finite, strictly increasing target times");
                }
                previousTarget = note.targetTimeMs;
            });
        });
    }
}
