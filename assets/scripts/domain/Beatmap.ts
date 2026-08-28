export type Direction = "left" | "down" | "up" | "right";

export interface BeatNote {
    id: string;
    direction: Direction;
    targetTimeMs: number;
}

export interface BeatGroup {
    id: string;
    notes: BeatNote[];
}

export interface Beatmap {
    id: string;
    title: string;
    bpm: number;
    beatOffsetMs: number;
    groups: BeatGroup[];
}

interface AuthoredBeatGroup {
    startBeat: number;
    stepBeats: number;
    directions: Direction[];
}

function twoDigits(value: number): string {
    return value < 10 ? "0" + value : String(value);
}

/** Converts authored half-beat positions without rounding away the source grid. */
function buildBeatmap(
    id: string,
    title: string,
    bpm: number,
    beatOffsetMs: number,
    authoredGroups: AuthoredBeatGroup[]
): Beatmap {
    const beatDurationMs = 60000 / bpm;
    return {
        id,
        title,
        bpm,
        beatOffsetMs,
        groups: authoredGroups.map((group, groupIndex) => {
            const groupNumber = twoDigits(groupIndex + 1);
            return {
                id: id + "-group-" + groupNumber,
                notes: group.directions.map((direction, noteIndex) => ({
                    id: id + "-g" + groupNumber + "-n" + twoDigits(noteIndex + 1),
                    direction,
                    targetTimeMs: beatOffsetMs
                        + (group.startBeat + noteIndex * group.stepBeats) * beatDurationMs
                }))
            };
        })
    };
}

/** 138.7 BPM / 95.8 ms offset: alternating full- and half-beat phrases. */
export const FENG_WU_JIU_TIAN_BEATMAP: Beatmap = buildBeatmap(
    "feng-wu-jiu-tian",
    "凤舞九天",
    138.7,
    95.8,
    [
        { startBeat: 17, stepBeats: 1, directions: ["left", "up", "right", "down"] },
        { startBeat: 32, stepBeats: 0.5, directions: ["down", "down", "right", "up"] },
        { startBeat: 46.5, stepBeats: 1, directions: ["right", "up", "left", "down"] },
        { startBeat: 61.5, stepBeats: 0.5, directions: ["left", "right", "left", "up"] },
        { startBeat: 75, stepBeats: 1, directions: ["up", "down", "right", "left"] },
        { startBeat: 90, stepBeats: 0.5, directions: ["right", "right", "up", "down"] },
        { startBeat: 103.5, stepBeats: 1, directions: ["down", "left", "up", "right"] },
        { startBeat: 118.5, stepBeats: 0.5, directions: ["left", "up", "up", "right"] }
    ]
);

/** 140.88 BPM / 352.9 ms offset: five-note half-beat phrases. */
export const ZHU_ZHU_XIA_BEATMAP: Beatmap = buildBeatmap(
    "zhu-zhu-xia",
    "猪猪侠",
    140.88,
    352.9,
    [
        { startBeat: 17, stepBeats: 0.5, directions: ["up", "right", "down", "left", "up"] },
        { startBeat: 31.5, stepBeats: 0.5, directions: ["left", "down", "right", "up", "left"] },
        { startBeat: 46.5, stepBeats: 0.5, directions: ["right", "up", "left", "down", "right"] },
        { startBeat: 61, stepBeats: 0.5, directions: ["down", "right", "up", "left", "down"] },
        { startBeat: 75.5, stepBeats: 0.5, directions: ["up", "left", "down", "right", "up"] },
        { startBeat: 90, stepBeats: 0.5, directions: ["right", "down", "left", "up", "right"] },
        { startBeat: 104.5, stepBeats: 0.5, directions: ["left", "up", "right", "down", "left"] },
        { startBeat: 119, stepBeats: 0.5, directions: ["down", "left", "up", "right", "down"] }
    ]
);

/** 124.82 BPM / 115.5 ms offset: spacious full-beat phrases. */
export const ARE_YOU_OK_BEATMAP: Beatmap = buildBeatmap(
    "are-you-ok",
    "Are You OK",
    124.82,
    115.5,
    [
        { startBeat: 16, stepBeats: 1, directions: ["left", "left", "up"] },
        { startBeat: 28, stepBeats: 1, directions: ["down", "right", "down"] },
        { startBeat: 41, stepBeats: 1, directions: ["up", "right", "left", "up"] },
        { startBeat: 54, stepBeats: 1, directions: ["right", "right", "down"] },
        { startBeat: 67, stepBeats: 1, directions: ["left", "down", "up", "left"] },
        { startBeat: 80, stepBeats: 1, directions: ["up", "left", "up"] },
        { startBeat: 93, stepBeats: 1, directions: ["down", "up", "right", "down"] },
        { startBeat: 106, stepBeats: 1, directions: ["right", "left", "right"] }
    ]
);
