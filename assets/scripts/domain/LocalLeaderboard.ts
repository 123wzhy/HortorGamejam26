export const LOCAL_LEADERBOARD_KEY = "local_leaderboard_v1";
export const LOCAL_LEADERBOARD_LIMIT = 10;

const LOCAL_LEADERBOARD_VERSION = 1;
const MAX_SAFE_INTEGER = 9007199254740991;

export interface LocalLeaderboardStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export interface LocalLeaderboardEntry {
    score: number;
    maxCombo: number;
    completedAt: number;
    order: number;
}

export interface LocalLeaderboardRecordInput {
    score: number;
    maxCombo: number;
    completedAt?: number;
}

export type LocalLeaderboardPersistenceIssue =
    "storage-unavailable"
    | "storage-read-failed"
    | "storage-data-corrupt"
    | "storage-write-failed";

export interface LocalLeaderboardResult {
    entry: LocalLeaderboardEntry;
    rank: number;
    retained: boolean;
}

export interface LocalLeaderboardSnapshot {
    entries: LocalLeaderboardEntry[];
    latest: LocalLeaderboardResult | null;
    persistenceIssue: LocalLeaderboardPersistenceIssue | null;
}

interface LocalLeaderboardPayload {
    version: number;
    nextOrder: number;
    entries: LocalLeaderboardEntry[];
    latestCompleted: LocalLeaderboardEntry | null;
}

interface LoadedLeaderboardState {
    nextOrder: number;
    entries: LocalLeaderboardEntry[];
    latestCompleted: LocalLeaderboardEntry | null;
}

function isObject(value: any): value is { [key: string]: any } {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeInteger(value: any): value is number {
    return typeof value === "number"
        && isFinite(value)
        && Math.floor(value) === value
        && Math.abs(value) <= MAX_SAFE_INTEGER;
}

function decodeEntry(value: any): LocalLeaderboardEntry | null {
    if (!isObject(value)
        || !isSafeInteger(value.score) || value.score < 0
        || !isSafeInteger(value.maxCombo) || value.maxCombo < 0
        || !isSafeInteger(value.completedAt) || value.completedAt < 0
        || !isSafeInteger(value.order) || value.order <= 0) {
        return null;
    }
    return {
        score: value.score,
        maxCombo: value.maxCombo,
        completedAt: value.completedAt,
        order: value.order
    };
}

function cloneEntry(entry: LocalLeaderboardEntry): LocalLeaderboardEntry {
    return {
        score: entry.score,
        maxCombo: entry.maxCombo,
        completedAt: entry.completedAt,
        order: entry.order
    };
}

function sameEntry(left: LocalLeaderboardEntry, right: LocalLeaderboardEntry): boolean {
    return left.score === right.score
        && left.maxCombo === right.maxCombo
        && left.completedAt === right.completedAt
        && left.order === right.order;
}

/** Negative means left appears before right in the local ranking. */
function compareEntries(left: LocalLeaderboardEntry, right: LocalLeaderboardEntry): number {
    if (left.score !== right.score) {
        return left.score > right.score ? -1 : 1;
    }
    if (left.maxCombo !== right.maxCombo) {
        return left.maxCombo > right.maxCombo ? -1 : 1;
    }
    if (left.completedAt !== right.completedAt) {
        return left.completedAt < right.completedAt ? -1 : 1;
    }
    if (left.order !== right.order) {
        return left.order < right.order ? -1 : 1;
    }
    return 0;
}

function rankAmong(entries: LocalLeaderboardEntry[], target: LocalLeaderboardEntry): number {
    let rank = 1;
    entries.forEach((entry) => {
        if (entry.order !== target.order && compareEntries(entry, target) < 0) {
            rank += 1;
        }
    });
    return rank;
}

function normalizedNonNegativeInteger(value: number): number {
    if (!isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.min(MAX_SAFE_INTEGER, Math.floor(value));
}

/**
 * Device-local, Cocos-independent leaderboard. Storage failures permanently
 * switch the current instance to memory-only mode so gameplay never depends on
 * browser persistence being available or healthy.
 */
export class LocalLeaderboard {
    private storage: LocalLeaderboardStorage | null;
    private readonly now: () => number;
    private entries: LocalLeaderboardEntry[] = [];
    private latestCompleted: LocalLeaderboardEntry | null = null;
    private nextOrder: number = 1;
    private persistenceIssue: LocalLeaderboardPersistenceIssue | null = null;

    public constructor(
        storage: LocalLeaderboardStorage | null,
        now: () => number = () => Date.now()
    ) {
        this.storage = storage;
        this.now = now;
        this.load();
    }

    public record(input: LocalLeaderboardRecordInput): LocalLeaderboardResult {
        const providedCompletedAt = input.completedAt;
        const now = providedCompletedAt === undefined ? this.now() : providedCompletedAt;
        const entry: LocalLeaderboardEntry = {
            score: normalizedNonNegativeInteger(input.score),
            maxCombo: normalizedNonNegativeInteger(input.maxCombo),
            completedAt: normalizedNonNegativeInteger(now),
            order: this.nextOrder
        };
        this.nextOrder += 1;

        const candidates = this.entries.concat([entry]);
        candidates.sort(compareEntries);
        const rank = rankAmong(candidates, entry);
        this.entries = candidates.slice(0, LOCAL_LEADERBOARD_LIMIT).map(cloneEntry);
        this.latestCompleted = cloneEntry(entry);
        this.persist();

        return {
            entry: cloneEntry(entry),
            rank,
            retained: rank <= LOCAL_LEADERBOARD_LIMIT
        };
    }

    public getSnapshot(): LocalLeaderboardSnapshot {
        return {
            entries: this.entries.map(cloneEntry),
            latest: this.latestResult(),
            persistenceIssue: this.persistenceIssue
        };
    }

    private load(): void {
        if (!this.storage) {
            this.persistenceIssue = "storage-unavailable";
            return;
        }

        let raw: string | null;
        try {
            raw = this.storage.getItem(LOCAL_LEADERBOARD_KEY);
        } catch (_error) {
            this.disablePersistence("storage-read-failed");
            return;
        }
        if (raw === null) {
            return;
        }
        if (typeof raw !== "string") {
            this.disablePersistence("storage-data-corrupt");
            return;
        }

        let decoded: any;
        try {
            decoded = JSON.parse(raw);
        } catch (_error) {
            this.disablePersistence("storage-data-corrupt");
            return;
        }
        const loaded = this.decodePayload(decoded);
        if (!loaded) {
            this.disablePersistence("storage-data-corrupt");
            return;
        }

        this.nextOrder = loaded.nextOrder;
        this.entries = loaded.entries;
        this.latestCompleted = loaded.latestCompleted;
    }

    private decodePayload(value: any): LoadedLeaderboardState | null {
        if (!isObject(value)
            || value.version !== LOCAL_LEADERBOARD_VERSION
            || !isSafeInteger(value.nextOrder) || value.nextOrder <= 0
            || !Array.isArray(value.entries)
            || value.entries.length > LOCAL_LEADERBOARD_LIMIT) {
            return null;
        }

        const entries: LocalLeaderboardEntry[] = [];
        const seenOrders: { [key: string]: boolean } = {};
        let maximumOrder = 0;
        for (let index = 0; index < value.entries.length; index += 1) {
            const entry = decodeEntry(value.entries[index]);
            if (!entry || seenOrders[String(entry.order)]) {
                return null;
            }
            if (entries.length > 0 && compareEntries(entries[entries.length - 1], entry) > 0) {
                return null;
            }
            entries.push(entry);
            seenOrders[String(entry.order)] = true;
            maximumOrder = Math.max(maximumOrder, entry.order);
        }

        let latestCompleted: LocalLeaderboardEntry | null = null;
        if (value.latestCompleted !== null) {
            latestCompleted = decodeEntry(value.latestCompleted);
            if (!latestCompleted) {
                return null;
            }
            maximumOrder = Math.max(maximumOrder, latestCompleted.order);
            let retainedEntry: LocalLeaderboardEntry | null = null;
            entries.forEach((entry) => {
                if (entry.order === latestCompleted!.order) {
                    retainedEntry = entry;
                }
            });
            if (retainedEntry && !sameEntry(retainedEntry, latestCompleted)) {
                return null;
            }
            if (!retainedEntry
                && (entries.length < LOCAL_LEADERBOARD_LIMIT
                    || rankAmong(entries, latestCompleted) <= LOCAL_LEADERBOARD_LIMIT)) {
                return null;
            }
        } else if (entries.length > 0) {
            return null;
        }

        if (value.nextOrder <= maximumOrder) {
            return null;
        }
        return {
            nextOrder: value.nextOrder,
            entries: entries.map(cloneEntry),
            latestCompleted: latestCompleted ? cloneEntry(latestCompleted) : null
        };
    }

    private persist(): void {
        if (!this.storage) {
            return;
        }
        const payload: LocalLeaderboardPayload = {
            version: LOCAL_LEADERBOARD_VERSION,
            nextOrder: this.nextOrder,
            entries: this.entries.map(cloneEntry),
            latestCompleted: this.latestCompleted ? cloneEntry(this.latestCompleted) : null
        };
        try {
            this.storage.setItem(LOCAL_LEADERBOARD_KEY, JSON.stringify(payload));
        } catch (_error) {
            this.disablePersistence("storage-write-failed");
        }
    }

    private latestResult(): LocalLeaderboardResult | null {
        if (!this.latestCompleted) {
            return null;
        }
        let retainedRank = 0;
        this.entries.forEach((entry, index) => {
            if (entry.order === this.latestCompleted!.order) {
                retainedRank = index + 1;
            }
        });
        return {
            entry: cloneEntry(this.latestCompleted),
            rank: retainedRank || rankAmong(this.entries, this.latestCompleted),
            retained: retainedRank > 0
        };
    }

    private disablePersistence(issue: LocalLeaderboardPersistenceIssue): void {
        this.storage = null;
        this.persistenceIssue = issue;
    }
}
