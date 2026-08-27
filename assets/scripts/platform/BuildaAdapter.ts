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

function nonNegative(value: unknown): number {
    return typeof value === "number" && isFinite(value) ? Math.max(0, value) : 0;
}

/** Thin platform boundary. Gameplay never reaches into the host bridge directly. */
export class BuildaAdapter {
    public ready(): Promise<void> {
        const builda = this.getBuilda();
        if (!builda || !builda.runtime || typeof builda.runtime.ready !== "function") {
            return Promise.resolve();
        }
        try {
            return Promise.resolve(builda.runtime.ready())
                .then(() => undefined)
                .catch((error: unknown) => {
                    console.warn("[BuildaAdapter] runtime.ready failed; continuing in fallback mode", error);
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
        return this.callAudio("playBGM", [path, { loop, volume }]);
    }

    public stopBGM(): Promise<boolean> {
        return this.callAudio("stopBGM", []);
    }

    public playSFX(path: string, key: string = "rhythm-hit", volume: number = 1): Promise<boolean> {
        return this.callAudio("playSFX", [path, { key, volume }]);
    }

    private callAudio(method: string, args: any[]): Promise<boolean> {
        const builda = this.getBuilda();
        if (!builda || !builda.audio || typeof builda.audio[method] !== "function") {
            return Promise.resolve(false);
        }
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

    private getBuilda(): any {
        return typeof window !== "undefined" ? (window as any).Builda : null;
    }
}
