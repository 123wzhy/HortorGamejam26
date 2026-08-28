export const DANCE_COMBO_DURATION_MS = 26800.00114440918;

export type GroupDancePhase = "input" | "dance" | "result";

export interface GroupDanceSegment {
    groupIndex: number;
    groupCount: number;
    startMs: number;
    endMs: number;
    durationMs: number;
    elapsedMs: number;
    remainingMs: number;
    progress: number;
    final: boolean;
}

export interface GroupDanceSnapshot {
    phase: GroupDancePhase;
    inputLocked: boolean;
    segment: GroupDanceSegment | null;
}

export type GroupDanceTransition = {
    kind: "next-group";
    completedGroupIndex: number;
    nextGroupIndex: number;
} | {
    kind: "result";
    completedGroupIndex: number;
};

/**
 * Owns the deterministic input-locked dance interval between beat groups. The
 * optional dancer asset follows this clock, never the other way around, so a
 * failed async load cannot block the next group or stop the song clock.
 */
export class GroupDanceFlow {
    private readonly groupCount: number;
    private readonly totalDanceDurationMs: number;
    private phase: GroupDancePhase = "input";
    private groupIndex: number = -1;
    private elapsedMs: number = 0;

    public constructor(
        groupCount: number,
        totalDanceDurationMs: number = DANCE_COMBO_DURATION_MS
    ) {
        if (!isFinite(groupCount) || groupCount <= 0 || Math.floor(groupCount) !== groupCount) {
            throw new Error("GroupDanceFlow requires a positive integer group count");
        }
        if (!isFinite(totalDanceDurationMs) || totalDanceDurationMs <= 0) {
            throw new Error("GroupDanceFlow requires a positive finite dance duration");
        }
        this.groupCount = groupCount;
        this.totalDanceDurationMs = totalDanceDurationMs;
    }

    public reset(): void {
        this.phase = "input";
        this.groupIndex = -1;
        this.elapsedMs = 0;
    }

    public beginGroupDance(completedGroupIndex: number): GroupDanceSegment {
        if (this.phase !== "input") {
            throw new Error("Cannot begin a dance segment outside the input phase");
        }
        if (!isFinite(completedGroupIndex) || Math.floor(completedGroupIndex) !== completedGroupIndex
            || completedGroupIndex < 0 || completedGroupIndex >= this.groupCount) {
            throw new Error("Dance segment group index is out of range");
        }
        this.phase = "dance";
        this.groupIndex = completedGroupIndex;
        this.elapsedMs = 0;
        return this.getActiveSegment() as GroupDanceSegment;
    }

    /** Advances at most the active segment; overshoot never skips a future input phase. */
    public update(deltaMs: number): GroupDanceTransition | null {
        if (this.phase !== "dance" || !isFinite(deltaMs) || deltaMs <= 0) {
            return null;
        }
        const segmentDurationMs = this.segmentEndMs(this.groupIndex)
            - this.segmentStartMs(this.groupIndex);
        this.elapsedMs = Math.min(segmentDurationMs, this.elapsedMs + deltaMs);
        if (this.elapsedMs < segmentDurationMs) {
            return null;
        }

        const completedGroupIndex = this.groupIndex;
        this.elapsedMs = segmentDurationMs;
        if (completedGroupIndex >= this.groupCount - 1) {
            this.phase = "result";
            return { kind: "result", completedGroupIndex };
        }

        this.phase = "input";
        this.groupIndex = -1;
        this.elapsedMs = 0;
        return {
            kind: "next-group",
            completedGroupIndex,
            nextGroupIndex: completedGroupIndex + 1
        };
    }

    public getSnapshot(): GroupDanceSnapshot {
        return {
            phase: this.phase,
            inputLocked: this.phase !== "input",
            segment: this.getActiveSegment()
        };
    }

    private getActiveSegment(): GroupDanceSegment | null {
        if (this.phase !== "dance" || this.groupIndex < 0) {
            return null;
        }
        const startMs = this.segmentStartMs(this.groupIndex);
        const endMs = this.segmentEndMs(this.groupIndex);
        const durationMs = endMs - startMs;
        return {
            groupIndex: this.groupIndex,
            groupCount: this.groupCount,
            startMs,
            endMs,
            durationMs,
            elapsedMs: this.elapsedMs,
            remainingMs: Math.max(0, durationMs - this.elapsedMs),
            progress: durationMs > 0 ? this.elapsedMs / durationMs : 1,
            final: this.groupIndex === this.groupCount - 1
        };
    }

    private segmentStartMs(groupIndex: number): number {
        return this.totalDanceDurationMs * groupIndex / this.groupCount;
    }

    private segmentEndMs(groupIndex: number): number {
        return this.totalDanceDurationMs * (groupIndex + 1) / this.groupCount;
    }
}
