export type NowProvider = () => number;

function defaultNow(): number {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
        return performance.now();
    }
    return Date.now();
}

/**
 * SongClock derives time from a monotonic timestamp instead of accumulating dt.
 * Pauses are removed from elapsed time, while calibration is applied only to the
 * reported song position.
 */
export class SongClock {
    private readonly nowProvider: NowProvider;
    private anchorNowMs: number = 0;
    private elapsedBeforeAnchorMs: number = 0;
    private calibrationOffsetMs: number = 0;
    private started: boolean = false;
    private paused: boolean = true;

    public constructor(nowProvider: NowProvider = defaultNow) {
        this.nowProvider = nowProvider;
    }

    public start(): void {
        this.anchorNowMs = this.nowProvider();
        this.elapsedBeforeAnchorMs = 0;
        this.started = true;
        this.paused = false;
    }

    public restart(): void {
        this.start();
    }

    public stop(): void {
        this.anchorNowMs = 0;
        this.elapsedBeforeAnchorMs = 0;
        this.started = false;
        this.paused = true;
    }

    public pause(): void {
        if (!this.started || this.paused) {
            return;
        }
        this.elapsedBeforeAnchorMs += Math.max(0, this.nowProvider() - this.anchorNowMs);
        this.paused = true;
    }

    public resume(): void {
        if (!this.started || !this.paused) {
            return;
        }
        this.anchorNowMs = this.nowProvider();
        this.paused = false;
    }

    public setCalibrationOffsetMs(offsetMs: number): void {
        this.calibrationOffsetMs = isFinite(offsetMs) ? offsetMs : 0;
    }

    public getCalibrationOffsetMs(): number {
        return this.calibrationOffsetMs;
    }

    public currentTimeMs(): number {
        if (!this.started) {
            return this.calibrationOffsetMs;
        }
        const runningSlice = this.paused ? 0 : Math.max(0, this.nowProvider() - this.anchorNowMs);
        return this.elapsedBeforeAnchorMs + runningSlice + this.calibrationOffsetMs;
    }

    public isStarted(): boolean {
        return this.started;
    }

    public isPaused(): boolean {
        return this.paused;
    }
}
