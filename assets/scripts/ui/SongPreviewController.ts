export type SongPreviewPhase = "idle" | "starting" | "playing" | "stopping";

export interface SongPreviewAudioPort {
    playBGM(path: string, loop?: boolean, volume?: number): Promise<boolean>;
    stopBGM(): Promise<boolean>;
}

export interface SongPreviewSnapshot {
    songId: string | null;
    phase: SongPreviewPhase;
    available: boolean | null;
    loop: boolean | null;
}

function previewVolume(value: number): number {
    return typeof value === "number" && isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : 1;
}

/**
 * Serializes preview taps around the host BGM channel. A stale asynchronous
 * play result is stopped again so a quick Play -> Pause gesture cannot leave
 * audio running behind an idle button.
 */
export class SongPreviewController {
    private readonly audio: SongPreviewAudioPort;
    private operationId: number = 0;
    private transition: Promise<void> = Promise.resolve();
    private snapshot: SongPreviewSnapshot = {
        songId: null,
        phase: "idle",
        available: null,
        loop: null
    };

    public constructor(audio: SongPreviewAudioPort) {
        this.audio = audio;
    }

    public getSnapshot(): SongPreviewSnapshot {
        return { ...this.snapshot };
    }

    public toggle(songId: string, path: string, volume: number = 1): Promise<SongPreviewSnapshot> {
        const normalizedSongId = (songId || "").trim();
        const normalizedPath = (path || "").trim();
        if (!normalizedSongId || !normalizedPath) {
            this.snapshot = { songId: null, phase: "idle", available: false, loop: null };
            return Promise.resolve(this.getSnapshot());
        }
        if (this.snapshot.songId === normalizedSongId
            && this.snapshot.loop === true
            && this.snapshot.phase !== "idle") {
            return this.stop();
        }
        return this.play(normalizedSongId, normalizedPath, true, volume);
    }

    /**
     * Owns the one host BGM channel for both looping previews and non-looping
     * gameplay. Every call is serialized behind the previous stop/play edge.
     */
    public play(
        songId: string,
        path: string,
        loop: boolean,
        volume: number = 1
    ): Promise<SongPreviewSnapshot> {
        const normalizedSongId = (songId || "").trim();
        const normalizedPath = (path || "").trim();
        if (!normalizedSongId || !normalizedPath) {
            this.snapshot = { songId: null, phase: "idle", available: false, loop: null };
            return Promise.resolve(this.getSnapshot());
        }
        return this.start(normalizedSongId, normalizedPath, !!loop, previewVolume(volume));
    }

    public stop(): Promise<SongPreviewSnapshot> {
        if (this.snapshot.phase === "idle" && this.snapshot.songId === null) {
            return Promise.resolve(this.getSnapshot());
        }
        const operationId = ++this.operationId;
        const previousSongId = this.snapshot.songId;
        this.snapshot = {
            songId: previousSongId,
            phase: "stopping",
            available: this.snapshot.available,
            loop: this.snapshot.loop
        };
        return this.enqueue(async () => {
            const stopped = await this.safeStop();
            if (operationId !== this.operationId) {
                return;
            }
            // A host rejection is still a completed local stop boundary. Do
            // not leave a stale Play/Pause state behind after gameplay/home.
            this.snapshot = { songId: null, phase: "idle", available: stopped, loop: null };
        });
    }

    private start(
        songId: string,
        path: string,
        loop: boolean,
        volume: number
    ): Promise<SongPreviewSnapshot> {
        const operationId = ++this.operationId;
        this.snapshot = { songId, phase: "starting", available: this.snapshot.available, loop };
        return this.enqueue(async () => {
            await this.safeStop();
            if (operationId !== this.operationId) {
                return;
            }

            const played = await this.safePlay(path, loop, volume);
            if (operationId !== this.operationId) {
                if (played) {
                    await this.safeStop();
                }
                return;
            }
            this.snapshot = played
                ? { songId, phase: "playing", available: true, loop }
                : { songId: null, phase: "idle", available: false, loop: null };
        });
    }

    private enqueue(work: () => Promise<void>): Promise<SongPreviewSnapshot> {
        const pending = this.transition.then(work, work);
        this.transition = pending.then(() => undefined, () => undefined);
        return pending.then(() => this.getSnapshot(), () => {
            this.snapshot = { songId: null, phase: "idle", available: false, loop: null };
            return this.getSnapshot();
        });
    }

    private safePlay(path: string, loop: boolean, volume: number): Promise<boolean> {
        try {
            return Promise.resolve(this.audio.playBGM(path, loop, volume)).catch(() => false);
        } catch (_error) {
            return Promise.resolve(false);
        }
    }

    private safeStop(): Promise<boolean> {
        try {
            return Promise.resolve(this.audio.stopBGM()).catch(() => false);
        } catch (_error) {
            return Promise.resolve(false);
        }
    }
}
