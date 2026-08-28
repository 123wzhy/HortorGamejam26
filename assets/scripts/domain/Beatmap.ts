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
    groups: BeatGroup[];
}

/**
 * Eight deterministic groups on a strict 100 BPM / 600 ms grid. Notes inside
 * a group are one beat apart; adjacent groups leave one empty beat of space.
 */
export const DEMO_BEATMAP: Beatmap = {
    id: "neon-grid-demo",
    title: "NEON GRID / ORIGINAL DEMO",
    bpm: 100,
    groups: [
        {
            id: "group-01",
            notes: [
                { id: "g01-n01", direction: "left", targetTimeMs: 2400 },
                { id: "g01-n02", direction: "up", targetTimeMs: 3000 },
                { id: "g01-n03", direction: "right", targetTimeMs: 3600 }
            ]
        },
        {
            id: "group-02",
            notes: [
                { id: "g02-n01", direction: "down", targetTimeMs: 4800 },
                { id: "g02-n02", direction: "left", targetTimeMs: 5400 },
                { id: "g02-n03", direction: "down", targetTimeMs: 6000 },
                { id: "g02-n04", direction: "right", targetTimeMs: 6600 }
            ]
        },
        {
            id: "group-03",
            notes: [
                { id: "g03-n01", direction: "right", targetTimeMs: 7800 },
                { id: "g03-n02", direction: "up", targetTimeMs: 8400 },
                { id: "g03-n03", direction: "left", targetTimeMs: 9000 },
                { id: "g03-n04", direction: "up", targetTimeMs: 9600 },
                { id: "g03-n05", direction: "down", targetTimeMs: 10200 }
            ]
        },
        {
            id: "group-04",
            notes: [
                { id: "g04-n01", direction: "left", targetTimeMs: 11400 },
                { id: "g04-n02", direction: "down", targetTimeMs: 12000 },
                { id: "g04-n03", direction: "right", targetTimeMs: 12600 }
            ]
        },
        {
            id: "group-05",
            notes: [
                { id: "g05-n01", direction: "up", targetTimeMs: 13800 },
                { id: "g05-n02", direction: "right", targetTimeMs: 14400 },
                { id: "g05-n03", direction: "down", targetTimeMs: 15000 },
                { id: "g05-n04", direction: "left", targetTimeMs: 15600 }
            ]
        },
        {
            id: "group-06",
            notes: [
                { id: "g06-n01", direction: "right", targetTimeMs: 16800 },
                { id: "g06-n02", direction: "right", targetTimeMs: 17400 },
                { id: "g06-n03", direction: "up", targetTimeMs: 18000 },
                { id: "g06-n04", direction: "left", targetTimeMs: 18600 },
                { id: "g06-n05", direction: "down", targetTimeMs: 19200 }
            ]
        },
        {
            id: "group-07",
            notes: [
                { id: "g07-n01", direction: "down", targetTimeMs: 20400 },
                { id: "g07-n02", direction: "left", targetTimeMs: 21000 },
                { id: "g07-n03", direction: "up", targetTimeMs: 21600 },
                { id: "g07-n04", direction: "right", targetTimeMs: 22200 }
            ]
        },
        {
            id: "group-08",
            notes: [
                { id: "g08-n01", direction: "left", targetTimeMs: 23400 },
                { id: "g08-n02", direction: "up", targetTimeMs: 24000 },
                { id: "g08-n03", direction: "right", targetTimeMs: 24600 }
            ]
        }
    ]
};

/**
 * A second, independently authored demo chart on a strict 120 BPM / 500 ms
 * grid. It deliberately keeps the same eight-group / 31-note scope while
 * changing both timing and direction content.
 */
export const SECOND_DEMO_BEATMAP: Beatmap = {
    id: "golden-stampede-demo",
    title: "GOLDEN STAMPEDE / ORIGINAL DEMO",
    bpm: 120,
    groups: [
        {
            id: "stampede-group-01",
            notes: [
                { id: "sg01-n01", direction: "up", targetTimeMs: 2000 },
                { id: "sg01-n02", direction: "right", targetTimeMs: 2500 },
                { id: "sg01-n03", direction: "down", targetTimeMs: 3000 },
                { id: "sg01-n04", direction: "left", targetTimeMs: 3500 }
            ]
        },
        {
            id: "stampede-group-02",
            notes: [
                { id: "sg02-n01", direction: "left", targetTimeMs: 4500 },
                { id: "sg02-n02", direction: "right", targetTimeMs: 5000 },
                { id: "sg02-n03", direction: "up", targetTimeMs: 5500 }
            ]
        },
        {
            id: "stampede-group-03",
            notes: [
                { id: "sg03-n01", direction: "down", targetTimeMs: 6500 },
                { id: "sg03-n02", direction: "up", targetTimeMs: 7000 },
                { id: "sg03-n03", direction: "left", targetTimeMs: 7500 },
                { id: "sg03-n04", direction: "right", targetTimeMs: 8000 },
                { id: "sg03-n05", direction: "down", targetTimeMs: 8500 }
            ]
        },
        {
            id: "stampede-group-04",
            notes: [
                { id: "sg04-n01", direction: "right", targetTimeMs: 9500 },
                { id: "sg04-n02", direction: "down", targetTimeMs: 10000 },
                { id: "sg04-n03", direction: "up", targetTimeMs: 10500 },
                { id: "sg04-n04", direction: "left", targetTimeMs: 11000 }
            ]
        },
        {
            id: "stampede-group-05",
            notes: [
                { id: "sg05-n01", direction: "up", targetTimeMs: 12000 },
                { id: "sg05-n02", direction: "left", targetTimeMs: 12500 },
                { id: "sg05-n03", direction: "right", targetTimeMs: 13000 }
            ]
        },
        {
            id: "stampede-group-06",
            notes: [
                { id: "sg06-n01", direction: "right", targetTimeMs: 14000 },
                { id: "sg06-n02", direction: "up", targetTimeMs: 14500 },
                { id: "sg06-n03", direction: "down", targetTimeMs: 15000 },
                { id: "sg06-n04", direction: "left", targetTimeMs: 15500 },
                { id: "sg06-n05", direction: "up", targetTimeMs: 16000 }
            ]
        },
        {
            id: "stampede-group-07",
            notes: [
                { id: "sg07-n01", direction: "left", targetTimeMs: 17000 },
                { id: "sg07-n02", direction: "down", targetTimeMs: 17500 },
                { id: "sg07-n03", direction: "right", targetTimeMs: 18000 }
            ]
        },
        {
            id: "stampede-group-08",
            notes: [
                { id: "sg08-n01", direction: "down", targetTimeMs: 19000 },
                { id: "sg08-n02", direction: "right", targetTimeMs: 19500 },
                { id: "sg08-n03", direction: "left", targetTimeMs: 20000 },
                { id: "sg08-n04", direction: "up", targetTimeMs: 20500 }
            ]
        }
    ]
};
