import { Beatmap, BeatNote } from "./Beatmap";

export const MAX_DIFFICULTY_STARS = 3;

export interface BeatmapDifficultyAnalysis {
    stars: number;
    score: number;
    noteCount: number;
    activeDurationMs: number;
    notesPerSecond: number;
    directionChangeRate: number;
    rapidNoteRate: number;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, isFinite(value) ? value : 0));
}

function finitePositive(value: number): number {
    return typeof value === "number" && isFinite(value) && value > 0 ? value : 0;
}

function sortedNotes(beatmap: Beatmap): BeatNote[] {
    const notes: BeatNote[] = [];
    (beatmap.groups || []).forEach((group) => {
        (group.notes || []).forEach((note) => notes.push(note));
    });
    return notes.sort((left, right) => left.targetTimeMs - right.targetTimeMs);
}

/**
 * Rates a generated chart, not its audio file. The generator remains the source
 * of truth for note timing; this pass turns measurable chart pressure into the
 * three-star scale used by the song-selection UI.
 */
export function analyzeBeatmapDifficulty(beatmap: Beatmap): BeatmapDifficultyAnalysis {
    const notes = sortedNotes(beatmap);
    const noteCount = notes.length;
    const firstTimeMs = noteCount > 0 ? finitePositive(notes[0].targetTimeMs) : 0;
    const lastTimeMs = noteCount > 0 ? finitePositive(notes[noteCount - 1].targetTimeMs) : 0;
    const activeDurationMs = noteCount > 1 ? Math.max(1, lastTimeMs - firstTimeMs) : 0;
    const notesPerSecond = activeDurationMs > 0
        ? (noteCount - 1) / (activeDurationMs / 1000)
        : 0;

    let directionChanges = 0;
    let rapidNotes = 0;
    const intervalCount = Math.max(0, noteCount - 1);
    const beatDurationMs = finitePositive(beatmap.bpm) > 0 ? 60000 / beatmap.bpm : 600;
    const rapidThresholdMs = beatDurationMs * 0.75;
    for (let index = 1; index < notes.length; index += 1) {
        if (notes[index].direction !== notes[index - 1].direction) {
            directionChanges += 1;
        }
        const intervalMs = notes[index].targetTimeMs - notes[index - 1].targetTimeMs;
        if (intervalMs > 0 && intervalMs < rapidThresholdMs) {
            rapidNotes += 1;
        }
    }

    const directionChangeRate = intervalCount > 0 ? directionChanges / intervalCount : 0;
    const rapidNoteRate = intervalCount > 0 ? rapidNotes / intervalCount : 0;
    const densityPressure = clamp01((notesPerSecond - 0.55) / 1.75);
    const tempoPressure = clamp01((finitePositive(beatmap.bpm) - 75) / 125);
    const variationPressure = clamp01(directionChangeRate);
    const rapidPressure = clamp01(rapidNoteRate);
    const score = clamp01(
        densityPressure * 0.48
        + tempoPressure * 0.22
        + variationPressure * 0.12
        + rapidPressure * 0.18
    );
    const stars = score >= 0.67 ? 3 : score >= 0.34 ? 2 : 1;

    return {
        stars,
        score,
        noteCount,
        activeDurationMs,
        notesPerSecond,
        directionChangeRate,
        rapidNoteRate
    };
}
