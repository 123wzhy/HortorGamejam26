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
    animation: SongAnimationProfile;
}

export interface SongOutcome {
    passed: boolean;
    score: number;
    maximumScore: number;
    passingScore: number;
    resultClip: "ResultPose" | "ResultPose2" | "ResultPose3";
}

export const PERFECT_NOTE_SCORE = 1000;
export const PASS_PERCENT = 60;
export const FIRST_DANCE_DURATION_MS = 26800.00114440918;
export const SECOND_DANCE_DURATION_MS = 20466.66717529297;

export const DEMO_SONGS: SongDefinition[] = [
    {
        id: DEMO_BEATMAP.id,
        beatmap: DEMO_BEATMAP,
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
    return {
        passed,
        score: normalizedScore,
        maximumScore,
        passingScore,
        resultClip: passed
            ? song.animation.successResultClip
            : song.animation.failureResultClip
    };
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
