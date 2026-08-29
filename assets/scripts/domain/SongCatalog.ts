import { Beatmap, DEMO_BEATMAP, SECOND_DEMO_BEATMAP } from "./Beatmap";

export type DancerClipName = "IdleSway" | "IdleSway0" | "DanceCombo" | "DanceCombo2"
    | "ResultPose" | "ResultPose2" | "ResultPose3";

export interface SongAnimationProfile {
    danceClip: "DanceCombo" | "DanceCombo2";
    successResultClip: "ResultPose" | "ResultPose2";
    failureResultClip: "ResultPose3";
    danceDurationMs: number;
}

export interface SongDefinition {
    id: string;
    beatmap: Beatmap;
    previewPath: string;
    previewVolume: number;
    animation: SongAnimationProfile;
}

export interface SongOutcome {
    passed: boolean;
    score: number;
    maximumScore: number;
    passingScore: number;
    resultClip: "ResultPose" | "ResultPose2" | "ResultPose3";
    resultDurationMs: number;
}

export interface SongSessionConfig {
    songId: string;
    title: string;
    beatmap: Beatmap;
    groupCount: number;
    noteCount: number;
    songDurationMs: number;
    danceDurationMs: number;
}

export const PERFECT_NOTE_SCORE = 1000;
export const PASS_PERCENT = 60;
export const FIRST_DANCE_DURATION_MS = 26791.66603088379;
export const SECOND_DANCE_DURATION_MS = 20458.33396911621;
export const FIRST_SUCCESS_RESULT_DURATION_MS = 12458.333015441895;
export const SECOND_SUCCESS_RESULT_DURATION_MS = 18791.66603088379;
export const FAILURE_RESULT_DURATION_MS = 3833.3332538604736;

export const DEMO_SONGS: SongDefinition[] = [
    {
        id: DEMO_BEATMAP.id,
        beatmap: DEMO_BEATMAP,
        previewPath: "audio/bgm/neon-grid-demo-preview.wav",
        previewVolume: 0.78,
        animation: {
            danceClip: "DanceCombo",
            successResultClip: "ResultPose",
            failureResultClip: "ResultPose3",
            danceDurationMs: FIRST_DANCE_DURATION_MS
        }
    },
    {
        id: SECOND_DEMO_BEATMAP.id,
        beatmap: SECOND_DEMO_BEATMAP,
        previewPath: "audio/bgm/golden-stampede-demo-preview.wav",
        previewVolume: 0.78,
        animation: {
            danceClip: "DanceCombo2",
            successResultClip: "ResultPose2",
            failureResultClip: "ResultPose3",
            danceDurationMs: SECOND_DANCE_DURATION_MS
        }
    }
];

export function beatmapNoteCount(beatmap: Beatmap): number {
    return beatmap.groups.reduce((count, group) => count + group.notes.length, 0);
}

/** Derives every per-run clock/flow input from one selected song. */
export function createSongSessionConfig(
    song: SongDefinition,
    finalJudgementWindowMs: number
): SongSessionConfig {
    if (!song || !song.beatmap || !song.beatmap.groups.length) {
        throw new Error("Song session requires a non-empty beatmap");
    }
    if (!isFinite(finalJudgementWindowMs) || finalJudgementWindowMs < 0) {
        throw new Error("Song session requires a non-negative final judgement window");
    }
    const finalGroup = song.beatmap.groups[song.beatmap.groups.length - 1];
    const finalNote = finalGroup.notes[finalGroup.notes.length - 1];
    if (!finalNote || !isFinite(finalNote.targetTimeMs)) {
        throw new Error("Song session requires a finite final note time");
    }
    return {
        songId: song.id,
        title: song.beatmap.title,
        beatmap: song.beatmap,
        groupCount: song.beatmap.groups.length,
        noteCount: beatmapNoteCount(song.beatmap),
        songDurationMs: finalNote.targetTimeMs + finalJudgementWindowMs,
        danceDurationMs: song.animation.danceDurationMs
    };
}

export function maximumSongScore(song: SongDefinition): number {
    return beatmapNoteCount(song.beatmap) * PERFECT_NOTE_SCORE;
}

/** The 60% line rounds upward so a fractional point can never count as passed. */
export function passingSongScore(song: SongDefinition): number {
    return Math.ceil(maximumSongScore(song) * PASS_PERCENT / 100);
}

export function resolveSongOutcome(song: SongDefinition, score: number): SongOutcome {
    const normalizedScore = isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
    const maximumScore = maximumSongScore(song);
    const passingScore = passingSongScore(song);
    const passed = normalizedScore >= passingScore;
    const resultClip = passed
        ? song.animation.successResultClip
        : song.animation.failureResultClip;
    return {
        passed,
        score: normalizedScore,
        maximumScore,
        passingScore,
        resultClip,
        resultDurationMs: resultClipDurationMs(resultClip)
    };
}

/** Durations are sourced from the imported dancer clip metadata. */
export function resultClipDurationMs(
    clip: "ResultPose" | "ResultPose2" | "ResultPose3"
): number {
    if (clip === "ResultPose") {
        return FIRST_SUCCESS_RESULT_DURATION_MS;
    }
    if (clip === "ResultPose2") {
        return SECOND_SUCCESS_RESULT_DURATION_MS;
    }
    return FAILURE_RESULT_DURATION_MS;
}

export function wrappedSongIndex(currentIndex: number, step: number): number {
    const count = DEMO_SONGS.length;
    const safeCurrent = isFinite(currentIndex) ? Math.floor(currentIndex) : 0;
    const safeStep = isFinite(step) ? Math.floor(step) : 0;
    return ((safeCurrent + safeStep) % count + count) % count;
}

export function songById(id: string): SongDefinition | null {
    return DEMO_SONGS.filter((song) => song.id === id)[0] || null;
}
