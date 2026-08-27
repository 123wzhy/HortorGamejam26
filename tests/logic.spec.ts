import { Beatmap, DEMO_BEATMAP } from "../assets/scripts/domain/Beatmap";
import { JudgeSystem } from "../assets/scripts/gameplay/JudgeSystem";
import { EngineAction, SequenceEngine } from "../assets/scripts/gameplay/SequenceEngine";
import { noteApproachProgress, timelineProgress } from "../assets/scripts/gameplay/TimingProgress";
import { PressedKeyState } from "../assets/scripts/input/PressedKeyState";
import { BuildaAdapter, calculateRightAvoidance } from "../assets/scripts/platform/BuildaAdapter";
import { SongClock } from "../assets/scripts/timing/SongClock";
import {
    calculateNoteChipVerticalLayout,
    calculateRhythmVerticalLayout,
    RhythmVerticalLayout
} from "../assets/scripts/ui/RhythmLayout";

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
    equal(largeBottomInset.panelHeight >= 118, true, "Large inset retains a usable note panel");
    near(
        largeBottomInset.buttonTop - largeBottomInset.buttonBottom,
        84,
        0.001,
        "Vertical pressure never shrinks the direction buttons"
    );
    assertVerticalStack(largeBottomInset, "large bottom inset");

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
                }
            }
        };
        const hostedAdapter = new BuildaAdapter();
        equal(await hostedAdapter.playBGM("audio/bgm/demo.ogg"), false, "Rejected SDK Result maps to false");
        equal(await hostedAdapter.stopBGM(), true, "Successful SDK Result maps to true");
        equal(await hostedAdapter.playSFX("audio/sfx/hit.ogg", "combo-hit", 0.5), true, "SFX Result maps to true");
        equal(capturedSfxOptions.sessionId, "combo-hit", "SFX session id uses SDK contract key");
        equal(Object.prototype.hasOwnProperty.call(capturedSfxOptions, "key"), false, "Legacy key is absent");

        delete global.window;
        equal(await new BuildaAdapter().playSFX("audio/sfx/hit.ogg"), false, "Missing host maps to false");
    } finally {
        if (hadWindow) {
            global.window = previousWindow;
        } else {
            delete global.window;
        }
    }
}

async function run(): Promise<void> {
    testJudgeBoundaries();
    testDemoGridAndGroups();
    testTooEarlyAndWrongDirectionBoundary();
    testPerNoteScoresComboAndGroupAdvance();
    testOnlyEarliestNoteCanSettle();
    testLateBoundaryAndAutomaticFailure();
    testMissBreaksCombo();
    testFinalTimeoutStillCompletes();
    testRestart();
    testPressedKeyResetAfterFocusLoss();
    testTimelineAndSafeAreaMath();
    testSafeBottomVerticalLayout();
    testSongClockCalibrationAndPause();
    await testBuildaAudioResultMapping();
    console.log("logic-tests=passed cases=14");
}

run().catch((error) => {
    console.error(error);
    throw error;
});
