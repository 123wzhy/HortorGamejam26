export interface EdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface CapsuleRect {
    top: number;
    right: number;
    width: number;
    height: number;
}

export interface BuildaViewportMetrics {
    safe: EdgeInsets;
    capsule: CapsuleRect;
    hosted: boolean;
}

export const DEFAULT_BUILDA_READY_TIMEOUT_MS = 3000;

function nonNegative(value: unknown): number {
    return typeof value === "number" && isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateRightAvoidance(
    safeRight: number,
    capsuleRight: number,
    capsuleWidth: number,
    padding: number = 18
): number {
    const capsuleBlock = nonNegative(capsuleWidth) > 0
        ? nonNegative(capsuleRight) + nonNegative(capsuleWidth)
        : 0;
    return Math.max(nonNegative(safeRight), capsuleBlock) + nonNegative(padding);
}

/** Thin platform boundary. Gameplay never reaches into the host bridge directly. */
export class BuildaAdapter {
    private readonly readyTimeoutMs: number;
    private fallbackBgm: HTMLAudioElement | null = null;
    private fallbackBgmOperationId: number = 0;

    public constructor(readyTimeoutMs: number = DEFAULT_BUILDA_READY_TIMEOUT_MS) {
        this.readyTimeoutMs = typeof readyTimeoutMs === "number" && isFinite(readyTimeoutMs)
            ? Math.max(0, readyTimeoutMs)
            : DEFAULT_BUILDA_READY_TIMEOUT_MS;
    }

    public ready(): Promise<void> {
        const builda = this.getBuilda();
        if (!builda || !builda.runtime || typeof builda.runtime.ready !== "function") {
            return Promise.resolve();
        }
        try {
            const hostReady = builda.runtime.ready();
            return new Promise<void>((resolve) => {
                let settled = false;
                let timeoutHandle: any = null;
                const settle = (): void => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    if (timeoutHandle !== null) {
                        clearTimeout(timeoutHandle);
                        timeoutHandle = null;
                    }
                    resolve();
                };

                timeoutHandle = setTimeout(() => {
                    if (settled) {
                        return;
                    }
                    console.warn(
                        "[BuildaAdapter] runtime.ready timed out after "
                        + this.readyTimeoutMs
                        + "ms; continuing in fallback mode"
                    );
                    settle();
                }, this.readyTimeoutMs);

                Promise.resolve(hostReady).then(
                    () => settle(),
                    (error: unknown) => {
                        if (settled) {
                            return;
                        }
                        console.warn("[BuildaAdapter] runtime.ready failed; continuing in fallback mode", error);
                        settle();
                    }
                );
            });
        } catch (error) {
            console.warn("[BuildaAdapter] runtime.ready threw; continuing in fallback mode", error);
            return Promise.resolve();
        }
    }

    public viewportMetrics(visibleWidth: number, visibleHeight: number): BuildaViewportMetrics {
        const builda = this.getBuilda();
        const cssWidth = typeof window !== "undefined" ? Math.max(1, window.innerWidth || visibleWidth) : visibleWidth;
        const cssHeight = typeof window !== "undefined" ? Math.max(1, window.innerHeight || visibleHeight) : visibleHeight;
        const scaleX = visibleWidth / Math.max(1, cssWidth);
        const scaleY = visibleHeight / Math.max(1, cssHeight);
        let safeSource: any = {};
        let capsuleSource: any = {};

        try {
            if (builda && builda.runtime && typeof builda.runtime.safeArea === "function") {
                safeSource = builda.runtime.safeArea() || {};
            }
            if (builda && builda.runtime && typeof builda.runtime.capsuleMenuRect === "function") {
                capsuleSource = builda.runtime.capsuleMenuRect() || {};
            }
        } catch (error) {
            console.warn("[BuildaAdapter] safe-area query failed; using zero insets", error);
            safeSource = {};
            capsuleSource = {};
        }

        return {
            safe: {
                top: nonNegative(safeSource.top) * scaleY,
                right: nonNegative(safeSource.right) * scaleX,
                bottom: nonNegative(safeSource.bottom) * scaleY,
                left: nonNegative(safeSource.left) * scaleX
            },
            capsule: {
                top: nonNegative(capsuleSource.top) * scaleY,
                right: nonNegative(capsuleSource.right) * scaleX,
                width: nonNegative(capsuleSource.width) * scaleX,
                height: nonNegative(capsuleSource.height) * scaleY
            },
            hosted: !!builda
        };
    }

    public playBGM(path: string, loop: boolean = true, volume: number = 1): Promise<boolean> {
        const builda = this.getBuilda();
        if (this.hasHostBgm(builda)) {
            this.stopFallbackBGM();
            return this.callHostAudio(builda, "playBGM", [path, { loop, volume }]);
        }
        return this.playFallbackBGM(path, loop, volume, builda);
    }

    public stopBGM(): Promise<boolean> {
        const builda = this.getBuilda();
        if (this.hasHostBgm(builda)) {
            this.stopFallbackBGM();
            return this.callHostAudio(builda, "stopBGM", []);
        }
        return Promise.resolve(this.stopFallbackBGM());
    }

    public playSFX(path: string, sessionId: string = "rhythm-hit", volume: number = 1): Promise<boolean> {
        return this.callAudio("playSFX", [path, { sessionId, volume }]);
    }

    /** Opens the platform-owned pause/settings/quit surface when a host is present. */
    public openPlatformMenu(): Promise<boolean> {
        const builda = this.getBuilda();
        if (!builda || !builda.runtime || typeof builda.runtime.quit !== "function") {
            return Promise.resolve(false);
        }
        try {
            return Promise.resolve(builda.runtime.quit())
                .then((result: any) => !result || result.ok !== false)
                .catch((error: unknown) => {
                    console.warn("[BuildaAdapter] runtime.quit failed", error);
                    return false;
                });
        } catch (error) {
            console.warn("[BuildaAdapter] runtime.quit threw", error);
            return Promise.resolve(false);
        }
    }

    private callAudio(method: string, args: any[]): Promise<boolean> {
        const builda = this.getBuilda();
        if (!builda || !builda.audio || typeof builda.audio[method] !== "function") {
            return Promise.resolve(false);
        }
        return this.callHostAudio(builda, method, args);
    }

    private callHostAudio(builda: any, method: string, args: any[]): Promise<boolean> {
        try {
            return Promise.resolve(builda.audio[method].apply(builda.audio, args))
                .then((result: any) => !!result && result.ok === true)
                .catch((error: unknown) => {
                    console.warn("[BuildaAdapter] audio." + method + " failed", error);
                    return false;
                });
        } catch (error) {
            console.warn("[BuildaAdapter] audio." + method + " threw", error);
            return Promise.resolve(false);
        }
    }

    private hasHostBgm(builda: any): boolean {
        return !!builda
            && !!builda.audio
            && typeof builda.audio.playBGM === "function"
            && typeof builda.audio.stopBGM === "function";
    }

    private playFallbackBGM(
        path: string,
        loop: boolean,
        volume: number,
        builda: any
    ): Promise<boolean> {
        const normalizedPath = typeof path === "string" ? path.trim() : "";
        const AudioConstructor = this.getAudioConstructor();
        if (!normalizedPath || !AudioConstructor) {
            return Promise.resolve(false);
        }

        this.stopFallbackBGM();
        const operationId = ++this.fallbackBgmOperationId;
        const url = this.resolveFallbackAudioUrl(normalizedPath, builda);
        let audio: HTMLAudioElement | null = null;
        try {
            audio = new AudioConstructor(url);
            audio.preload = "auto";
            audio.loop = !!loop;
            audio.volume = this.normalizedVolume(volume);
            this.fallbackBgm = audio;

            audio.onerror = (): void => {
                if (this.fallbackBgm !== audio || operationId !== this.fallbackBgmOperationId) {
                    return;
                }
                console.warn("[BuildaAdapter] browser BGM failed to load", url);
                this.fallbackBgm = null;
                this.fallbackBgmOperationId += 1;
                this.releaseFallbackAudio(audio as HTMLAudioElement);
            };
            audio.onended = (): void => {
                if (this.fallbackBgm !== audio || operationId !== this.fallbackBgmOperationId) {
                    return;
                }
                this.fallbackBgm = null;
                this.fallbackBgmOperationId += 1;
                this.releaseFallbackAudio(audio as HTMLAudioElement);
            };

            if (typeof audio.play !== "function") {
                this.fallbackBgm = null;
                this.fallbackBgmOperationId += 1;
                this.releaseFallbackAudio(audio);
                return Promise.resolve(false);
            }
            const playResult = audio.play();
            return Promise.resolve(playResult).then(
                () => {
                    if (this.fallbackBgm !== audio || operationId !== this.fallbackBgmOperationId) {
                        return false;
                    }
                    return true;
                },
                (error: unknown) => {
                    if (this.fallbackBgm !== audio || operationId !== this.fallbackBgmOperationId) {
                        return false;
                    }
                    console.warn("[BuildaAdapter] browser BGM play failed", error);
                    this.fallbackBgm = null;
                    this.fallbackBgmOperationId += 1;
                    this.releaseFallbackAudio(audio as HTMLAudioElement);
                    return false;
                }
            );
        } catch (error) {
            if (audio) {
                if (this.fallbackBgm === audio) {
                    this.fallbackBgm = null;
                    this.fallbackBgmOperationId += 1;
                }
                this.releaseFallbackAudio(audio);
            }
            console.warn("[BuildaAdapter] browser BGM threw", error);
            return Promise.resolve(false);
        }
    }

    private stopFallbackBGM(): boolean {
        this.fallbackBgmOperationId += 1;
        const audio = this.fallbackBgm;
        this.fallbackBgm = null;
        return audio ? this.releaseFallbackAudio(audio) : true;
    }

    private releaseFallbackAudio(audio: HTMLAudioElement): boolean {
        let paused = true;
        audio.onerror = null;
        audio.onended = null;
        try {
            audio.pause();
        } catch (error) {
            paused = false;
            console.warn("[BuildaAdapter] browser BGM pause failed", error);
        }
        try {
            audio.currentTime = 0;
        } catch (_error) {
            // currentTime can reject before metadata has loaded; pause is the stop boundary.
        }
        try {
            audio.removeAttribute("src");
            audio.load();
        } catch (_error) {
            // Old WebViews may not expose the full media cleanup surface.
        }
        return paused;
    }

    private resolveFallbackAudioUrl(path: string, builda: any): string {
        try {
            if (builda && builda.assets && typeof builda.assets.url === "function") {
                const hostedUrl = builda.assets.url(path);
                if (typeof hostedUrl === "string" && hostedUrl.trim()) {
                    return hostedUrl.trim();
                }
            }
        } catch (error) {
            console.warn("[BuildaAdapter] assets.url failed; using browser-relative BGM path", error);
        }

        const browserWindow: any = typeof window !== "undefined" ? window : null;
        const baseUrl = typeof document !== "undefined" && document.baseURI
            ? document.baseURI
            : browserWindow && browserWindow.location && browserWindow.location.href;
        const UrlConstructor: any = browserWindow && typeof browserWindow.URL === "function"
            ? browserWindow.URL
            : typeof URL === "function" ? URL : null;
        if (baseUrl && UrlConstructor) {
            try {
                return new UrlConstructor(path, baseUrl).toString();
            } catch (_error) {
                // Native Audio still accepts a relative path if URL parsing is unavailable.
            }
        }
        return path;
    }

    private normalizedVolume(value: number): number {
        return typeof value === "number" && isFinite(value)
            ? Math.max(0, Math.min(1, value))
            : 1;
    }

    private getAudioConstructor(): (new (src?: string) => HTMLAudioElement) | null {
        if (typeof window === "undefined" || typeof (window as any).Audio !== "function") {
            return null;
        }
        return (window as any).Audio;
    }

    private getBuilda(): any {
        return typeof window !== "undefined" ? (window as any).Builda : null;
    }
}
