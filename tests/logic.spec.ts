import { Beatmap, DEMO_BEATMAP } from "../assets/scripts/domain/Beatmap";
import { JudgeSystem } from "../assets/scripts/gameplay/JudgeSystem";
import { SequenceEngine } from "../assets/scripts/gameplay/SequenceEngine";
import { PressedKeyState } from "../assets/scripts/input/PressedKeyState";
import { BuildaAdapter, calculateRightAvoidance } from "../assets/scripts/platform/BuildaAdapter";
import { SongClock } from "../assets/scripts/timing/SongClock";

declare const global: any;

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
        throw new Error(message + " (expected " + String(expected) + ", got " + String(actual) + ")");
    }
}

function testJudgeBoundaries(): void {
    const judge = new JudgeSystem({ perfectMs: 45, greatMs: 90, goodMs: 150 });
    equal(judge.judge(-45).grade, "Perfect", "Perfect boundary is inclusive");
    equal(judge.judge(45.001).grade, "Great", "Past Perfect enters Great");
    equal(judge.judge(-90).grade, "Great", "Great boundary is inclusive");
    equal(judge.judge(90.001).grade, "Good", "Past Great enters Good");
    equal(judge.judge(150).grade, "Good", "Good boundary is inclusive");
    equal(judge.judge(-150.001).grade, "Miss", "Past Good is Miss");
}

function testDemoTargetsAlignWithVisualBeat(): void {
    const beatDurationMs = 60000 / DEMO_BEATMAP.bpm;
    DEMO_BEATMAP.sequences.forEach((sequence) => {
        equal(
            sequence.targetTimeMs % beatDurationMs,
            0,
            sequence.id + " target must align with the visual beat pulse"
        );
    });
}

function makeBeatmap(): Beatmap {
    return {
        id: "test",
        title: "Test",
        bpm: 120,
        sequences: [
            { id: "one", directions: ["left", "up"], targetTimeMs: 1000 },
            { id: "two", directions: ["right"], targetTimeMs: 2000 }
        ]
    };
}

function makeSingleBeatmap(): Beatmap {
    return {
        id: "single",
        title: "Single",
        bpm: 120,
        sequences: [{ id: "final", directions: ["left"], targetTimeMs: 1000 }]
    };
}

function testWrongDirectionAndSuccessfulSequence(): void {
    const engine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    engine.start();
    equal(engine.inputDirection("left", 100).kind, "accepted", "First correct direction is accepted");
    equal(engine.inputDirection("down", 200).kind, "wrong", "Wrong direction is reported");
    equal(engine.getSnapshot().enteredCount, 0, "Wrong direction resets phrase input");
    engine.inputDirection("left", 300);
    equal(engine.inputDirection("up", 400).kind, "ready", "Complete phrase becomes ready");
    const result = engine.confirm(1000);
    equal(result.kind, "judged", "A non-final hit keeps its judgement action kind");
    equal(result.finished, false, "A non-final hit does not finish the beatmap");
    equal(result.judgement && result.judgement.grade, "Perfect", "On-time complete phrase is Perfect");
    equal(engine.getSnapshot().score, 1000, "Perfect awards base score");
    equal(engine.getSnapshot().combo, 1, "Hit increments combo");
    equal(engine.getSnapshot().sequenceIndex, 1, "Hit advances phrase");
}

function testEarlyIncompleteAndExpiry(): void {
    const engine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    engine.start();
    equal(engine.confirm(849.999).kind, "tooEarly", "Early Beat does not consume phrase");
    equal(engine.getSnapshot().sequenceIndex, 0, "Early Beat keeps current phrase");
    equal(engine.confirm(850).kind, "missed", "Incomplete Beat inside Good window is Miss");
    equal(engine.getSnapshot().sequenceIndex, 1, "Incomplete Beat advances after Miss");
    equal(engine.update(2150).length, 0, "Expiry boundary remains hittable");
    const expired = engine.update(2150.001);
    equal(expired.length, 1, "Past expiry produces one Miss");
    equal(expired[0].kind, "missed", "Final timeout keeps its Miss action kind");
    equal(expired[0].finished, true, "Final timeout separately reports beatmap completion");
    equal(expired[0].reason, "expired", "Timeout reports expired reason");
    equal(engine.getSnapshot().finished, true, "Last expired phrase completes beatmap");
}

function testFinalOutcomeSemantics(): void {
    const hitEngine = new SequenceEngine(makeSingleBeatmap(), new JudgeSystem());
    hitEngine.start();
    hitEngine.inputDirection("left", 500);
    const finalHit = hitEngine.confirm(1000);
    equal(finalHit.kind, "judged", "Final hit remains a judged action");
    equal(finalHit.finished, true, "Final hit independently reports completion");
    equal(finalHit.judgement && finalHit.judgement.grade, "Perfect", "Final hit preserves its grade");

    const missEngine = new SequenceEngine(makeSingleBeatmap(), new JudgeSystem());
    missEngine.start();
    const finalMiss = missEngine.confirm(1000);
    equal(finalMiss.kind, "missed", "Final incomplete confirmation remains a Miss action");
    equal(finalMiss.finished, true, "Final incomplete confirmation reports completion");
    equal(finalMiss.judgement && finalMiss.judgement.grade, "Miss", "Final Miss preserves its grade");

    const timeoutEngine = new SequenceEngine(makeSingleBeatmap(), new JudgeSystem());
    timeoutEngine.start();
    const finalTimeout = timeoutEngine.update(1150.001)[0];
    equal(finalTimeout.kind, "missed", "Final timeout remains a Miss action");
    equal(finalTimeout.finished, true, "Final timeout reports completion");
    equal(finalTimeout.reason, "expired", "Final timeout preserves its reason");
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

function testRightSafeAreaAndCapsuleAvoidance(): void {
    equal(
        calculateRightAvoidance(260, 10, 80),
        278,
        "A larger right safe area wins over the capsule block"
    );
    equal(
        calculateRightAvoidance(20, 10, 80),
        108,
        "A larger capsule block wins over the right safe area"
    );
    equal(calculateRightAvoidance(20, 10, 0), 38, "A missing capsule falls back to the safe area");
}

function testRestart(): void {
    const engine = new SequenceEngine(makeBeatmap(), new JudgeSystem());
    engine.start();
    engine.inputDirection("left", 100);
    engine.inputDirection("up", 200);
    engine.confirm(1000);
    engine.restart();
    const state = engine.getSnapshot();
    equal(state.sequenceIndex, 0, "Restart returns to first phrase");
    equal(state.score, 0, "Restart clears score");
    equal(state.combo, 0, "Restart clears combo");
    equal(state.enteredCount, 0, "Restart clears entered directions");
    equal(state.running, true, "Restart starts the engine");
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
    equal(clock.currentTimeMs(), 20, "Restart resets elapsed time and preserves calibration");
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
        equal(
            await hostedAdapter.playSFX("audio/sfx/hit.ogg", "combo-hit", 0.5),
            true,
            "Successful SFX Result maps to true"
        );
        equal(capturedSfxOptions.sessionId, "combo-hit", "SFX session id uses the SDK contract key");
        equal(capturedSfxOptions.volume, 0.5, "SFX volume is forwarded");
        equal(
            Object.prototype.hasOwnProperty.call(capturedSfxOptions, "key"),
            false,
            "Legacy key option is not sent to the SDK"
        );

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
    testDemoTargetsAlignWithVisualBeat();
    testWrongDirectionAndSuccessfulSequence();
    testEarlyIncompleteAndExpiry();
    testFinalOutcomeSemantics();
    testPressedKeyResetAfterFocusLoss();
    testRightSafeAreaAndCapsuleAvoidance();
    testRestart();
    testSongClockCalibrationAndPause();
    await testBuildaAudioResultMapping();
    console.log("logic-tests=passed cases=10");
}

run().catch((error) => {
    console.error(error);
    throw error;
});
