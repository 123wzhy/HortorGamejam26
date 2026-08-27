export type Direction = "left" | "down" | "up" | "right";

export interface BeatSequence {
    id: string;
    directions: Direction[];
    targetTimeMs: number;
}

export interface Beatmap {
    id: string;
    title: string;
    bpm: number;
    sequences: BeatSequence[];
}

/**
 * Eight deterministic phrases. The first target leaves enough time to read and
 * enter the sequence; later phrases alternate three to five directions.
 */
export const DEMO_BEATMAP: Beatmap = {
    id: "neon-step-demo",
    title: "NEON STEP / DEMO",
    bpm: 100,
    sequences: [
        { id: "bar-01", directions: ["left", "up", "right"], targetTimeMs: 2400 },
        { id: "bar-02", directions: ["down", "left", "down"], targetTimeMs: 4200 },
        { id: "bar-03", directions: ["right", "up", "left", "up"], targetTimeMs: 6000 },
        { id: "bar-04", directions: ["left", "down", "right", "down"], targetTimeMs: 7800 },
        { id: "bar-05", directions: ["up", "right", "down", "left"], targetTimeMs: 9600 },
        { id: "bar-06", directions: ["right", "right", "up", "left"], targetTimeMs: 11400 },
        { id: "bar-07", directions: ["down", "left", "up", "right", "down"], targetTimeMs: 13200 },
        { id: "bar-08", directions: ["left", "up", "down", "right", "up"], targetTimeMs: 15000 }
    ]
};
