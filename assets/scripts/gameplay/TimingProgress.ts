export function clamp01(value: number): number {
    if (!isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(1, value));
}

/** Maps an absolute song timestamp onto a full-song horizontal timeline. */
export function timelineProgress(songTimeMs: number, durationMs: number): number {
    return durationMs > 0 ? clamp01(songTimeMs / durationMs) : 0;
}

/**
 * Maps the active note from its approach horizon to the end of its late window.
 * The same mapping positions the marker, target tick and coloured judge window.
 */
export function noteApproachProgress(
    songTimeMs: number,
    targetTimeMs: number,
    approachMs: number,
    lateWindowMs: number
): number {
    const safeApproach = Math.max(0, approachMs);
    const safeLateWindow = Math.max(0, lateWindowMs);
    const span = safeApproach + safeLateWindow;
    if (span <= 0) {
        return songTimeMs >= targetTimeMs ? 1 : 0;
    }
    return clamp01((songTimeMs - (targetTimeMs - safeApproach)) / span);
}
