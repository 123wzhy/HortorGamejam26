import { Beatmap, DEMO_BEATMAP } from "../assets/scripts/domain/Beatmap";
import { analyzeBeatmapDifficulty, MAX_DIFFICULTY_STARS } from "../assets/scripts/domain/BeatmapDifficulty";
import {
    LOCAL_LEADERBOARD_KEY,
    LocalLeaderboard,
    LocalLeaderboardStorage
} from "../assets/scripts/domain/LocalLeaderboard";
import { beatmapNoteCount, DEMO_SONGS } from "../assets/scripts/domain/SongCatalog";
import {
    DANCE_COMBO_DURATION_MS,
    GroupDanceFlow
} from "../assets/scripts/gameplay/GroupDanceFlow";
import { JudgeSystem } from "../assets/scripts/gameplay/JudgeSystem";
import { EngineAction, SequenceEngine } from "../assets/scripts/gameplay/SequenceEngine";
import { noteApproachProgress, timelineProgress } from "../assets/scripts/gameplay/TimingProgress";
import { PressedKeyState } from "../assets/scripts/input/PressedKeyState";
import { BuildaAdapter, calculateRightAvoidance } from "../assets/scripts/platform/BuildaAdapter";
import { SongClock } from "../assets/scripts/timing/SongClock";
import {
    calculateMenuCardVerticalLayout,
    calculateMenuFooterVerticalLayout,
    calculateNoteChipVerticalLayout,
    calculateRhythmVerticalLayout,
    MenuCardVerticalLayout,
    MenuFooterVerticalLayout,
    RhythmVerticalLayout
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

function testDemoGridAndGroups(): void {
    const beatDurationMs = 60000 / DEMO_BEATMAP.bpm;
    let previousTarget = -1;
    equal(DEMO_BEATMAP.groups.length, 8, "Demo has eight deterministic groups");
    DEMO_BEATMAP.groups.forEach((group, groupIndex) => {
        equal(group.notes.length >= 3 && group.notes.length <= 5, true, group.id + " has three to five notes");
        group.notes.forEach((note) => {
            equal(note.targetTimeMs % beatDurationMs, 0, note.id + " lands on the BPM grid");
            equal(note.targetTimeMs > previousTarget, true, note.id + " is strictly time ordered");
            previousTarget = note.targetTimeMs;
        });
        if (groupIndex > 0) {
            const previous = DEMO_BEATMAP.groups[groupIndex - 1];
            const gap = group.notes[0].targetTimeMs - previous.notes[previous.notes.length - 1].targetTimeMs;
            equal(gap >= beatDurationMs * 2, true, group.id + " leaves at least one empty beat");
        }
    });
}

function testSongCatalogAndGeneratedDifficulty(): void {
    equal(DEMO_SONGS.length, 2, "Song menu is driven by exactly two Phase A definitions");
    equal(
        DEMO_SONGS.map((song) => song.id).join(","),
        "neon-grid-demo,golden-stampede-demo",
        "Song definitions retain their stable ids"
    );
    equal(
        DEMO_SONGS.map((song) => song.previewPath).join(","),
        "audio/bgm/neon-grid-demo-preview.wav,audio/bgm/golden-stampede-demo-preview.wav",
        "Each song maps to one Builda audio asset"
    );
    equal(
        DEMO_SONGS.every((song) => song.previewVolume > 0 && song.previewVolume <= 1),
        true,
        "Preview volumes stay within the SDK contract"
    );
    equal(
        DEMO_SONGS.map((song) => beatmapNoteCount(song.beatmap)).join(","),
        "31,31",
        "Song rows expose generated note counts instead of design-sample text"
    );

    const analyses = DEMO_SONGS.map((song) => analyzeBeatmapDifficulty(song.beatmap));
    equal(
        analyses.map((analysis) => analysis.stars).join(","),
        "2,3",
        "Difficulty analysis separates the 100 BPM and 120 BPM generated charts"
    );
    equal(analyses[1].score > analyses[0].score, true, "The denser faster chart has the higher measured score");
    equal(
        analyses.every((analysis) => analysis.stars >= 1 && analysis.stars <= MAX_DIFFICULTY_STARS),
        true,
        "Generated difficulty stays inside the three-star UI scale"
    );

    const emptyAnalysis = analyzeBeatmapDifficulty({
        id: "empty",
        title: "Empty",
        bpm: 0,
        groups: []
    });
    equal(emptyAnalysis.stars, 1, "An empty or not-yet-generated chart safely displays one star");
    equal(emptyAnalysis.score, 0, "An empty chart has no synthetic difficulty pressure");
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

async function testSongPreviewControllerSerialization(): Promise<void> {
    const audio = new RecordingPreviewAudio();
    const controller = new SongPreviewController(audio);
    const firstSong = DEMO_SONGS[0];
    const secondSong = DEMO_SONGS[1];

    const firstStart = controller.toggle(firstSong.id, firstSong.previewPath, 3);
    equal(controller.getSnapshot().phase, "starting", "A play tap immediately exposes loading state");
    const firstPlaying = await firstStart;
    equal(firstPlaying.phase, "playing", "A successful host call exposes playing state");
    equal(audio.plays[0].path, firstSong.previewPath, "The controller forwards the catalog path");
    equal(audio.plays[0].loop, true, "Song previews loop through the host BGM channel");
    equal(audio.plays[0].volume, 1, "Out-of-range preview volume is clamped before SDK use");

    const firstStop = controller.toggle(firstSong.id, firstSong.previewPath, firstSong.previewVolume);
    equal(controller.getSnapshot().phase, "stopping", "A second tap immediately exposes pause state");
    equal((await firstStop).phase, "idle", "A second tap stops the active preview");

    const switchedAudio = new RecordingPreviewAudio();
    const switched = new SongPreviewController(switchedAudio);
    const staleStart = switched.toggle(firstSong.id, firstSong.previewPath, firstSong.previewVolume);
    const latestStart = switched.toggle(secondSong.id, secondSong.previewPath, secondSong.previewVolume);
    await Promise.all([staleStart, latestStart]);
    equal(switchedAudio.plays.length, 1, "A rapid song switch never starts the stale queued preview");
    equal(switchedAudio.plays[0].path, secondSong.previewPath, "A rapid switch starts only the latest selection");
    equal(switched.getSnapshot().songId, secondSong.id, "The latest song owns the playing snapshot");
    equal(switched.getSnapshot().phase, "playing", "The latest song reaches playing state");

    const cancelledAudio = new RecordingPreviewAudio();
    const cancelled = new SongPreviewController(cancelledAudio);
    const pendingStart = cancelled.toggle(firstSong.id, firstSong.previewPath, firstSong.previewVolume);
    const pendingStop = cancelled.stop();
    await Promise.all([pendingStart, pendingStop]);
    equal(cancelledAudio.plays.length, 0, "Play then pause before host startup cannot leak stale audio");
    equal(cancelled.getSnapshot().phase, "idle", "A cancelled startup settles to idle");

    const unavailableAudio = new RecordingPreviewAudio();
    unavailableAudio.playResult = false;
    const unavailable = new SongPreviewController(unavailableAudio);
    const unavailableSnapshot = await unavailable.toggle(
        firstSong.id,
        firstSong.previewPath,
        firstSong.previewVolume
    );
    equal(unavailableSnapshot.phase, "idle", "A rejected host audio call returns to idle");
    equal(unavailableSnapshot.available, false, "A rejected host audio call remains visible to the UI");
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
    const flow = new GroupDanceFlow(DEMO_BEATMAP.groups.length);
    const segmentDurationMs = DANCE_COMBO_DURATION_MS / DEMO_BEATMAP.groups.length;
    let previousEndMs = 0;

    for (let groupIndex = 0; groupIndex < DEMO_BEATMAP.groups.length; groupIndex += 1) {
        const segment = flow.beginGroupDance(groupIndex);
        near(segment.startMs, previousEndMs, 0.000001, "Dance slices are continuous at group " + groupIndex);
        near(
            segment.endMs,
            DANCE_COMBO_DURATION_MS * (groupIndex + 1) / DEMO_BEATMAP.groups.length,
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
        if (groupIndex < DEMO_BEATMAP.groups.length - 1) {
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

function testDanceFlowFreezesSongClockAndFutureNotes(): void {
    let now = 0;
    const clock = new SongClock(() => now);
    const engine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    const flow = new GroupDanceFlow(2);
    clock.start();
    engine.start();

    now = 1000;
    engine.inputDirection("left", clock.currentTimeMs());
    now = 1600;
    engine.inputDirection("up", clock.currentTimeMs());
    now = 2200;
    const completed = lastAction(engine.inputDirection("right", clock.currentTimeMs()));
    equal(completed.groupCompleted, true, "Fixture completes its first input group");
    const frozenSongTimeMs = clock.currentTimeMs();
    clock.pause();
    const segment = flow.beginGroupDance(completed.groupIndex);

    now += segment.durationMs;
    const transition = flow.update(segment.durationMs);
    equal(transition && transition.kind, "next-group", "Dance timer advances while song time is paused");
    equal(clock.currentTimeMs(), frozenSongTimeMs, "Dance wall time is excluded from SongClock");
    equal(engine.update(clock.currentTimeMs()).length, 0, "Frozen song time cannot auto-Miss a future note");
    equal(engine.getSnapshot().noteIndex, 0, "The next group's first note remains pending after dance");

    clock.resume();
    now += 100;
    equal(clock.currentTimeMs(), frozenSongTimeMs + 100, "SongClock resumes from the exact pre-dance point");
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
    equal(extremeBottomInset.safeInsetsClamped, false, "250-unit bottom inset still fits the full core stack");
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
        250.8,
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
        startButtonScale: 0.76
    });
    assertMenuFooterStack(desktop, "1280x720 menu");

    const compact = calculateMenuFooterVerticalLayout({
        viewportHeight: 540,
        safeBottom: 0,
        startButtonHeight: 145,
        startButtonScale: 0.62
    });
    assertMenuFooterStack(compact, "960x540 menu");

    const compactSafeArea = calculateMenuFooterVerticalLayout({
        viewportHeight: 540,
        safeBottom: 63,
        startButtonHeight: 145,
        startButtonScale: 0.5544
    });
    assertMenuFooterStack(compactSafeArea, "960x540 scaled safe-area menu");
}

function calculateMenuCardsForScenario(
    viewportWidth: number,
    viewportHeight: number,
    safeTop: number,
    safeBottom: number
): MenuCardVerticalLayout {
    const compact = viewportHeight < 640;
    const safePressure = Math.min(1, (safeTop + safeBottom) / 150);
    const logoScale = compact ? 0.45 - safePressure * 0.15 : 0.62;
    const startScaleLimit = compact ? 0.62 - safePressure * 0.08 : 0.76;
    const startScale = Math.min(startScaleLimit, Math.max(0.52, (viewportWidth - 80) / 527));
    const footer = calculateMenuFooterVerticalLayout({
        viewportHeight,
        safeBottom,
        startButtonHeight: 145,
        startButtonScale: startScale
    });
    const logoBottom = viewportHeight * 0.5 - safeTop - 12 - 280 * logoScale;
    const panelAspect = 696 / 565;
    const preferredCardWidth = Math.min(310, viewportWidth * 0.28);
    return calculateMenuCardVerticalLayout({
        logoBottom,
        cardBottom: footer.cardBottom,
        preferredCardHeight: preferredCardWidth / panelAspect,
        maximumCardHeight: compact ? 184 : 252
    });
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
    assertVisibleMenuCards(
        calculateMenuCardsForScenario(1280, 720, 0, 0),
        "1280x720 normal menu"
    );
    assertVisibleMenuCards(
        calculateMenuCardsForScenario(960, 540, 44, 34),
        "960x540 common Builda safe area"
    );
    assertHiddenMenuCards(
        calculateMenuCardsForScenario(960, 540, 70, 70),
        "960x540 70/70 safe area"
    );
    assertHiddenMenuCards(
        calculateMenuCardsForScenario(960, 540, 60, 63),
        "960x540 60/63 safe area"
    );
    assertHiddenMenuCards(
        calculateMenuCardsForScenario(1280, 720, 81.2, 250),
        "1280x720 81.2/250 safe area"
    );
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
}

async function testBuildaAudioResultMapping(): Promise<void> {
    const hadWindow = Object.prototype.hasOwnProperty.call(global, "window");
    const previousWindow = global.window;
    let capturedSfxOptions: any = null;
    try {
        global.window = {
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
        equal(await hostedAdapter.playBGM("audio/bgm/demo.ogg"), false, "Rejected SDK Result maps to false");
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
    testDemoGridAndGroups();
    testSongCatalogAndGeneratedDifficulty();
    testTooEarlyAndWrongDirectionBoundary();
    testPerNoteScoresComboAndGroupAdvance();
    testOnlyEarliestNoteCanSettle();
    testLateBoundaryAndAutomaticFailure();
    testCatchUpStopsAtGroupBoundary();
    testGroupDanceFlowSegments();
    testDanceFlowFreezesSongClockAndFutureNotes();
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
    testMenuCardVisibilityLayout();
    testSongClockCalibrationAndPause();
    testUiStartupRaceAndFallback();
    await testBuildaReadyBoundedFallback();
    await testBuildaAudioResultMapping();
    await testSongPreviewControllerSerialization();
    console.log("logic-tests=passed cases=29");
}

run().catch((error) => {
    console.error(error);
    throw error;
});
