import { Beatmap, FENG_WU_JIU_TIAN_BEATMAP } from "../assets/scripts/domain/Beatmap";
import { analyzeBeatmapDifficulty, MAX_DIFFICULTY_STARS } from "../assets/scripts/domain/BeatmapDifficulty";
import {
    LOCAL_LEADERBOARD_KEY,
    LocalLeaderboard,
    LocalLeaderboardStorage
} from "../assets/scripts/domain/LocalLeaderboard";
import {
    beatmapNoteCount,
    createSongRunSessionConfig,
    createSongSessionConfig,
    FIRST_DANCE_DURATION_MS,
    isKnownSongAnimationProfile,
    SONG_CATALOG,
    SONG_ANIMATION_PROFILES,
    SECOND_DANCE_DURATION_MS,
    selectSongAnimationProfile,
    SongAnimationProfile,
    maximumSongScore,
    passingSongScore,
    resolveSongOutcome,
    wrappedSongIndex
} from "../assets/scripts/domain/SongCatalog";
import {
    DANCE_COMBO_DURATION_MS,
    GroupDanceFlow,
    SETTLEMENT_DISPLAY_DURATION_MS,
    SettlementFlow
} from "../assets/scripts/gameplay/GroupDanceFlow";
import { DEFAULT_JUDGE_WINDOWS, JudgeSystem } from "../assets/scripts/gameplay/JudgeSystem";
import { EngineAction, SequenceEngine } from "../assets/scripts/gameplay/SequenceEngine";
import { noteApproachProgress, timelineProgress } from "../assets/scripts/gameplay/TimingProgress";
import { PressedKeyState } from "../assets/scripts/input/PressedKeyState";
import { BuildaAdapter, calculateRightAvoidance } from "../assets/scripts/platform/BuildaAdapter";
import { SongClock } from "../assets/scripts/timing/SongClock";
import {
    calculateMenuCardVerticalLayout,
    calculateMenuFooterVerticalLayout,
    calculateMenuHintHorizontalLayout,
    calculateNoteChipVerticalLayout,
    calculateRhythmVerticalLayout,
    calculateSongListVerticalLayout,
    MenuCardVerticalLayout,
    MenuFooterVerticalLayout,
    RhythmVerticalLayout,
    shouldShowLandscapeRotation,
    shouldUseCompactMenuLayout
} from "../assets/scripts/ui/RhythmLayout";
import {
    canEnterGameplay,
    initialUiStartupState,
    markArtLoaded,
    markPlatformReady,
    startupStatusText
} from "../assets/scripts/ui/UiStartupState";
import {
    SongPreviewAudioPort,
    SongPreviewController
} from "../assets/scripts/ui/SongPreviewController";

declare const global: any;

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
        throw new Error(message + " (expected " + String(expected) + ", got " + String(actual) + ")");
    }
}

function near(actual: number, expected: number, tolerance: number, message: string): void {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(message + " (expected near " + expected + ", got " + actual + ")");
    }
}

function throws(action: () => void, message: string): void {
    let threw = false;
    try {
        action();
    } catch (_error) {
        threw = true;
    }
    equal(threw, true, message);
}

class MemoryLeaderboardStorage implements LocalLeaderboardStorage {
    private readonly values: { [key: string]: string } = {};
    public writeCount: number = 0;
    public lastWrittenKey: string = "";

    public getItem(key: string): string | null {
        return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
    }

    public setItem(key: string, value: string): void {
        this.values[key] = value;
        this.writeCount += 1;
        this.lastWrittenKey = key;
    }

    public seed(key: string, value: string): void {
        this.values[key] = value;
    }
}

function lastAction(actions: EngineAction[]): EngineAction {
    if (!actions.length) {
        throw new Error("Expected at least one engine action");
    }
    return actions[actions.length - 1];
}

function makeBeatmap(): Beatmap {
    return {
        id: "test",
        title: "Test",
        bpm: 100,
        beatOffsetMs: 0,
        groups: [
            {
                id: "one",
                notes: [
                    { id: "one-left", direction: "left", targetTimeMs: 1000 },
                    { id: "one-up", direction: "up", targetTimeMs: 1600 },
                    { id: "one-right", direction: "right", targetTimeMs: 2200 }
                ]
            },
            {
                id: "two",
                notes: [
                    { id: "two-down", direction: "down", targetTimeMs: 3400 },
                    { id: "two-left", direction: "left", targetTimeMs: 4000 },
                    { id: "two-right", direction: "right", targetTimeMs: 4600 }
                ]
            }
        ]
    };
}

function makeOneGroupBeatmap(): Beatmap {
    const beatmap = makeBeatmap();
    return {
        id: "one-group",
        title: beatmap.title,
        bpm: beatmap.bpm,
        beatOffsetMs: beatmap.beatOffsetMs,
        groups: [beatmap.groups[0]]
    };
}

function testJudgeBoundaries(): void {
    const judge = new JudgeSystem();
    equal(judge.judge(-50).grade, "Perfect", "Perfect early boundary is inclusive");
    equal(judge.judge(50).grade, "Perfect", "Perfect late boundary is inclusive");
    equal(judge.judge(50.001).grade, "Good", "Past Perfect enters Good");
    equal(judge.judge(-100).grade, "Good", "Good boundary is inclusive");
    equal(judge.judge(100).grade, "Good", "Good late boundary is inclusive");
    equal(judge.judge(100.001).grade, "Bad", "Past Good enters Bad");
    equal(judge.judge(-180).grade, "Bad", "Bad early boundary is inclusive");
    equal(judge.judge(180).grade, "Bad", "Bad boundary is inclusive");
    equal(judge.judge(-180.001).grade, "Miss", "Past Bad is Miss");
    equal(judge.judge(0).baseScore, 1000, "Perfect score is explicit");
    equal(judge.judge(75).baseScore, 700, "Good score is explicit");
    equal(judge.judge(150).baseScore, 350, "Bad score is explicit");
    equal(judge.judge(181).baseScore, 0, "Miss score is zero");
}

function testSongGridAndGroups(): void {
    equal(SONG_CATALOG.length, 3, "Catalog exposes exactly three playable song levels");
    equal(new Set(SONG_CATALOG.map((song) => song.beatmap)).size, 3, "Songs own independent beatmaps");
    const allNoteIds: string[] = [];
    SONG_CATALOG.forEach((song) => {
        const beatmap = song.beatmap;
        const beatDurationMs = 60000 / beatmap.bpm;
        const noteIds: string[] = [];
        let previousTarget = -1;
        equal(beatmap.groups.length, 8, song.id + " has eight deterministic groups");
        beatmap.groups.forEach((group, groupIndex) => {
            equal(
                group.notes.length >= 3 && group.notes.length <= 5,
                true,
                group.id + " has three to five notes"
            );
            group.notes.forEach((note, noteIndex) => {
                const halfBeatPosition = (note.targetTimeMs - beatmap.beatOffsetMs)
                    / beatDurationMs * 2;
                near(
                    halfBeatPosition,
                    Math.round(halfBeatPosition),
                    0.000001,
                    note.id + " lands on the analyzed offset/BPM half-beat grid"
                );
                equal(note.targetTimeMs > previousTarget, true, note.id + " is strictly time ordered");
                if (noteIndex > 0) {
                    const intervalBeats = (note.targetTimeMs
                        - group.notes[noteIndex - 1].targetTimeMs) / beatDurationMs;
                    near(
                        intervalBeats * 2,
                        Math.round(intervalBeats * 2),
                        0.000001,
                        note.id + " advances by an authored half or full beat"
                    );
                    equal(
                        intervalBeats >= 0.499999 && intervalBeats <= 1.000001,
                        true,
                        note.id + " interval stays playable"
                    );
                }
                previousTarget = note.targetTimeMs;
                noteIds.push(note.id);
                allNoteIds.push(note.id);
            });
            if (groupIndex > 0) {
                const previous = beatmap.groups[groupIndex - 1];
                const gap = group.notes[0].targetTimeMs
                    - previous.notes[previous.notes.length - 1].targetTimeMs;
                SONG_ANIMATION_PROFILES.forEach((profile) => {
                    const danceSegmentMs = profile.danceDurationMs / beatmap.groups.length;
                    equal(
                        gap >= danceSegmentMs + DEFAULT_JUDGE_WINDOWS.badMs * 2,
                        true,
                        song.id + "/" + profile.id
                            + " preserves the dance segment and both Bad-window margins"
                    );
                });
            }
        });
        const firstNote = beatmap.groups[0].notes[0];
        equal(
            firstNote.targetTimeMs >= 7000 && firstNote.targetTimeMs <= 8000,
            true,
            song.id + " begins its playable chart around 7–8 seconds"
        );
        equal(new Set(noteIds).size, noteIds.length, song.id + " note ids are unique");
    });
    equal(new Set(allNoteIds).size, allNoteIds.length, "Note ids are unique across the whole catalog");
}

function testSongCatalogAndGeneratedDifficulty(): void {
    equal(SONG_CATALOG.length, 3, "Song menu is driven by exactly three real tracks");
    equal(
        SONG_CATALOG.map((song) => song.id).join(","),
        "feng-wu-jiu-tian,zhu-zhu-xia,are-you-ok",
        "Song definitions retain their stable ids"
    );
    equal(
        SONG_CATALOG.map((song) => song.beatmap.title).join(","),
        "凤舞九天,猪猪侠,Are You OK",
        "Song definitions retain their stable titles"
    );
    equal(
        SONG_CATALOG.map((song) => song.artist).join(","),
        "凤舞九天,陈洁丽,雷军",
        "Catalog records the source artists"
    );
    equal(
        SONG_CATALOG.map((song) => song.audioPath).join(","),
        "audio/bgm/feng-wu-jiu-tian.mp3,audio/bgm/zhu-zhu-xia.mp3,audio/bgm/are-you-ok.mp3",
        "Each song maps to one Builda audio asset"
    );
    equal(
        SONG_CATALOG.every((song) => song.previewVolume > 0 && song.previewVolume <= 1
            && song.gameplayVolume > 0 && song.gameplayVolume <= 1),
        true,
        "Preview and gameplay volumes stay within the SDK contract"
    );
    equal(
        SONG_CATALOG.map((song) => beatmapNoteCount(song.beatmap)).join(","),
        "32,40,27",
        "Song rows expose generated note counts instead of design-sample text"
    );
    equal(
        SONG_CATALOG.every((song) => !Object.prototype.hasOwnProperty.call(song, "animation")),
        true,
        "Songs do not own fixed animation profiles"
    );
    equal(SONG_ANIMATION_PROFILES.length, 2, "Exactly two complete action groups are available");
    equal(
        SONG_ANIMATION_PROFILES.map((profile) => profile.id).join(","),
        "A,B",
        "Action groups retain stable ids"
    );
    equal(
        SONG_ANIMATION_PROFILES.map((profile) => profile.danceClip).join(","),
        "DanceCombo,DanceCombo2",
        "Action groups expose both dance clips"
    );
    equal(
        SONG_ANIMATION_PROFILES.map((profile) => profile.successResultClip).join(","),
        "ResultPose,ResultPose2",
        "Each dance remains paired with its matching success pose"
    );
    equal(
        SONG_ANIMATION_PROFILES.every((profile) => profile.failureResultClip === "ResultPose3"),
        true,
        "Both action groups share the failure pose"
    );

    const analyses = SONG_CATALOG.map((song) => analyzeBeatmapDifficulty(song.beatmap));
    equal(
        analyses.map((analysis) => analysis.stars).join(","),
        "2,3,1",
        "Difficulty stars come from the three authored chart densities"
    );
    equal(analyses[1].score > analyses[0].score, true, "The half-beat chart has the highest measured pressure");
    equal(analyses[0].score > analyses[2].score, true, "The mixed chart outranks the spacious chart");
    equal(
        analyses.every((analysis) => analysis.stars >= 1 && analysis.stars <= MAX_DIFFICULTY_STARS),
        true,
        "Generated difficulty stays inside the three-star UI scale"
    );

    const emptyAnalysis = analyzeBeatmapDifficulty({
        id: "empty",
        title: "Empty",
        bpm: 0,
        beatOffsetMs: 0,
        groups: []
    });
    equal(emptyAnalysis.stars, 1, "An empty or not-yet-generated chart safely displays one star");
    equal(emptyAnalysis.score, 0, "An empty chart has no synthetic difficulty pressure");
}

function testRandomAnimationProfileSelection(): void {
    equal(selectSongAnimationProfile(-5).id, "A", "Finite values below zero clamp to profile A");
    equal(selectSongAnimationProfile(0).id, "A", "The zero boundary selects profile A");
    equal(selectSongAnimationProfile(0.499999).id, "A", "Values below one half select profile A");
    equal(selectSongAnimationProfile(0.5).id, "B", "The half-open split assigns one half to profile B");
    equal(selectSongAnimationProfile(1).id, "B", "The upper boundary selects profile B");
    equal(selectSongAnimationProfile(5).id, "B", "Finite values above one clamp to profile B");
    equal(selectSongAnimationProfile(NaN).id, "A", "NaN deterministically falls back to profile A");
    equal(selectSongAnimationProfile(Infinity).id, "A", "Positive infinity falls back to profile A");
    equal(selectSongAnimationProfile(-Infinity).id, "A", "Negative infinity falls back to profile A");
    near(
        SONG_ANIMATION_PROFILES[0].danceDurationMs,
        FIRST_DANCE_DURATION_MS,
        0.000001,
        "Profile A uses the audited DanceCombo duration"
    );
    near(
        SONG_ANIMATION_PROFILES[1].danceDurationMs,
        SECOND_DANCE_DURATION_MS,
        0.000001,
        "Profile B uses the audited DanceCombo2 duration"
    );

    const mismatched: SongAnimationProfile = {
        id: "A",
        danceClip: "DanceCombo",
        successResultClip: "ResultPose2",
        failureResultClip: "ResultPose3",
        danceDurationMs: FIRST_DANCE_DURATION_MS
    };
    equal(isKnownSongAnimationProfile(mismatched), false, "A mismatched dance/success pair is rejected");
    throws(
        () => createSongSessionConfig(
            SONG_CATALOG[0],
            mismatched,
            DEFAULT_JUDGE_WINDOWS.badMs
        ),
        "Session creation rejects a mismatched action group"
    );
    throws(
        () => resolveSongOutcome(SONG_CATALOG[0], mismatched, 999999),
        "Outcome resolution rejects a mismatched success action"
    );

    SONG_CATALOG.forEach((song) => {
        const firstRun = createSongRunSessionConfig(
            song,
            DEFAULT_JUDGE_WINDOWS.badMs,
            0.25
        );
        const restartedRun = createSongRunSessionConfig(
            song,
            DEFAULT_JUDGE_WINDOWS.badMs,
            0.75
        );
        equal(firstRun.animationProfile.id, "A", song.id + " can start with profile A");
        equal(restartedRun.animationProfile.id, "B", song.id + " can restart with profile B");
        equal(firstRun.animationProfile.id, "A", song.id + " first run remains stable after restart creation");
    });
}

function testSongSessionConfigurations(): void {
    const sessions = SONG_CATALOG.map((song) => {
        return createSongSessionConfig(
            song,
            SONG_ANIMATION_PROFILES[0],
            DEFAULT_JUDGE_WINDOWS.badMs
        );
    });
    equal(
        sessions.map((session) => session.songId).join(","),
        "feng-wu-jiu-tian,zhu-zhu-xia,are-you-ok",
        "Session selection keeps the chosen song id"
    );
    equal(
        sessions.map((session) => session.title).join(","),
        "凤舞九天,猪猪侠,Are You OK",
        "Track UI receives the selected title from the session"
    );
    SONG_CATALOG.forEach((song) => {
        SONG_ANIMATION_PROFILES.forEach((profile) => {
            const session = createSongSessionConfig(
                song,
                profile,
                DEFAULT_JUDGE_WINDOWS.badMs
            );
            const label = song.id + "/" + profile.id;
            equal(session.animationProfile, profile, label + " stores the selected profile once");
            near(session.danceDurationMs, profile.danceDurationMs, 0.000001, label + " uses its profile duration");
            equal(session.groupCount, 8, label + " config drives eight groups");
            equal(session.noteCount, beatmapNoteCount(song.beatmap), label + " uses its chart count");
            equal(
                session.songDurationMs >= 50000 && session.songDurationMs <= 60000,
                true,
                label + " input timeline completes around 50–60 seconds"
            );
            equal(
                session.estimatedCompletionMs >= 50000 && session.estimatedCompletionMs <= 60000,
                true,
                label + " final dance also completes around 50–60 seconds"
            );
            equal(session.estimatedCompletionMs < session.audioDurationMs, true, label + " audio outlasts play");
            const engine = new SequenceEngine(session.beatmap, new JudgeSystem());
            engine.start();
            equal(engine.getSnapshot().groupCount, session.groupCount, label + " engine uses selected groups");
            equal(engine.getSnapshot().totalNoteCount, session.noteCount, label + " engine uses selected notes");
        });
    });
    equal(wrappedSongIndex(0, 1), 1, "Next wraps from the first song to the second");
    equal(wrappedSongIndex(1, 1), 2, "Next advances from the second song to the third");
    equal(wrappedSongIndex(2, 1), 0, "Next wraps from the third song to the first");
    equal(wrappedSongIndex(0, -1), 2, "Previous wraps from the first song to the third");
}

function testEverySongDanceFlowCoverage(): void {
    SONG_CATALOG.forEach((song) => {
        SONG_ANIMATION_PROFILES.forEach((profile) => {
            const session = createSongSessionConfig(song, profile, DEFAULT_JUDGE_WINDOWS.badMs);
            const flow = new GroupDanceFlow(session.groupCount, session.danceDurationMs);
            const label = song.id + "/" + profile.id;
            let previousEndMs = 0;
            for (let groupIndex = 0; groupIndex < session.groupCount; groupIndex += 1) {
                const segment = flow.beginGroupDance(groupIndex);
                near(segment.startMs, previousEndMs, 0.000001, label + " dance slices stay continuous");
                near(
                    segment.endMs,
                    session.danceDurationMs * (groupIndex + 1) / session.groupCount,
                    0.000001,
                    label + " dance slice reaches its configured boundary"
                );
                const transition = flow.update(segment.durationMs);
                if (!transition) {
                    throw new Error(label + " expected a transition at dance segment " + groupIndex);
                }
                equal(
                    transition.kind,
                    groupIndex === session.groupCount - 1 ? "result" : "next-group",
                    label + " transitions after each configured segment"
                );
                previousEndMs = segment.endMs;
            }
            near(
                previousEndMs,
                session.danceDurationMs,
                0.000001,
                label + " eight slices cover its animation exactly once"
            );
        });
    });
}

function testSongOutcomeBoundaries(): void {
    SONG_CATALOG.forEach((song) => {
        const maximum = beatmapNoteCount(song.beatmap) * 1000;
        const passing = Math.ceil(maximum * 0.6);
        equal(maximumSongScore(song), maximum, song.id + " maximum follows its Perfect note count");
        equal(passingSongScore(song), passing, song.id + " uses the rounded-up 60% passing line");
        SONG_ANIMATION_PROFILES.forEach((profile) => {
            const session = createSongSessionConfig(song, profile, DEFAULT_JUDGE_WINDOWS.badMs);
            const label = song.id + "/" + profile.id;
            const below = resolveSongOutcome(song, session.animationProfile, passing - 1);
            const boundary = resolveSongOutcome(song, session.animationProfile, passing);
            const perfect = resolveSongOutcome(song, session.animationProfile, maximum);
            equal(below.passed, false, label + " fails one point below the line");
            equal(below.resultClip, "ResultPose3", label + " failure uses the shared pose");
            equal(boundary.passed, true, label + " passes exactly on the line");
            equal(boundary.resultClip, profile.successResultClip, label + " uses its paired success pose");
            equal(boundary.animationProfileId, profile.id, label + " outcome retains the session profile");
            near(
                boundary.resultDurationMs,
                profile.id === "A" ? 12458.333015441895 : 18791.66603088379,
                0.000001,
                label + " settlement waits for the selected success pose"
            );
            near(
                below.resultDurationMs,
                3833.3332538604736,
                0.000001,
                label + " settlement waits for the shared failure pose"
            );
            equal(perfect.passed, true, label + " perfect score passes");
            equal(perfect.score, maximum, label + " perfect result keeps the actual score");
        });
    });
}

function testSettlementFlow(): void {
    const performanceDurationMs = 12458.333015441895;
    const flow = new SettlementFlow();
    equal(flow.getSnapshot().phase, "idle", "Settlement starts idle");

    const started = flow.begin(performanceDurationMs);
    equal(started.phase, "performance", "A completed chart starts the result performance");
    near(
        started.remainingMs,
        performanceDurationMs,
        0.000001,
        "The result performance exposes its full clip duration"
    );
    equal(
        flow.update(performanceDurationMs - 0.01),
        null,
        "The summary stays hidden until the result pose finishes"
    );
    const showSummary = flow.update(0.01);
    equal(showSummary && showSummary.kind, "show-summary", "The result pose opens the settlement card");
    equal(flow.getSnapshot().phase, "summary", "Settlement enters the readable summary phase");
    equal(
        flow.getSnapshot().remainingMs,
        SETTLEMENT_DISPLAY_DURATION_MS,
        "The summary receives its complete five-second display window"
    );
    equal(
        flow.update(SETTLEMENT_DISPLAY_DURATION_MS - 1),
        null,
        "The menu does not return before the countdown completes"
    );
    const returnMenu = flow.update(1);
    equal(returnMenu && returnMenu.kind, "return-menu", "The completed countdown returns to the menu");
    equal(flow.getSnapshot().phase, "complete", "Settlement completes after requesting the menu");

    flow.reset();
    flow.begin(1000);
    const stalledFrame = flow.update(100000);
    equal(
        stalledFrame && stalledFrame.kind,
        "show-summary",
        "A large frame advances only to the summary boundary"
    );
    equal(
        flow.getSnapshot().remainingMs,
        SETTLEMENT_DISPLAY_DURATION_MS,
        "A stalled frame cannot skip the readable settlement card"
    );
}

class RecordingPreviewAudio implements SongPreviewAudioPort {
    public readonly plays: Array<{ path: string; loop: boolean; volume: number }> = [];
    public stopCount: number = 0;
    public playResult: boolean = true;
    public stopResult: boolean = true;

    public playBGM(path: string, loop: boolean = true, volume: number = 1): Promise<boolean> {
        this.plays.push({ path, loop, volume });
        return Promise.resolve(this.playResult);
    }

    public stopBGM(): Promise<boolean> {
        this.stopCount += 1;
        return Promise.resolve(this.stopResult);
    }
}

class DeferredPreviewAudio implements SongPreviewAudioPort {
    public readonly plays: Array<{ path: string; loop: boolean; volume: number }> = [];
    public stopCount: number = 0;
    private resolvePendingPlay: ((played: boolean) => void) | null = null;

    public playBGM(path: string, loop: boolean = true, volume: number = 1): Promise<boolean> {
        this.plays.push({ path, loop, volume });
        return new Promise<boolean>((resolve) => {
            this.resolvePendingPlay = resolve;
        });
    }

    public stopBGM(): Promise<boolean> {
        this.stopCount += 1;
        return Promise.resolve(true);
    }

    public settlePlay(played: boolean): void {
        if (!this.resolvePendingPlay) {
            throw new Error("Expected one in-flight host play call");
        }
        const resolve = this.resolvePendingPlay;
        this.resolvePendingPlay = null;
        resolve(played);
    }
}

async function testSongPreviewControllerSerialization(): Promise<void> {
    const audio = new RecordingPreviewAudio();
    const controller = new SongPreviewController(audio);
    const firstSong = SONG_CATALOG[0];
    const secondSong = SONG_CATALOG[1];

    const firstStart = controller.toggle(firstSong.id, firstSong.audioPath, 3);
    equal(controller.getSnapshot().phase, "starting", "A play tap immediately exposes loading state");
    const firstPlaying = await firstStart;
    equal(firstPlaying.phase, "playing", "A successful host call exposes playing state");
    equal(audio.plays[0].path, firstSong.audioPath, "The controller forwards the catalog path");
    equal(audio.plays[0].loop, true, "Song previews loop through the host BGM channel");
    equal(audio.plays[0].volume, 1, "Out-of-range preview volume is clamped before SDK use");

    const firstStop = controller.toggle(firstSong.id, firstSong.audioPath, firstSong.previewVolume);
    equal(controller.getSnapshot().phase, "stopping", "A second tap immediately exposes pause state");
    equal((await firstStop).phase, "idle", "A second tap stops the active preview");

    const gameplay = await controller.play(
        firstSong.id,
        firstSong.audioPath,
        false,
        firstSong.gameplayVolume
    );
    equal(gameplay.phase, "playing", "Gameplay owns the same serialized BGM channel");
    equal(gameplay.loop, false, "Gameplay snapshot records non-looping playback");
    equal(audio.plays[audio.plays.length - 1].loop, false, "Gameplay BGM is explicitly non-looping");
    await controller.stop();

    const switchedAudio = new RecordingPreviewAudio();
    const switched = new SongPreviewController(switchedAudio);
    const staleStart = switched.toggle(firstSong.id, firstSong.audioPath, firstSong.previewVolume);
    const latestStart = switched.toggle(secondSong.id, secondSong.audioPath, secondSong.previewVolume);
    await Promise.all([staleStart, latestStart]);
    equal(switchedAudio.plays.length, 1, "A rapid song switch never starts the stale queued preview");
    equal(switchedAudio.plays[0].path, secondSong.audioPath, "A rapid switch starts only the latest selection");
    equal(switched.getSnapshot().songId, secondSong.id, "The latest song owns the playing snapshot");
    equal(switched.getSnapshot().phase, "playing", "The latest song reaches playing state");

    const cancelledAudio = new RecordingPreviewAudio();
    const cancelled = new SongPreviewController(cancelledAudio);
    const pendingStart = cancelled.play(firstSong.id, firstSong.audioPath, false, firstSong.gameplayVolume);
    const pendingStop = cancelled.stop();
    await Promise.all([pendingStart, pendingStop]);
    equal(cancelledAudio.plays.length, 0, "Gameplay start then cancel cannot leak stale audio");
    equal(cancelled.getSnapshot().phase, "idle", "A cancelled startup settles to idle");

    const inFlightAudio = new DeferredPreviewAudio();
    const inFlight = new SongPreviewController(inFlightAudio);
    const inFlightStart = inFlight.play(
        firstSong.id,
        firstSong.audioPath,
        false,
        firstSong.gameplayVolume
    );
    for (let turn = 0; turn < 8 && inFlightAudio.plays.length === 0; turn += 1) {
        await Promise.resolve();
    }
    equal(inFlightAudio.plays.length, 1, "Fixture reaches an in-flight asynchronous host play");
    const inFlightStop = inFlight.stop();
    inFlightAudio.settlePlay(true);
    await Promise.all([inFlightStart, inFlightStop]);
    equal(inFlight.getSnapshot().phase, "idle", "Cancelling an in-flight start returns to idle");
    equal(inFlightAudio.stopCount, 3, "A late successful play is stopped before the cancel boundary settles");

    const unavailableAudio = new RecordingPreviewAudio();
    unavailableAudio.playResult = false;
    const unavailable = new SongPreviewController(unavailableAudio);
    const unavailableSnapshot = await unavailable.toggle(
        firstSong.id,
        firstSong.audioPath,
        firstSong.previewVolume
    );
    equal(unavailableSnapshot.phase, "idle", "A rejected host audio call returns to idle");
    equal(unavailableSnapshot.available, false, "A rejected host audio call remains visible to the UI");

    const rejectedStopAudio = new RecordingPreviewAudio();
    const rejectedStop = new SongPreviewController(rejectedStopAudio);
    await rejectedStop.toggle(firstSong.id, firstSong.audioPath, firstSong.previewVolume);
    rejectedStopAudio.stopResult = false;
    const rejectedStopSnapshot = await rejectedStop.stop();
    equal(rejectedStopSnapshot.phase, "idle", "A rejected stop cannot leave a stale Pause state");
    equal(rejectedStopSnapshot.songId, null, "A rejected stop clears stale song ownership");
    equal(rejectedStopSnapshot.available, false, "A rejected stop remains visible as unavailable");
}

function testTooEarlyAndWrongDirectionBoundary(): void {
    const engine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    engine.start();
    const tooEarly = lastAction(engine.inputDirection("right", 819.999));
    equal(tooEarly.kind, "tooEarly", "Input before the Bad window only asks the player to wait");
    equal(engine.getSnapshot().settledNoteCount, 0, "Too-early input does not consume the current note");

    const wrongAtBoundary = lastAction(engine.inputDirection("right", 820));
    equal(wrongAtBoundary.kind, "missed", "Wrong direction at the inclusive window boundary is Miss");
    equal(wrongAtBoundary.reason, "wrong-direction", "Wrong direction reports its cause");
    equal(wrongAtBoundary.judgement && wrongAtBoundary.judgement.grade, "Miss", "Wrong direction has one of four grades");
    equal(engine.getSnapshot().noteIndex, 1, "Wrong direction advances exactly one note");
}

function testPerNoteScoresComboAndGroupAdvance(): void {
    const engine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    engine.start();
    equal(lastAction(engine.inputDirection("left", 1000)).judgement!.grade, "Perfect", "First note is Perfect");
    equal(lastAction(engine.inputDirection("up", 1660)).judgement!.grade, "Good", "Second note is Good");
    const third = lastAction(engine.inputDirection("right", 2350));
    equal(third.judgement!.grade, "Bad", "Third note is Bad");
    equal(third.groupCompleted, true, "Last note completes its group");

    const snapshot = engine.getSnapshot();
    equal(snapshot.score, 2050, "Score is the clear sum of 1000 + 700 + 350");
    equal(snapshot.combo, 3, "Combo increments per successful note");
    equal(snapshot.maxCombo, 3, "Max combo tracks per-note combo");
    equal(snapshot.groupIndex, 1, "Completed group automatically advances");
    equal(snapshot.noteIndex, 0, "Next group starts at its first note");
    equal(engine.getGroupStatus(0)!.completed, true, "Completed group retains all note results");
    equal(engine.getGroupStatus(1)!.notes[0].current, true, "Next group's first note becomes current");
}

function testOnlyEarliestNoteCanSettle(): void {
    const engine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    engine.start();
    const wrongForFirst = lastAction(engine.inputDirection("up", 1000));
    equal(wrongForFirst.kind, "missed", "A later note's direction cannot skip the earliest note");
    equal(wrongForFirst.noteIndex, 0, "The earliest note is the one that fails");
    equal(engine.getSnapshot().noteIndex, 1, "Only one note is consumed");

    const second = lastAction(engine.inputDirection("up", 1600));
    equal(second.kind, "judged", "The same direction can settle the second note at its own time");
    equal(second.noteIndex, 1, "The second note now settles");
}

function testLateBoundaryAndAutomaticFailure(): void {
    const boundaryEngine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    boundaryEngine.start();
    equal(boundaryEngine.update(1180).length, 0, "Exact late Bad boundary remains playable");
    equal(lastAction(boundaryEngine.inputDirection("left", 1180)).judgement!.grade, "Bad", "Late boundary is Bad");

    const expiredEngine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    expiredEngine.start();
    const expired = expiredEngine.update(1180.001);
    equal(expired.length, 1, "Past the late boundary automatically fails one note");
    equal(expired[0].kind, "missed", "Automatic failure is a Miss action");
    equal(expired[0].reason, "expired", "Automatic failure reports expiry");

    const catchUpEngine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    catchUpEngine.start();
    const catchUp = catchUpEngine.inputDirection("up", 1600);
    equal(catchUp.length, 2, "One input can first expire an old note then judge the new earliest note");
    equal(catchUp[0].reason, "expired", "Old earliest note expires first");
    equal(catchUp[1].judgement!.grade, "Perfect", "Direction input still reaches the next eligible note");
}

function testCatchUpStopsAtGroupBoundary(): void {
    const updateEngine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    updateEngine.start();
    const firstGroup = updateEngine.update(10000);
    equal(firstGroup.length, 3, "One update settles only the overdue notes in the current group");
    equal(firstGroup[2].groupCompleted, true, "Catch-up reports the current group boundary");
    equal(updateEngine.getSnapshot().groupIndex, 1, "Catch-up advances to the next group");
    equal(updateEngine.getSnapshot().noteIndex, 0, "Catch-up leaves the next group's first note untouched");
    equal(updateEngine.getSnapshot().settledNoteCount, 3, "Catch-up cannot auto-Miss across a group boundary");

    const inputEngine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    inputEngine.start();
    const boundaryInput = inputEngine.inputDirection("down", 3400);
    equal(boundaryInput.length, 3, "An input first catches up only the completed old group");
    equal(boundaryInput[2].groupCompleted, true, "The caught-up input exposes the group boundary");
    equal(inputEngine.getSnapshot().noteIndex, 0, "The same key cannot settle the next group's first note");
    equal(inputEngine.getSnapshot().settledNoteCount, 3, "Boundary input consumes no next-group note");
    const nextInput = lastAction(inputEngine.inputDirection("down", 3400));
    equal(nextInput.judgement!.grade, "Perfect", "A later input can judge the revealed next group normally");
}

function testGroupDanceFlowSegments(): void {
    const flow = new GroupDanceFlow(FENG_WU_JIU_TIAN_BEATMAP.groups.length);
    const segmentDurationMs = DANCE_COMBO_DURATION_MS / FENG_WU_JIU_TIAN_BEATMAP.groups.length;
    let previousEndMs = 0;

    for (let groupIndex = 0; groupIndex < FENG_WU_JIU_TIAN_BEATMAP.groups.length; groupIndex += 1) {
        const segment = flow.beginGroupDance(groupIndex);
        near(segment.startMs, previousEndMs, 0.000001, "Dance slices are continuous at group " + groupIndex);
        near(
            segment.endMs,
            DANCE_COMBO_DURATION_MS * (groupIndex + 1) / FENG_WU_JIU_TIAN_BEATMAP.groups.length,
            0.000001,
            "Dance slice uses its matching eighth"
        );
        near(segment.durationMs, segmentDurationMs, 0.000001, "Every group owns one eighth of DanceCombo");
        equal(flow.getSnapshot().inputLocked, true, "Dance phase locks note input");
        equal(flow.update(segment.durationMs - 0.01), null, "A dance slice does not finish before its boundary");
        equal(flow.getSnapshot().phase, "dance", "The next group remains hidden within the dance slice");
        const transition = flow.update(0.01);
        if (!transition) {
            throw new Error("Expected a dance transition at the exact segment boundary");
        }
        if (groupIndex < FENG_WU_JIU_TIAN_BEATMAP.groups.length - 1) {
            equal(transition.kind, "next-group", "A non-final dance returns to input");
            equal(flow.getSnapshot().phase, "input", "Non-final boundary reveals the next input phase");
            equal(flow.getSnapshot().inputLocked, false, "Non-final boundary unlocks input");
        } else {
            equal(transition.kind, "result", "Only the eighth dance enters result");
            equal(flow.getSnapshot().phase, "result", "Final dance boundary enters result phase");
            equal(flow.getSnapshot().inputLocked, true, "Result keeps note input locked");
        }
        previousEndMs = segment.endMs;
    }
    near(previousEndMs, DANCE_COMBO_DURATION_MS, 0.000001, "Eight slices cover DanceCombo exactly once");

    flow.reset();
    const first = flow.beginGroupDance(0);
    const overshoot = flow.update(first.durationMs * 10);
    equal(overshoot && overshoot.kind, "next-group", "Large dt finishes at most the active dance slice");
    equal(flow.getSnapshot().phase, "input", "Overshoot cannot skip the next input phase");
    flow.beginGroupDance(1);
    flow.update(125);
    const pausedElapsed = flow.getSnapshot().segment!.elapsedMs;
    flow.update(0);
    equal(flow.getSnapshot().segment!.elapsedMs, pausedElapsed, "No update means host pause consumes no dance time");
    flow.reset();
    equal(flow.getSnapshot().phase, "input", "Restart or home cancels an old dance slice");
    equal(flow.update(first.durationMs), null, "A cancelled slice cannot fire a stale transition");
}

function testDanceFlowKeepsContinuousSongClock(): void {
    let now = 0;
    const clock = new SongClock(() => now);
    const beatmap = FENG_WU_JIU_TIAN_BEATMAP;
    const engine = new SequenceEngine(beatmap, new JudgeSystem());
    const flow = new GroupDanceFlow(beatmap.groups.length, DANCE_COMBO_DURATION_MS);
    clock.start();
    engine.start();

    const firstGroupNotes = beatmap.groups[0].notes;
    now = firstGroupNotes[0].targetTimeMs;
    let completed = lastAction(engine.inputDirection(firstGroupNotes[0].direction, clock.currentTimeMs()));
    for (let noteIndex = 1; noteIndex < firstGroupNotes.length; noteIndex += 1) {
        const note = firstGroupNotes[noteIndex];
        now = note.targetTimeMs;
        completed = lastAction(engine.inputDirection(note.direction, clock.currentTimeMs()));
    }
    equal(completed.groupCompleted, true, "Fixture completes its first input group");
    const segment = flow.beginGroupDance(completed.groupIndex);

    now += segment.durationMs;
    const transition = flow.update(segment.durationMs);
    equal(transition && transition.kind, "next-group", "Dance timer advances to the next group");
    near(clock.currentTimeMs(), now, 0.000001, "Dance wall time remains on the continuous song clock");
    equal(engine.update(clock.currentTimeMs()).length, 0, "Authored dance gap cannot auto-Miss a future note");
    equal(engine.getSnapshot().noteIndex, 0, "The next group's first note remains pending after dance");
    const nextNote = beatmap.groups[1].notes[0];
    equal(
        clock.currentTimeMs() <= nextNote.targetTimeMs - DEFAULT_JUDGE_WINDOWS.badMs,
        true,
        "Dance ends before the next note's complete Bad window"
    );
    now = nextNote.targetTimeMs;
    equal(
        lastAction(engine.inputDirection(nextNote.direction, clock.currentTimeMs())).judgement!.grade,
        "Perfect",
        "The next group remains synchronized to the uninterrupted song"
    );
}

function testLocalLeaderboardOrdering(): void {
    const leaderboard = new LocalLeaderboard(null);
    leaderboard.record({ score: 100, maxCombo: 99, completedAt: 1 });
    leaderboard.record({ score: 200, maxCombo: 1, completedAt: 5000 });
    leaderboard.record({ score: 200, maxCombo: 2, completedAt: 5000 });
    leaderboard.record({ score: 200, maxCombo: 2, completedAt: 1000 });
    leaderboard.record({ score: 200, maxCombo: 2, completedAt: 1000 });

    const snapshot = leaderboard.getSnapshot();
    equal(
        snapshot.entries.map((entry) => entry.order).join(","),
        "4,5,3,2,1",
        "Local ranking sorts by score, combo, earlier completion, then stable order"
    );
    equal(snapshot.latest!.rank, 2, "Stable order gives the later identical result the second tied rank");
    equal(snapshot.latest!.retained, true, "A top-ten latest result remains in the ranking");
    equal(
        snapshot.persistenceIssue,
        "storage-unavailable",
        "Missing storage is explicit while the in-memory ranking remains usable"
    );
}

function testLocalLeaderboardTopTenTruncation(): void {
    const storage = new MemoryLeaderboardStorage();
    const leaderboard = new LocalLeaderboard(storage);
    for (let index = 0; index < 10; index += 1) {
        leaderboard.record({ score: 100 - index, maxCombo: index, completedAt: 1000 + index });
    }
    const outside = leaderboard.record({ score: 0, maxCombo: 0, completedAt: 2000 });
    const secondOutside = leaderboard.record({ score: 1, maxCombo: 0, completedAt: 2001 });
    const snapshot = leaderboard.getSnapshot();

    equal(snapshot.entries.length, 10, "Local ranking retains exactly ten entries");
    equal(snapshot.entries[0].score, 100, "Truncation preserves the highest score");
    equal(snapshot.entries[9].score, 91, "Truncation preserves the tenth score");
    equal(outside.rank, null, "An unretained result exposes no false exact rank");
    equal(outside.retained, false, "The eleventh result is not retained in the top ten");
    equal(secondOutside.rank, null, "Repeated unretained results still expose no exact rank");
    equal(secondOutside.retained, false, "Repeated low results remain outside the top ten");
    equal(snapshot.latest!.entry.score, 1, "Latest completion summary survives outside the top ten");

    const reloaded = new LocalLeaderboard(storage).getSnapshot();
    equal(reloaded.entries.length, 10, "Reload keeps the persisted table truncated to ten entries");
    equal(reloaded.latest!.rank, null, "Reload does not invent an unretained latest result's rank");
    equal(reloaded.latest!.retained, false, "Reload keeps the latest result outside the retained table");
}

function testLocalLeaderboardPersistenceAndReload(): void {
    const storage = new MemoryLeaderboardStorage();
    const oldKey = "local_leaderboard_v1";
    storage.seed(oldKey, "legacy-data-must-remain-untouched");
    const leaderboard = new LocalLeaderboard(storage);
    leaderboard.record({ score: 500, maxCombo: 3, completedAt: 2000 });
    leaderboard.record({ score: 750, maxCombo: 4, completedAt: 3000 });

    equal(
        LOCAL_LEADERBOARD_KEY,
        "hortor_gamejam26_local_leaderboard_v1",
        "Leaderboard uses the fixed project-scoped safe storage key"
    );
    equal(
        /^[A-Za-z0-9_-]{1,64}$/.test(LOCAL_LEADERBOARD_KEY),
        true,
        "Project-scoped storage key stays within the safe identifier contract"
    );
    equal(storage.lastWrittenKey, LOCAL_LEADERBOARD_KEY, "Leaderboard writes only the project-scoped storage key");
    equal(
        storage.getItem(oldKey),
        "legacy-data-must-remain-untouched",
        "The unreleased generic key is not migrated or deleted"
    );
    const raw = storage.getItem(LOCAL_LEADERBOARD_KEY);
    if (!raw) {
        throw new Error("Expected persisted local leaderboard JSON");
    }
    const payload = JSON.parse(raw);
    equal(payload.entries[0].score, 750, "Persisted entry keeps score");
    equal(payload.entries[0].maxCombo, 4, "Persisted entry keeps max combo");
    equal(payload.entries[0].completedAt, 3000, "Persisted entry keeps completion time");
    equal(payload.entries[0].order, 2, "Persisted entry keeps stable order");

    const reloaded = new LocalLeaderboard(storage);
    const snapshot = reloaded.getSnapshot();
    equal(snapshot.persistenceIssue, null, "Valid persisted data reloads without a warning");
    equal(snapshot.entries.map((entry) => entry.score).join(","), "750,500", "Reload restores sorted entries");
    equal(snapshot.latest!.entry.order, 2, "Reload restores the latest completed run");
    equal(snapshot.latest!.rank, 1, "Reload restores the latest completed run's rank");

    const continued = reloaded.record({ score: 600, maxCombo: 8, completedAt: 4000 });
    equal(continued.entry.order, 3, "Reload continues the stable order sequence");
    equal(continued.rank, 2, "Reloaded entries participate in later ranking");
    equal(storage.writeCount, 3, "Each complete result produces one storage write");
}

function testLocalLeaderboardMalformedJsonRecovery(): void {
    const storage = new MemoryLeaderboardStorage();
    storage.seed(LOCAL_LEADERBOARD_KEY, "{not-json");
    const leaderboard = new LocalLeaderboard(storage);
    equal(
        leaderboard.getSnapshot().persistenceIssue,
        "storage-data-corrupt",
        "Malformed leaderboard JSON switches to explicit memory-only mode"
    );
    leaderboard.record({ score: 321, maxCombo: 2, completedAt: 1234 });
    equal(leaderboard.getSnapshot().entries[0].score, 321, "Malformed JSON cannot block session ranking");
    equal(storage.getItem(LOCAL_LEADERBOARD_KEY), "{not-json", "Corrupt stored bytes are not silently overwritten");
}

function testLocalLeaderboardInvalidDataRecovery(): void {
    const storage = new MemoryLeaderboardStorage();
    storage.seed(LOCAL_LEADERBOARD_KEY, JSON.stringify({
        version: 1,
        nextOrder: 2,
        entries: [{ score: -1, maxCombo: 2, completedAt: 1000, order: 1 }],
        latestCompleted: null
    }));
    const leaderboard = new LocalLeaderboard(storage);
    equal(
        leaderboard.getSnapshot().persistenceIssue,
        "storage-data-corrupt",
        "Invalid leaderboard fields switch to explicit memory-only mode"
    );
    leaderboard.record({ score: 222, maxCombo: 1, completedAt: 2000 });
    equal(leaderboard.getSnapshot().entries.length, 1, "Invalid stored fields recover to a clean session ranking");
}

function testLocalLeaderboardStorageExceptionFallback(): void {
    const readFailure: LocalLeaderboardStorage = {
        getItem: () => {
            throw new Error("read denied");
        },
        setItem: () => {
            throw new Error("unexpected write");
        }
    };
    const readFallback = new LocalLeaderboard(readFailure);
    readFallback.record({ score: 100, maxCombo: 1, completedAt: 1000 });
    equal(
        readFallback.getSnapshot().persistenceIssue,
        "storage-read-failed",
        "A storage read exception switches to memory-only mode"
    );
    equal(readFallback.getSnapshot().entries.length, 1, "Read failure cannot block session ranking");

    const writeFailure: LocalLeaderboardStorage = {
        getItem: () => null,
        setItem: () => {
            throw new Error("quota denied");
        }
    };
    const writeFallback = new LocalLeaderboard(writeFailure);
    writeFallback.record({ score: 200, maxCombo: 2, completedAt: 2000 });
    writeFallback.record({ score: 300, maxCombo: 3, completedAt: 3000 });
    const snapshot = writeFallback.getSnapshot();
    equal(snapshot.persistenceIssue, "storage-write-failed", "A storage write exception is explicit");
    equal(snapshot.entries.length, 2, "Write failure cannot block later session results");
    equal(snapshot.entries[0].score, 300, "Memory-only fallback keeps sorting later session results");
}

function testMissBreaksCombo(): void {
    const engine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    engine.start();
    engine.inputDirection("left", 1000);
    equal(engine.getSnapshot().combo, 1, "Successful note starts combo");
    const miss = lastAction(engine.inputDirection("down", 1600));
    equal(miss.judgement!.grade, "Miss", "Wrong second direction fails");
    equal(engine.getSnapshot().combo, 0, "Miss breaks combo");
    equal(engine.getSnapshot().mistakes, 1, "Miss increments failure count");
}

function testFinalTimeoutStillCompletes(): void {
    const engine = new SequenceEngine(makeOneGroupBeatmap(), new JudgeSystem());
    engine.start();
    engine.inputDirection("left", 1000);
    engine.inputDirection("up", 1600);
    const finalActions = engine.update(2380.001);
    equal(finalActions.length, 1, "Final overdue note creates one action");
    equal(finalActions[0].kind, "missed", "Final overdue note remains a Miss result");
    equal(finalActions[0].finished, true, "Final Miss independently completes the beatmap");
    equal(finalActions[0].groupCompleted, true, "Final Miss completes its group");
    equal(engine.getSnapshot().finished, true, "Engine reaches COMPLETE after final Miss");
    equal(engine.getGroupStatus(0)!.notes[2].judgement!.grade, "Miss", "Final chip persists its Miss state");

    const wrongEngine = new SequenceEngine(makeOneGroupBeatmap(), new JudgeSystem());
    wrongEngine.start();
    wrongEngine.inputDirection("left", 1000);
    wrongEngine.inputDirection("up", 1600);
    const finalWrong = lastAction(wrongEngine.inputDirection("left", 2200));
    equal(finalWrong.kind, "missed", "Wrong direction on the final note remains a Miss action");
    equal(finalWrong.reason, "wrong-direction", "Final wrong direction preserves its cause");
    equal(finalWrong.finished, true, "Final wrong direction still reaches COMPLETE");
}

function testRestart(): void {
    const engine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    engine.start();
    engine.inputDirection("left", 1000);
    engine.inputDirection("up", 1600);
    engine.restart();
    const state = engine.getSnapshot();
    equal(state.groupIndex, 0, "Restart returns to first group");
    equal(state.noteIndex, 0, "Restart returns to first note");
    equal(state.settledNoteCount, 0, "Restart clears settled note count");
    equal(state.score, 0, "Restart clears score");
    equal(state.combo, 0, "Restart clears combo");
    equal(state.running, true, "Restart starts the engine");
    equal(engine.getGroupStatus(0)!.notes[0].judgement, null, "Restart clears persistent chip results");
}

function testPressedKeyResetAfterFocusLoss(): void {
    const pressed = new PressedKeyState();
    equal(pressed.press(37), true, "First keydown is accepted");
    equal(pressed.press(37), false, "Repeated keydown is suppressed while held");
    pressed.reset();
    equal(pressed.press(37), true, "Reset allows the first keydown after focus returns");
    pressed.release(37);
    equal(pressed.press(37), true, "Normal keyup also releases the key");
}

function testTimelineAndSafeAreaMath(): void {
    equal(timelineProgress(-1, 1000), 0, "Song timeline clamps before zero");
    equal(timelineProgress(500, 1000), 0.5, "Song timeline reports whole-song progress");
    equal(timelineProgress(1200, 1000), 1, "Song timeline clamps after completion");
    equal(noteApproachProgress(-200, 1000, 1200, 180), 0, "Mini marker starts at approach horizon");
    equal(noteApproachProgress(1000, 1000, 1200, 180), 1200 / 1380, "Target tick uses the same mini-bar mapping");
    equal(noteApproachProgress(1180, 1000, 1200, 180), 1, "Mini marker reaches the late boundary");
    equal(calculateRightAvoidance(260, 10, 80), 278, "Larger right safe area wins over capsule");
    equal(calculateRightAvoidance(20, 10, 80), 108, "Larger capsule wins over right safe area");
}

function assertVerticalStack(layout: RhythmVerticalLayout, message: string): void {
    equal(layout.showTimelineBar, true, message + ": global timing bar remains visible");
    equal(
        layout.globalBlockBottom >= layout.buttonTop + 8,
        true,
        message + ": global judge block stays above the direction buttons"
    );
    equal(
        layout.panelBottom >= layout.globalBlockTop + 12,
        true,
        message + ": group panel stays above the global judge block"
    );
    equal(
        layout.panelTop <= layout.hudBottom - 12 + 0.001,
        true,
        message + ": group panel stays below the HUD boundary"
    );
    if (layout.showProgressLabel) {
        const progressBottom = layout.progressLabelY - layout.progressLabelHeight * 0.5;
        const timelineTop = layout.globalLineY + layout.timelineHalfHeight;
        equal(
            progressBottom >= timelineTop + layout.textTimelineGap - 0.001,
            true,
            message + ": progress text keeps its explicit gap above the timing bar"
        );
    }
    if (layout.showInstruction) {
        const instructionTop = layout.instructionLabelY + layout.instructionLabelHeight * 0.5;
        const timelineBottom = layout.globalLineY - layout.timelineHalfHeight;
        equal(
            instructionTop <= timelineBottom - layout.textTimelineGap + 0.001,
            true,
            message + ": instruction text keeps its explicit gap below the timing bar"
        );
    }
    if (layout.showStage) {
        const stageLowerExtent = layout.compact ? 22 : 28;
        equal(
            layout.stageBaseY - stageLowerExtent >= layout.panelTop + 8,
            true,
            message + ": visible stage lower edge keeps explicit clearance above the group panel"
        );
    }
}

function testSafeBottomVerticalLayout(): void {
    const normal = calculateRhythmVerticalLayout({
        viewportHeight: 720,
        safeTop: 0,
        safeBottom: 0,
        directionPadScale: 1
    });
    equal(normal.showProgressLabel, true, "Normal landscape keeps the progress label");
    equal(normal.showInstruction, true, "Normal landscape keeps the secondary instruction");
    equal(normal.showStage, true, "Normal landscape keeps the decorative stage");
    near(normal.panelY, -64, 0.001, "Normal landscape preserves the preferred panel position");
    near(normal.panelHeight, 174, 0.001, "Normal landscape preserves the full panel height");
    near(normal.buttonBottom, -346, 0.001, "Direction buttons keep a 14-unit bottom margin");
    assertVerticalStack(normal, "normal landscape");

    const bottomInset34 = calculateRhythmVerticalLayout({
        viewportHeight: 720,
        safeTop: 0,
        safeBottom: 34,
        directionPadScale: 1
    });
    equal(bottomInset34.showStage, true, "34-unit bottom inset keeps the stage when vertical room remains");
    near(bottomInset34.buttonBottom, -312, 0.001, "34-unit inset remains below full-height touch controls");
    assertVerticalStack(bottomInset34, "34-unit bottom inset");

    const scaledSafeArea = calculateRhythmVerticalLayout({
        viewportHeight: 720,
        safeTop: 81.2,
        safeBottom: 62.8,
        directionPadScale: 1
    });
    equal(scaledSafeArea.panelBottom > normal.panelBottom, true, "Scaled iOS inset moves the panel up");
    equal(scaledSafeArea.showStage, true, "Typical scaled safe area still keeps the stage");
    near(
        scaledSafeArea.buttonBottom,
        -360 + 62.8 + 14,
        0.001,
        "Scaled iOS inset remains below the touch controls"
    );
    assertVerticalStack(scaledSafeArea, "scaled 44/34 CSS-pixel safe area");

    const largeBottomInset = calculateRhythmVerticalLayout({
        viewportHeight: 720,
        safeTop: 81.2,
        safeBottom: 170,
        directionPadScale: 1
    });
    equal(largeBottomInset.showInstruction, false, "Large bottom inset hides secondary instructions first");
    equal(largeBottomInset.showStage, false, "Large opposing insets hide the non-critical stage");
    equal(largeBottomInset.showProgressLabel, true, "170-unit inset still keeps progress text");
    equal(largeBottomInset.panelHeight >= 118, true, "Large inset retains a usable note panel");
    near(
        largeBottomInset.buttonTop - largeBottomInset.buttonBottom,
        84,
        0.001,
        "Vertical pressure never shrinks the direction buttons"
    );
    assertVerticalStack(largeBottomInset, "large bottom inset");

    const extremeBottomInset = calculateRhythmVerticalLayout({
        viewportHeight: 720,
        safeTop: 81.2,
        safeBottom: 250,
        directionPadScale: 1
    });
    equal(extremeBottomInset.showInstruction, false, "Extreme inset keeps secondary instructions hidden");
    equal(extremeBottomInset.showStage, false, "Extreme inset keeps the non-critical stage hidden");
    equal(extremeBottomInset.showProgressLabel, false, "Extreme inset hides only the progress text next");
    equal(extremeBottomInset.showTimelineBar, true, "Extreme inset preserves the timing line and marker");
    equal(extremeBottomInset.safeInsetsClamped, true, "250-unit bottom inset is clamped before core panels collide");
    near(
        extremeBottomInset.safeBottomApplied,
        238.8,
        0.001,
        "Timing-panel padding leaves the last collision-free bottom inset explicit"
    );
    equal(extremeBottomInset.panelHeight >= 118, true, "Extreme inset retains the minimum note panel");
    near(
        extremeBottomInset.buttonTop - extremeBottomInset.buttonBottom,
        84,
        0.001,
        "Extreme inset retains full-height touch controls"
    );
    assertVerticalStack(extremeBottomInset, "extreme 250-unit bottom inset");

    const impossibleBottomInset = calculateRhythmVerticalLayout({
        viewportHeight: 720,
        safeTop: 81.2,
        safeBottom: 400,
        directionPadScale: 1
    });
    equal(impossibleBottomInset.safeInsetsClamped, true, "Physically impossible inset is explicitly clamped");
    near(
        impossibleBottomInset.safeBottomApplied,
        238.8,
        0.001,
        "Clamped layout exposes the last supported bottom inset"
    );
    equal(impossibleBottomInset.showProgressLabel, false, "Clamped core layout omits progress text");
    equal(impossibleBottomInset.panelHeight >= 118, true, "Clamped core layout retains the minimum panel");
    assertVerticalStack(impossibleBottomInset, "physically impossible bottom inset");

    const narrowLandscape = calculateRhythmVerticalLayout({
        viewportHeight: 540,
        safeTop: 60,
        safeBottom: 63,
        directionPadScale: 1
    });
    equal(narrowLandscape.showInstruction, false, "Narrow landscape removes secondary instructions");
    equal(narrowLandscape.showStage, false, "Narrow landscape hides the stage before crowding the panel");
    equal(narrowLandscape.panelHeight >= 118, true, "Narrow landscape preserves the supported note panel height");
    near(
        narrowLandscape.buttonTop - narrowLandscape.buttonBottom,
        84,
        0.001,
        "Narrow landscape keeps full touch height"
    );
    assertVerticalStack(narrowLandscape, "narrow landscape");

    const minimumChipHeight = 118 - 47;
    const chip = calculateNoteChipVerticalLayout(minimumChipHeight);
    const arrowBottom = chip.arrowY - chip.arrowBoxHeight * 0.5;
    const statusTop = chip.statusY + chip.statusBoxHeight * 0.5;
    const statusBottom = chip.statusY - chip.statusBoxHeight * 0.5;
    const miniBarTop = chip.miniBarY + chip.miniBarHalfHeight;
    const miniBarBottom = chip.miniBarY - chip.miniBarHalfHeight;
    equal(arrowBottom >= statusTop, true, "Minimum chip keeps arrow above persistent status text");
    equal(statusBottom >= miniBarTop + 2, true, "Minimum chip keeps status text above the mini timing bar");
    equal(
        miniBarBottom >= -minimumChipHeight * 0.5,
        true,
        "Minimum chip keeps the mini timing bar inside its card"
    );
}

function assertMenuFooterStack(layout: MenuFooterVerticalLayout, message: string): void {
    near(
        layout.statusBottom - layout.startButtonTop,
        layout.buttonStatusGap,
        0.001,
        message + ": status label keeps its explicit gap above the scaled start button"
    );
    equal(
        layout.statusBottom > layout.startButtonTop,
        true,
        message + ": status label never overlaps the start button"
    );
    near(
        layout.cardBottom - layout.statusTop,
        layout.statusCardGap,
        0.001,
        message + ": cards keep their explicit gap above the status label"
    );
    equal(
        layout.cardBottom > layout.statusTop,
        true,
        message + ": cards never overlap the status label"
    );
}

function testMenuFooterVerticalLayout(): void {
    const desktop = calculateMenuFooterVerticalLayout({
        viewportHeight: 720,
        safeBottom: 0,
        startButtonHeight: 145,
        startButtonScale: 0.76,
        showHint: true
    });
    assertMenuFooterStack(desktop, "1280x720 menu");
    equal(desktop.hintVisible, true, "1280x720 keeps the keyboard hint");

    const compact = calculateMenuFooterVerticalLayout({
        viewportHeight: 540,
        safeBottom: 0,
        startButtonHeight: 145,
        startButtonScale: 0.62,
        showHint: false
    });
    assertMenuFooterStack(compact, "960x540 menu");
    equal(compact.hintVisible, false, "960x540 hides the non-critical keyboard hint");
    near(compact.startButtonBottom, -258, 0.001, "Compact start button uses the bottom margin");

    const compactSafeArea = calculateMenuFooterVerticalLayout({
        viewportHeight: 540,
        safeBottom: 63,
        startButtonHeight: 145,
        startButtonScale: 0.5544,
        showHint: false
    });
    assertMenuFooterStack(compactSafeArea, "960x540 scaled safe-area menu");
    near(
        compactSafeArea.startButtonBottom,
        -195,
        0.001,
        "Compact start button remains above the bottom safe area"
    );
}

function testMenuHintHorizontalLayout(): void {
    const desktop = calculateMenuHintHorizontalLayout({ availableWidth: 620 });
    equal(desktop.arrowCenters.length, 4, "Menu hint allocates all four direction icons");
    near(
        desktop.textLeft - desktop.arrowsRight,
        desktop.groupGap,
        0.001,
        "Menu hint text starts after the explicit icon-group gap"
    );
    equal(desktop.arrowsRight < desktop.textLeft, true, "Menu hint icon and text bounds never overlap");
    equal(desktop.panelWidth <= 620, true, "Desktop menu hint remains within its available width");

    const narrow = calculateMenuHintHorizontalLayout({ availableWidth: 320 });
    equal(narrow.scale < 1, true, "Narrow menu hint scales both groups uniformly");
    equal(narrow.panelWidth <= 320, true, "Scaled menu hint remains within a narrow content width");
    equal(narrow.arrowsRight < narrow.textLeft, true, "Scaled menu hint preserves the icon/text gap");
}

function testLandscapeOrientationGuard(): void {
    equal(shouldShowLandscapeRotation(390, 844), true, "Portrait frames show the landscape guard");
    equal(shouldShowLandscapeRotation(844, 390), false, "Landscape frames keep the game visible");
    equal(shouldShowLandscapeRotation(540, 540), false, "Square frames do not oscillate orientation state");
}

interface MenuLayoutScenario {
    designViewport: { width: number; height: number };
    physicalFrame: { width: number; height: number };
    safeTop: number;
    safeBottom: number;
}

interface MenuLayoutScenarioResult {
    compact: boolean;
    footer: MenuFooterVerticalLayout;
    cards: MenuCardVerticalLayout;
}

function calculateMenuCardsForScenario(scenario: MenuLayoutScenario): MenuLayoutScenarioResult {
    const viewportWidth = scenario.designViewport.width;
    const viewportHeight = scenario.designViewport.height;
    const safeTop = scenario.safeTop;
    const safeBottom = scenario.safeBottom;
    const compact = shouldUseCompactMenuLayout(scenario.physicalFrame.height, viewportHeight);
    const safePressure = Math.min(1, (safeTop + safeBottom) / 150);
    const logoScale = compact ? 0.45 - safePressure * 0.15 : 0.62;
    const startScaleLimit = compact ? 0.62 - safePressure * 0.08 : 0.76;
    const startScale = Math.min(startScaleLimit, Math.max(0.52, (viewportWidth - 80) / 527));
    const footer = calculateMenuFooterVerticalLayout({
        viewportHeight,
        safeBottom,
        startButtonHeight: 145,
        startButtonScale: startScale,
        showHint: !compact
    });
    const logoBottom = viewportHeight * 0.5 - safeTop - 12 - 280 * logoScale;
    const panelAspect = 696 / 565;
    const preferredCardWidth = Math.min(310, viewportWidth * 0.28);
    const cards = calculateMenuCardVerticalLayout({
        logoBottom,
        cardBottom: footer.cardBottom,
        preferredCardHeight: preferredCardWidth / panelAspect,
        maximumCardHeight: compact ? 184 : 252
    });
    return { compact, footer, cards };
}

function assertVisibleMenuCards(layout: MenuCardVerticalLayout, message: string): void {
    equal(layout.visible, true, message + ": information cards remain visible");
    equal(
        layout.cardHeight >= layout.minimumReadableHeight,
        true,
        message + ": visible cards retain the readable minimum height"
    );
    equal(
        layout.cardTop !== null && layout.cardTop <= layout.maximumCardTop + 0.001,
        true,
        message + ": visible cards keep the explicit Logo gap"
    );
}

function assertHiddenMenuCards(layout: MenuCardVerticalLayout, message: string): void {
    equal(layout.visible, false, message + ": non-critical information cards are hidden");
    equal(layout.cardHeight, 0, message + ": hidden cards allocate no visible height");
    equal(layout.cardTop, null, message + ": hidden cards expose no misleading top edge");
    equal(
        layout.availableCardHeight < layout.minimumReadableHeight,
        true,
        message + ": hiding is caused by space below the readable threshold"
    );
}

function testMenuCardVisibilityLayout(): void {
    equal(
        shouldUseCompactMenuLayout(NaN, 720),
        false,
        "Invalid physical frame height falls back to the regular design viewport"
    );
    equal(
        shouldUseCompactMenuLayout(0, 540),
        true,
        "Unavailable physical frame height can fall back to a compact design viewport"
    );
    assertVisibleMenuCards(
        calculateMenuCardsForScenario({
            designViewport: { width: 1280, height: 720 },
            physicalFrame: { width: 1280, height: 720 },
            safeTop: 0,
            safeBottom: 0
        }).cards,
        "1280x720 normal menu"
    );
    assertVisibleMenuCards(
        calculateMenuCardsForScenario({
            designViewport: { width: 1280, height: 720 },
            physicalFrame: { width: 960, height: 540 },
            safeTop: 44,
            safeBottom: 34
        }).cards,
        "960x540 common Builda safe area"
    );
    assertHiddenMenuCards(
        calculateMenuCardsForScenario({
            designViewport: { width: 960, height: 540 },
            physicalFrame: { width: 960, height: 540 },
            safeTop: 70,
            safeBottom: 70
        }).cards,
        "960x540 70/70 safe area"
    );
    assertHiddenMenuCards(
        calculateMenuCardsForScenario({
            designViewport: { width: 960, height: 540 },
            physicalFrame: { width: 960, height: 540 },
            safeTop: 60,
            safeBottom: 63
        }).cards,
        "960x540 60/63 safe area"
    );
    assertHiddenMenuCards(
        calculateMenuCardsForScenario({
            designViewport: { width: 1280, height: 720 },
            physicalFrame: { width: 1280, height: 720 },
            safeTop: 81.2,
            safeBottom: 250
        }).cards,
        "1280x720 81.2/250 safe area"
    );
}

function testThreeSongRowLayout(): void {
    const commonSafeArea = calculateMenuCardsForScenario({
        designViewport: { width: 1280, height: 720 },
        physicalFrame: { width: 960, height: 540 },
        safeTop: 44,
        safeBottom: 34
    });
    const normal = calculateMenuCardsForScenario({
        designViewport: { width: 1280, height: 720 },
        physicalFrame: { width: 1280, height: 720 },
        safeTop: 0,
        safeBottom: 0
    });
    equal(commonSafeArea.compact, true, "Physical 960x540 frame selects compact menu density");
    equal(commonSafeArea.footer.hintVisible, false, "Compact physical frame hides the keyboard hint");
    equal(commonSafeArea.cards.visible, true, "Common 960x540 safe area keeps song selection visible");
    equal(commonSafeArea.cards.cardHeight, 184, "Common 960x540 frame preserves the compact card height");
    equal(normal.compact, false, "Physical 1280x720 frame keeps regular menu density");
    equal(normal.footer.hintVisible, true, "Regular physical frame keeps the keyboard hint");
    equal(normal.cards.visible, true, "Normal 1280x720 layout keeps song selection visible");
    near(normal.cards.cardHeight, 310 * 565 / 696, 0.001, "Normal card size remains unchanged");

    [commonSafeArea.cards.cardHeight, normal.cards.cardHeight].forEach((cardHeight) => {
        const layout = calculateSongListVerticalLayout(cardHeight, 3);
        equal(layout.rowCenters.length, 3, cardHeight + "px card allocates exactly three rows");
        equal(layout.rowHeight >= 30, true, cardHeight + "px card keeps rows clickable");
        const cardTop = cardHeight * 0.5;
        const cardBottom = -cardTop;
        const firstRowTop = layout.rowCenters[0] + layout.rowHeight * 0.5;
        equal(firstRowTop <= cardTop, true, cardHeight + "px first row stays inside the card");
        for (let index = 1; index < layout.rowCenters.length; index += 1) {
            const previousBottom = layout.rowCenters[index - 1] - layout.rowHeight * 0.5;
            const nextTop = layout.rowCenters[index] + layout.rowHeight * 0.5;
            equal(previousBottom > nextTop, true, cardHeight + "px rows stay separated");
        }
        const lastRowBottom = layout.rowCenters[2] - layout.rowHeight * 0.5;
        equal(
            lastRowBottom >= layout.statusTop + 5.999,
            true,
            cardHeight + "px third row does not overlap preview status text"
        );
        equal(lastRowBottom >= cardBottom, true, cardHeight + "px third row stays inside the card");
        equal(layout.statusBottom >= cardBottom, true, cardHeight + "px status stays inside the card");
        equal(layout.statusTop <= cardTop, true, cardHeight + "px status top stays inside the card");
    });
}

function testSongClockCalibrationAndPause(): void {
    let now = 100;
    const clock = new SongClock(() => now);
    clock.setCalibrationOffsetMs(20);
    clock.start();
    now = 350;
    equal(clock.currentTimeMs(), 270, "Clock uses monotonic provider plus calibration");
    now = 400;
    clock.pause();
    now = 1000;
    equal(clock.currentTimeMs(), 320, "Paused wall time is excluded");
    clock.resume();
    now = 1100;
    equal(clock.currentTimeMs(), 420, "Resume continues from paused song position");
    clock.restart();
    equal(clock.currentTimeMs(), 20, "Restart preserves calibration");
    clock.stop();
    equal(clock.isStarted(), false, "Stop clears a completed or cancelled song session");
    equal(clock.isPaused(), true, "Stopped clock cannot advance behind the menu");
    equal(clock.currentTimeMs(), 20, "Stopped fallback clock preserves only calibration");
}

type BrowserAudioPlayBehavior = () => Promise<void> | void;

const browserAudioInstances: BrowserAudioFixture[] = [];
const browserAudioPlayBehaviors: BrowserAudioPlayBehavior[] = [];

class BrowserAudioFixture {
    public src: string;
    public preload: string = "";
    public loop: boolean = false;
    public volume: number = 1;
    public currentTime: number = 0;
    public onerror: (() => void) | null = null;
    public onended: (() => void) | null = null;
    public playCount: number = 0;
    public pauseCount: number = 0;
    public loadCount: number = 0;

    public constructor(src: string = "") {
        this.src = src;
        browserAudioInstances.push(this);
    }

    public play(): Promise<void> | void {
        this.playCount += 1;
        const behavior = browserAudioPlayBehaviors.shift();
        return behavior ? behavior() : Promise.resolve();
    }

    public pause(): void {
        this.pauseCount += 1;
    }

    public removeAttribute(name: string): void {
        if (name === "src") {
            this.src = "";
        }
    }

    public load(): void {
        this.loadCount += 1;
    }
}

function resetBrowserAudioFixture(): void {
    browserAudioInstances.length = 0;
    browserAudioPlayBehaviors.length = 0;
}

async function testBuildaBrowserBgmFallback(): Promise<void> {
    const hadWindow = Object.prototype.hasOwnProperty.call(global, "window");
    const previousWindow = global.window;
    const hadDocument = Object.prototype.hasOwnProperty.call(global, "document");
    const previousDocument = global.document;
    const previousWarn = console.warn;
    const warnings: string[] = [];
    try {
        console.warn = (...args: any[]): void => {
            warnings.push(args.map((value) => String(value)).join(" "));
        };
        resetBrowserAudioFixture();
        global.document = { baseURI: "https://preview.example/games/rhythm/index.html" };
        global.window = {
            Audio: BrowserAudioFixture,
            location: { href: "https://preview.example/games/rhythm/index.html" }
        };

        const adapter = new BuildaAdapter();
        equal(
            await adapter.playBGM("audio/bgm/preview.mp3", true, 0.78),
            true,
            "A missing Builda audio host falls back to browser Audio for previews"
        );
        equal(browserAudioInstances.length, 1, "The first fallback play creates one browser BGM instance");
        equal(
            browserAudioInstances[0].src,
            "https://preview.example/games/rhythm/audio/bgm/preview.mp3",
            "The fallback resolves a hostless relative asset path against the page"
        );
        equal(browserAudioInstances[0].loop, true, "Preview fallback playback keeps loop=true");
        equal(browserAudioInstances[0].volume, 0.78, "Preview fallback playback keeps catalog volume");

        equal(
            await adapter.playBGM("audio/bgm/gameplay.mp3", false, 0.86),
            true,
            "Gameplay reuses the same fallback BGM port"
        );
        equal(browserAudioInstances.length, 2, "Switching tracks replaces rather than layers browser audio");
        equal(browserAudioInstances[0].pauseCount > 0, true, "Switching tracks pauses the previous fallback");
        equal(browserAudioInstances[1].loop, false, "Gameplay fallback playback keeps loop=false");
        equal(browserAudioInstances[1].volume, 0.86, "Gameplay fallback playback keeps catalog volume");
        equal(await adapter.stopBGM(), true, "Fallback stop succeeds for the active browser BGM");
        equal(browserAudioInstances[1].pauseCount > 0, true, "Fallback stop pauses the active instance");
        equal(await adapter.stopBGM(), true, "Fallback stop is idempotent after the BGM is clear");

        resetBrowserAudioFixture();
        let partialHostPlayCalls = 0;
        global.window.Builda = {
            audio: {
                playBGM: () => {
                    partialHostPlayCalls += 1;
                    return Promise.resolve({ ok: true, data: { available: true } });
                }
            },
            assets: {
                url: (path: string) => "https://assets.example/v42/" + path
            }
        };
        const assetAdapter = new BuildaAdapter();
        equal(
            await assetAdapter.playBGM("audio/bgm/host-assets.mp3", true, 0.5),
            true,
            "A Builda object without the complete audio interface still uses the browser fallback"
        );
        equal(
            browserAudioInstances[0].src,
            "https://assets.example/v42/audio/bgm/host-assets.mp3",
            "The browser fallback prefers Builda.assets.url when it is available"
        );
        equal(partialHostPlayCalls, 0, "An incomplete host BGM pair is never used without a matching stop method");
        await assetAdapter.stopBGM();

        resetBrowserAudioFixture();
        let resolveStalePlay: () => void = () => undefined;
        let resolveLatestPlay: () => void = () => undefined;
        browserAudioPlayBehaviors.push(
            () => new Promise<void>((resolve) => { resolveStalePlay = resolve; }),
            () => new Promise<void>((resolve) => { resolveLatestPlay = resolve; })
        );
        delete global.window.Builda;
        const switchingAdapter = new BuildaAdapter();
        const stalePlay = switchingAdapter.playBGM("audio/bgm/stale.mp3", true, 0.6);
        const latestPlay = switchingAdapter.playBGM("audio/bgm/latest.mp3", false, 0.7);
        resolveLatestPlay();
        equal(await latestPlay, true, "The latest fallback request owns the browser BGM channel");
        resolveStalePlay();
        equal(await stalePlay, false, "A late stale play completion cannot reclaim the BGM channel");
        equal(browserAudioInstances[0].pauseCount > 0, true, "A superseded pending Audio instance is stopped");
        equal(browserAudioInstances[1].pauseCount, 0, "A stale completion cannot stop the latest track");
        await switchingAdapter.stopBGM();

        resetBrowserAudioFixture();
        let resolveCancelledPlay: () => void = () => undefined;
        browserAudioPlayBehaviors.push(
            () => new Promise<void>((resolve) => { resolveCancelledPlay = resolve; })
        );
        const cancelledAdapter = new BuildaAdapter();
        const cancelledPlay = cancelledAdapter.playBGM("audio/bgm/cancelled.mp3", true, 0.5);
        equal(await cancelledAdapter.stopBGM(), true, "Stop invalidates an in-flight fallback start");
        resolveCancelledPlay();
        equal(await cancelledPlay, false, "A stopped fallback cannot become current after play resolves late");
        equal(browserAudioInstances[0].pauseCount > 0, true, "Stopping a pending fallback releases its instance");

        resetBrowserAudioFixture();
        browserAudioPlayBehaviors.push(() => Promise.reject(new Error("autoplay blocked")));
        const rejectedAdapter = new BuildaAdapter();
        equal(
            await rejectedAdapter.playBGM("audio/bgm/rejected.mp3", true, 0.5),
            false,
            "A rejected browser Audio.play Promise remains visible as unavailable"
        );
        equal(browserAudioInstances[0].pauseCount > 0, true, "A rejected fallback play releases its media instance");
        equal(warnings.some((warning) => warning.indexOf("browser BGM play failed") >= 0), true,
            "A current fallback rejection emits one diagnostic warning");

        resetBrowserAudioFixture();
        browserAudioPlayBehaviors.push(() => {
            throw new Error("synchronous play failure");
        });
        equal(
            await new BuildaAdapter().playBGM("audio/bgm/thrown.mp3", true, 0.5),
            false,
            "A synchronous browser Audio.play throw is contained"
        );
        equal(browserAudioInstances[0].pauseCount > 0, true, "A synchronously thrown play releases its instance");
        equal(warnings.some((warning) => warning.indexOf("browser BGM threw") >= 0), true,
            "A synchronous browser Audio failure emits one diagnostic warning");

        resetBrowserAudioFixture();
        global.window = { location: { href: "https://preview.example/index.html" } };
        equal(
            await new BuildaAdapter().playBGM("audio/bgm/unavailable.mp3", true, 1),
            false,
            "A browser without an Audio constructor reports fallback playback unavailable"
        );
    } finally {
        console.warn = previousWarn;
        if (hadDocument) {
            global.document = previousDocument;
        } else {
            delete global.document;
        }
        if (hadWindow) {
            global.window = previousWindow;
        } else {
            delete global.window;
        }
        resetBrowserAudioFixture();
    }
}

async function testBuildaAudioResultMapping(): Promise<void> {
    const hadWindow = Object.prototype.hasOwnProperty.call(global, "window");
    const previousWindow = global.window;
    let capturedSfxOptions: any = null;
    try {
        resetBrowserAudioFixture();
        global.window = {
            Audio: BrowserAudioFixture,
            Builda: {
                audio: {
                    playBGM: () => Promise.resolve({
                        ok: false,
                        error: { code: "AUDIO_FAILED", message: "fixture failure" }
                    }),
                    stopBGM: () => Promise.resolve({ ok: true, data: { available: true } }),
                    playSFX: (_path: string, options: any) => {
                        capturedSfxOptions = options;
                        return Promise.resolve({ ok: true, data: { available: true } });
                    }
                },
                runtime: {
                    quit: () => Promise.resolve({ ok: true, data: {} })
                }
            }
        };
        const hostedAdapter = new BuildaAdapter();
        equal(await hostedAdapter.playBGM("audio/bgm/fixture.ogg"), false, "Rejected SDK Result maps to false");
        equal(browserAudioInstances.length, 0, "A complete Builda audio host never double-plays through fallback Audio");
        equal(await hostedAdapter.stopBGM(), true, "Successful SDK Result maps to true");
        equal(await hostedAdapter.playSFX("audio/sfx/hit.ogg", "combo-hit", 0.5), true, "SFX Result maps to true");
        equal(capturedSfxOptions.sessionId, "combo-hit", "SFX session id uses SDK contract key");
        equal(Object.prototype.hasOwnProperty.call(capturedSfxOptions, "key"), false, "Legacy key is absent");
        equal(await hostedAdapter.openPlatformMenu(), true, "Platform menu maps a successful runtime.quit Result");

        delete global.window;
        equal(await new BuildaAdapter().playSFX("audio/sfx/hit.ogg"), false, "Missing host maps to false");
        equal(await new BuildaAdapter().openPlatformMenu(), false, "Missing host cannot open platform settings");
    } finally {
        if (hadWindow) {
            global.window = previousWindow;
        } else {
            delete global.window;
        }
    }
}

function waitForTimer(milliseconds: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function testBuildaReadyBoundedFallback(): Promise<void> {
    const hadWindow = Object.prototype.hasOwnProperty.call(global, "window");
    const previousWindow = global.window;
    const previousWarn = console.warn;
    const warnings: string[] = [];
    let hostReadyCalls = 0;
    let resolveLateHostReady: () => void = () => undefined;

    try {
        console.warn = (...args: any[]): void => {
            warnings.push(args.map((value) => String(value)).join(" "));
        };
        global.window = {
            Builda: {
                runtime: {
                    ready: () => {
                        hostReadyCalls += 1;
                        return new Promise<void>((resolve) => {
                            resolveLateHostReady = resolve;
                        });
                    }
                }
            }
        };

        let startup = initialUiStartupState();
        let adapterSettlements = 0;
        await new BuildaAdapter(5).ready().then(() => {
            adapterSettlements += 1;
            startup = markPlatformReady(startup);
        });
        equal(hostReadyCalls, 1, "A timed-out handshake calls runtime.ready exactly once");
        equal(adapterSettlements, 1, "A pending host Promise settles the adapter through its timeout once");
        equal(canEnterGameplay(startup), true, "GameBootstrap's ready continuation enables gameplay after timeout");
        equal(warnings.length, 1, "A timed-out handshake emits one compatibility warning");
        equal(warnings[0].indexOf("timed out after 5ms") >= 0, true, "Timeout warning reports the injected bound");

        resolveLateHostReady();
        await Promise.resolve();
        await Promise.resolve();
        equal(adapterSettlements, 1, "A late host resolve cannot settle the adapter twice");

        warnings.length = 0;
        global.window.Builda.runtime.ready = () => Promise.reject(new Error("fixture rejection"));
        await new BuildaAdapter(15).ready();
        await waitForTimer(30);
        equal(warnings.length, 1, "A rejected handshake emits one failure warning and clears its timer");
        equal(warnings[0].indexOf("runtime.ready failed") >= 0, true, "Rejected handshake uses fallback mode");

        warnings.length = 0;
        global.window.Builda.runtime.ready = () => {
            throw new Error("fixture throw");
        };
        await new BuildaAdapter(5).ready();
        equal(warnings.length, 1, "A thrown handshake emits one failure warning");
        equal(warnings[0].indexOf("runtime.ready threw") >= 0, true, "Thrown handshake uses fallback mode");
    } finally {
        console.warn = previousWarn;
        if (hadWindow) {
            global.window = previousWindow;
        } else {
            delete global.window;
        }
    }
}

function testUiStartupRaceAndFallback(): void {
    const initial = initialUiStartupState();
    equal(canEnterGameplay(initial), false, "Gameplay waits for the platform-ready boundary");
    equal(
        startupStatusText(initial),
        "降级菜单可用 · 正在连接创游世界与加载美术…",
        "The synchronous fallback menu is explicit while both tasks are pending"
    );

    const platformFirst = markPlatformReady(initial);
    equal(canEnterGameplay(platformFirst), true, "A hanging art callback never blocks playable startup");
    equal(
        startupStatusText(platformFirst),
        "准备就绪 · 美术加载中 · 可点击开始",
        "Platform readiness remains visible while art is still pending"
    );

    const platformThenMissing = markArtLoaded(platformFirst, 2);
    const artThenPlatform = markPlatformReady(markArtLoaded(initial, 2));
    equal(
        startupStatusText(platformThenMissing),
        startupStatusText(artThenPlatform),
        "Art/platform completion order converges to the same status"
    );
    equal(
        startupStatusText(artThenPlatform),
        "准备就绪 · 部分美术缺失，已启用降级界面",
        "Missing art cannot overwrite platform readiness with a connection error"
    );

    const artFirst = markArtLoaded(initial, 0);
    equal(
        startupStatusText(artFirst),
        "美术已就绪 · 正在连接创游世界…",
        "Art readiness does not pretend the platform is ready"
    );
    equal(
        startupStatusText(markPlatformReady(artFirst)),
        "准备就绪 · 点击开始跳舞",
        "Successful completion reports a playable menu"
    );
    equal(
        startupStatusText(markPlatformReady(artFirst), true),
        "准备就绪 · 点击开始跳舞 · 安全区受限，已隐藏信息卡",
        "Async readiness refresh preserves the safe-area card notice"
    );
}

async function run(): Promise<void> {
    testJudgeBoundaries();
    testSongGridAndGroups();
    testSongCatalogAndGeneratedDifficulty();
    testRandomAnimationProfileSelection();
    testSongSessionConfigurations();
    testEverySongDanceFlowCoverage();
    testSongOutcomeBoundaries();
    testSettlementFlow();
    testTooEarlyAndWrongDirectionBoundary();
    testPerNoteScoresComboAndGroupAdvance();
    testOnlyEarliestNoteCanSettle();
    testLateBoundaryAndAutomaticFailure();
    testCatchUpStopsAtGroupBoundary();
    testGroupDanceFlowSegments();
    testDanceFlowKeepsContinuousSongClock();
    testLocalLeaderboardOrdering();
    testLocalLeaderboardTopTenTruncation();
    testLocalLeaderboardPersistenceAndReload();
    testLocalLeaderboardMalformedJsonRecovery();
    testLocalLeaderboardInvalidDataRecovery();
    testLocalLeaderboardStorageExceptionFallback();
    testMissBreaksCombo();
    testFinalTimeoutStillCompletes();
    testRestart();
    testPressedKeyResetAfterFocusLoss();
    testTimelineAndSafeAreaMath();
    testSafeBottomVerticalLayout();
    testMenuFooterVerticalLayout();
    testMenuHintHorizontalLayout();
    testLandscapeOrientationGuard();
    testMenuCardVisibilityLayout();
    testThreeSongRowLayout();
    testSongClockCalibrationAndPause();
    testUiStartupRaceAndFallback();
    await testBuildaReadyBoundedFallback();
    await testBuildaAudioResultMapping();
    await testBuildaBrowserBgmFallback();
    await testSongPreviewControllerSerialization();
    console.log("logic-tests=passed cases=38");
}

run().catch((error) => {
    console.error(error);
    throw error;
});
