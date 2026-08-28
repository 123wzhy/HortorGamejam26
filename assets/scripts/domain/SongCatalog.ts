import {
    ARE_YOU_OK_BEATMAP,
    Beatmap,
    FENG_WU_JIU_TIAN_BEATMAP,
    ZHU_ZHU_XIA_BEATMAP
} from "./Beatmap";

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
    artist: string;
    beatmap: Beatmap;
    audioPath: string;
    audioDurationMs: number;
    previewVolume: number;
    gameplayVolume: number;
    animation: SongAnimationProfile;
}

export interface SongOutcome {
    passed: boolean;
    score: number;
    maximumScore: number;
    passingScore: number;
    resultClip: "ResultPose" | "ResultPose2" | "ResultPose3";
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
}

export const PERFECT_NOTE_SCORE = 1000;
export const PASS_PERCENT = 60;
export const FIRST_DANCE_DURATION_MS = 26791.66603088379;
export const SECOND_DANCE_DURATION_MS = 20458.33396911621;

export const SONG_CATALOG: SongDefinition[] = [
    {
        id: FENG_WU_JIU_TIAN_BEATMAP.id,
        artist: "凤舞九天",
        beatmap: FENG_WU_JIU_TIAN_BEATMAP,
        audioPath: "audio/bgm/feng-wu-jiu-tian.mp3",
        audioDurationMs: 599928.125,
        previewVolume: 0.78,
        gameplayVolume: 0.86,
        animation: {
            danceClip: "DanceCombo",
            successResultClip: "ResultPose",
            failureResultClip: "ResultPose3",
            danceDurationMs: FIRST_DANCE_DURATION_MS
        }
    },
    {
        id: ZHU_ZHU_XIA_BEATMAP.id,
        artist: "陈洁丽",
        beatmap: ZHU_ZHU_XIA_BEATMAP,
        audioPath: "audio/bgm/zhu-zhu-xia.mp3",
        audioDurationMs: 218462,
        previewVolume: 0.78,
        gameplayVolume: 0.86,
        animation: {
            danceClip: "DanceCombo2",
            successResultClip: "ResultPose2",
            failureResultClip: "ResultPose3",
            danceDurationMs: SECOND_DANCE_DURATION_MS
        }
    },
    {
        id: ARE_YOU_OK_BEATMAP.id,
        artist: "雷军",
        beatmap: ARE_YOU_OK_BEATMAP,
        audioPath: "audio/bgm/are-you-ok.mp3",
        audioDurationMs: 132806.5,
        previewVolume: 0.78,
        gameplayVolume: 0.86,
        animation: {
            danceClip: "DanceCombo",
            successResultClip: "ResultPose",
            failureResultClip: "ResultPose3",
            danceDurationMs: FIRST_DANCE_DURATION_MS
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
    const songDurationMs = finalNote.targetTimeMs + finalJudgementWindowMs;
    const estimatedCompletionMs = songDurationMs
        + song.animation.danceDurationMs / song.beatmap.groups.length;
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
    const count = SONG_CATALOG.length;
    const safeCurrent = isFinite(currentIndex) ? Math.floor(currentIndex) : 0;
    const safeStep = isFinite(step) ? Math.floor(step) : 0;
    return ((safeCurrent + safeStep) % count + count) % count;
}

export function songById(id: string): SongDefinition | null {
    return SONG_CATALOG.filter((song) => song.id === id)[0] || null;
}
