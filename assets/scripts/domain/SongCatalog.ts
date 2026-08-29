import {
    ARE_YOU_OK_BEATMAP,
    Beatmap,
    FENG_WU_JIU_TIAN_BEATMAP,
    ZHU_ZHU_XIA_BEATMAP
} from "./Beatmap";

export type DancerClipName = "IdleSway" | "IdleSway0" | "DanceCombo" | "DanceCombo2"
    | "ResultPose" | "ResultPose2" | "ResultPose3";

export type SongAnimationProfileId = "A" | "B";

export interface SongAnimationProfile {
    readonly id: SongAnimationProfileId;
    danceClip: "DanceCombo" | "DanceCombo2";
    successResultClip: "ResultPose" | "ResultPose2";
    failureResultClip: "ResultPose3";
    danceDurationMs: number;
}

export interface SongDefinition {
    id: string;
    artist: string;
    beatmap: Beatmap;
    audioPath: string;
    audioDurationMs: number;
    previewVolume: number;
    gameplayVolume: number;
}

export interface SongOutcome {
    passed: boolean;
    score: number;
    maximumScore: number;
    passingScore: number;
    animationProfileId: SongAnimationProfileId;
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
    estimatedCompletionMs: number;
    audioDurationMs: number;
    danceDurationMs: number;
    animationProfile: SongAnimationProfile;
}

export const PERFECT_NOTE_SCORE = 1000;
export const PASS_PERCENT = 60;
export const FIRST_DANCE_DURATION_MS = 26791.66603088379;
export const SECOND_DANCE_DURATION_MS = 20458.33396911621;
export const FIRST_SUCCESS_RESULT_DURATION_MS = 12458.333015441895;
export const SECOND_SUCCESS_RESULT_DURATION_MS = 18791.66603088379;
export const FAILURE_RESULT_DURATION_MS = 3833.3332538604736;

export const SONG_ANIMATION_PROFILES: SongAnimationProfile[] = [
    Object.freeze({
        id: "A" as SongAnimationProfileId,
        danceClip: "DanceCombo" as "DanceCombo",
        successResultClip: "ResultPose" as "ResultPose",
        failureResultClip: "ResultPose3" as "ResultPose3",
        danceDurationMs: FIRST_DANCE_DURATION_MS
    }),
    Object.freeze({
        id: "B" as SongAnimationProfileId,
        danceClip: "DanceCombo2" as "DanceCombo2",
        successResultClip: "ResultPose2" as "ResultPose2",
        failureResultClip: "ResultPose3" as "ResultPose3",
        danceDurationMs: SECOND_DANCE_DURATION_MS
    })
];
Object.freeze(SONG_ANIMATION_PROFILES);

export const SONG_CATALOG: SongDefinition[] = [
    {
        id: FENG_WU_JIU_TIAN_BEATMAP.id,
        artist: "凤舞九天",
        beatmap: FENG_WU_JIU_TIAN_BEATMAP,
        audioPath: "audio/bgm/feng-wu-jiu-tian.mp3",
        audioDurationMs: 599928.125,
        previewVolume: 0.78,
        gameplayVolume: 0.86
    },
    {
        id: ZHU_ZHU_XIA_BEATMAP.id,
        artist: "陈洁丽",
        beatmap: ZHU_ZHU_XIA_BEATMAP,
        audioPath: "audio/bgm/zhu-zhu-xia.mp3",
        audioDurationMs: 218462,
        previewVolume: 0.78,
        gameplayVolume: 0.86
    },
    {
        id: ARE_YOU_OK_BEATMAP.id,
        artist: "雷军",
        beatmap: ARE_YOU_OK_BEATMAP,
        audioPath: "audio/bgm/are-you-ok.mp3",
        audioDurationMs: 132806.5,
        previewVolume: 0.78,
        gameplayVolume: 0.86
    }
];

export function beatmapNoteCount(beatmap: Beatmap): number {
    return beatmap.groups.reduce((count, group) => count + group.notes.length, 0);
}

function canonicalAnimationProfile(
    profile: SongAnimationProfile | null | undefined
): SongAnimationProfile | null {
    if (!profile) {
        return null;
    }
    return SONG_ANIMATION_PROFILES.filter((candidate) => {
        return candidate.id === profile.id
            && candidate.danceClip === profile.danceClip
            && candidate.successResultClip === profile.successResultClip
            && candidate.failureResultClip === profile.failureResultClip
            && candidate.danceDurationMs === profile.danceDurationMs;
    })[0] || null;
}

export function isKnownSongAnimationProfile(
    profile: SongAnimationProfile | null | undefined
): boolean {
    return canonicalAnimationProfile(profile) !== null;
}

/**
 * Pure mapping for an injected Math.random-style value. Finite values are
 * clamped to [0, 1]; invalid values deterministically fall back to profile A.
 */
export function selectSongAnimationProfile(randomValue: number): SongAnimationProfile {
    const normalized = isFinite(randomValue)
        ? Math.max(0, Math.min(1, randomValue))
        : 0;
    return SONG_ANIMATION_PROFILES[normalized < 0.5 ? 0 : 1];
}

/** Derives every per-run clock/flow input from one selected song and profile. */
export function createSongSessionConfig(
    song: SongDefinition,
    animationProfile: SongAnimationProfile,
    finalJudgementWindowMs: number
): SongSessionConfig {
    if (!song || !song.beatmap || !song.beatmap.groups.length) {
        throw new Error("Song session requires a non-empty beatmap");
    }
    if (!isFinite(finalJudgementWindowMs) || finalJudgementWindowMs < 0) {
        throw new Error("Song session requires a non-negative final judgement window");
    }
    const canonicalProfile = canonicalAnimationProfile(animationProfile);
    if (!canonicalProfile) {
        throw new Error("Song session requires a known matched animation profile");
    }
    const finalGroup = song.beatmap.groups[song.beatmap.groups.length - 1];
    const finalNote = finalGroup.notes[finalGroup.notes.length - 1];
    if (!finalNote || !isFinite(finalNote.targetTimeMs)) {
        throw new Error("Song session requires a finite final note time");
    }
    const songDurationMs = finalNote.targetTimeMs + finalJudgementWindowMs;
    const estimatedCompletionMs = songDurationMs
        + canonicalProfile.danceDurationMs / song.beatmap.groups.length;
    if (estimatedCompletionMs >= song.audioDurationMs) {
        throw new Error("Song audio must outlast its playable session");
    }
    return {
        songId: song.id,
        title: song.beatmap.title,
        beatmap: song.beatmap,
        groupCount: song.beatmap.groups.length,
        noteCount: beatmapNoteCount(song.beatmap),
        songDurationMs,
        estimatedCompletionMs,
        audioDurationMs: song.audioDurationMs,
        danceDurationMs: canonicalProfile.danceDurationMs,
        animationProfile: canonicalProfile
    };
}

/** Selects exactly one profile from an injected value and stores it in the run session. */
export function createSongRunSessionConfig(
    song: SongDefinition,
    finalJudgementWindowMs: number,
    randomValue: number
): SongSessionConfig {
    return createSongSessionConfig(
        song,
        selectSongAnimationProfile(randomValue),
        finalJudgementWindowMs
    );
}

export function maximumSongScore(song: SongDefinition): number {
    return beatmapNoteCount(song.beatmap) * PERFECT_NOTE_SCORE;
}

/** The 60% line rounds upward so a fractional point can never count as passed. */
export function passingSongScore(song: SongDefinition): number {
    return Math.ceil(maximumSongScore(song) * PASS_PERCENT / 100);
}

export function resolveSongOutcome(
    song: SongDefinition,
    animationProfile: SongAnimationProfile,
    score: number
): SongOutcome {
    const canonicalProfile = canonicalAnimationProfile(animationProfile);
    if (!canonicalProfile) {
        throw new Error("Song outcome requires a known matched animation profile");
    }
    const normalizedScore = isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
    const maximumScore = maximumSongScore(song);
    const passingScore = passingSongScore(song);
    const passed = normalizedScore >= passingScore;
    const resultClip = passed
        ? canonicalProfile.successResultClip
        : canonicalProfile.failureResultClip;
    return {
        passed,
        score: normalizedScore,
        maximumScore,
        passingScore,
        animationProfileId: canonicalProfile.id,
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
    const count = SONG_CATALOG.length;
    const safeCurrent = isFinite(currentIndex) ? Math.floor(currentIndex) : 0;
    const safeStep = isFinite(step) ? Math.floor(step) : 0;
    return ((safeCurrent + safeStep) % count + count) % count;
}

export function songById(id: string): SongDefinition | null {
    return SONG_CATALOG.filter((song) => song.id === id)[0] || null;
}
