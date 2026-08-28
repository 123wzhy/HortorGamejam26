export type DancerAnimationState = "idle" | "dance" | "result";

const BUNDLE_NAME = "dancer";
const DANCER_GROUP_NAME = "dancer";
const HUD_GROUP_NAME = "hud";
const PREFAB_NAME = "BullDancer";
const MODEL_SCALE = 216;
const MODEL_Y_OFFSET = -311;
const JOINT_MATRIX_FLOAT_COUNT = 54 * 16;

const STATE_CLIPS: { [key: string]: string } = {
    idle: "IdleSway",
    dance: "DanceCombo",
    result: "ResultPose"
};

/**
 * Loads and owns the optional 3D dancer without participating in gameplay
 * readiness. Every failure leaves the synchronous Graphics dancer visible.
 */
export class DancerAnimationController {
    private readonly container: cc.Node;
    private fallback: cc.Graphics | null;
    private bundle: cc.AssetManager.Bundle | null = null;
    private modelNode: cc.Node | null = null;
    private lightNode: cc.Node | null = null;
    private cameraNode: cc.Node | null = null;
    private hudCameraNode: cc.Node | null = null;
    private primaryCamera: cc.Camera | null = null;
    private primaryCameraMask: number | null = null;
    private renderer: cc.SkinnedMeshRenderer | null = null;
    private animation: cc.SkeletonAnimation | null = null;
    private clips: { [key: string]: cc.SkeletonAnimationClip } = {};
    private desiredState: DancerAnimationState = "idle";
    private desiredDanceGroupIndex: number = 0;
    private desiredDanceGroupCount: number = 1;
    private desiredDanceElapsedMs: number = 0;
    private playingDanceSegmentKey: string = "";
    private playingState: DancerAnimationState | null = null;
    private initStarted: boolean = false;
    private loadFailed: boolean = false;
    private bundleReleased: boolean = false;
    private ready: boolean = false;
    private presented: boolean = false;
    private paused: boolean = false;
    private resultHeldAtEnd: boolean = false;
    private disposed: boolean = false;
    private firstFrameListenerActive: boolean = false;

    public constructor(container: cc.Node, fallback: cc.Graphics) {
        this.container = container;
        this.fallback = fallback;
    }

    /** Starts one non-blocking load; repeated calls are intentionally ignored. */
    public init(): void {
        if (this.initStarted || this.loadFailed || this.disposed) {
            return;
        }
        this.initStarted = true;
        try {
            cc.assetManager.loadBundle(
                BUNDLE_NAME,
                (bundleError: Error, bundle: cc.AssetManager.Bundle) => {
                    if (this.disposed || this.loadFailed) {
                        if (bundle) {
                            this.releaseBundle(bundle);
                        }
                        return;
                    }
                    if (bundleError || !bundle) {
                        if (bundle) {
                            this.bundle = bundle;
                        }
                        this.rollbackToFallback(
                            "[DancerAnimationController] dancer bundle failed to load",
                            bundleError
                        );
                        return;
                    }
                    this.bundleReleased = false;
                    this.bundle = bundle;
                    if (!cc.isValid(this.container)) {
                        this.rollbackToFallback(
                            "[DancerAnimationController] dancer container became invalid while loading"
                        );
                        return;
                    }
                    this.loadBundleAssets(bundle);
                }
            );
        } catch (error) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer bundle loading could not start",
                error
            );
        }
    }

    /**
     * Stores the requested state even while assets are pending. `restart`
     * rewinds an already active idle or result clip.
     */
    public setState(state: DancerAnimationState, restart: boolean = false): void {
        if (this.disposed) {
            return;
        }
        const changed = this.desiredState !== state;
        this.desiredState = state;
        if (this.ready && (changed || restart || this.playingState === null)) {
            this.applyDesiredState();
        }
    }

    /**
     * Requests one contiguous slice of DanceCombo. Repeated progress updates
     * keep pending async loads aligned without restarting an active slice.
     */
    public setDanceSegment(groupIndex: number, groupCount: number, elapsedMs: number = 0): void {
        if (this.disposed || !isFinite(groupIndex) || !isFinite(groupCount)
            || Math.floor(groupIndex) !== groupIndex || Math.floor(groupCount) !== groupCount
            || groupCount <= 0 || groupIndex < 0 || groupIndex >= groupCount) {
            return;
        }
        const segmentKey = groupIndex + "/" + groupCount;
        const segmentChanged = groupIndex !== this.desiredDanceGroupIndex
            || groupCount !== this.desiredDanceGroupCount;
        const stateChanged = this.desiredState !== "dance";
        this.desiredState = "dance";
        this.desiredDanceGroupIndex = groupIndex;
        this.desiredDanceGroupCount = groupCount;
        this.desiredDanceElapsedMs = isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
        if (this.ready && (stateChanged || segmentChanged || this.playingState !== "dance"
            || this.playingDanceSegmentKey !== segmentKey)) {
            this.applyDesiredState();
        }
    }

    public isReady(): boolean {
        return this.ready && this.presented && !!this.modelNode && cc.isValid(this.modelNode);
    }

    public pause(): void {
        if (this.disposed || this.paused) {
            return;
        }
        this.paused = true;
        if (this.animation && cc.isValid(this.animation.node)) {
            try {
                this.animation.pause();
            } catch (error) {
                this.rollbackToFallback(
                    "[DancerAnimationController] dancer animation failed to pause",
                    error
                );
            }
        }
    }

    public resume(): void {
        if (this.disposed || !this.paused) {
            return;
        }
        this.paused = false;
        if (this.animation && cc.isValid(this.animation.node) && !this.resultHeldAtEnd) {
            try {
                this.animation.resume();
            } catch (error) {
                this.rollbackToFallback(
                    "[DancerAnimationController] dancer animation failed to resume",
                    error
                );
            }
        }
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.releaseRuntimeResources(false);
        this.fallback = null;
    }

    private loadBundleAssets(bundle: cc.AssetManager.Bundle): void {
        let prefabs: cc.Prefab[] | null = null;
        let clips: cc.SkeletonAnimationClip[] | null = null;
        let failureMessage: string | null = null;
        let failureDetail: any;
        let completed = 0;
        let prefabSettled = false;
        let clipsSettled = false;
        // Both requests share one Bundle. Settle both before a failed rollback so
        // no later completion can repopulate assets after releaseAll/removeBundle.
        const finish = (): void => {
            completed += 1;
            if (completed < 2 || this.loadFailed || this.disposed) {
                return;
            }
            if (failureMessage) {
                this.rollbackToFallback(failureMessage, failureDetail);
                return;
            }
            this.finishLoading(prefabs || [], clips || []);
        };

        try {
            bundle.loadDir("", cc.Prefab, (prefabError: Error, loadedPrefabs: cc.Prefab[]) => {
                if (prefabSettled || this.disposed || this.loadFailed) {
                    return;
                }
                prefabSettled = true;
                if (prefabError) {
                    failureMessage = failureMessage
                        || "[DancerAnimationController] BullDancer Prefab failed to load";
                    failureDetail = failureDetail || prefabError;
                } else {
                    prefabs = loadedPrefabs || [];
                }
                finish();
            });
            bundle.loadDir(
                "",
                cc.SkeletonAnimationClip,
                (clipError: Error, loadedClips: cc.SkeletonAnimationClip[]) => {
                    if (clipsSettled || this.disposed || this.loadFailed) {
                        return;
                    }
                    clipsSettled = true;
                    if (clipError) {
                        failureMessage = failureMessage
                            || "[DancerAnimationController] skeleton clips failed to load";
                        failureDetail = failureDetail || clipError;
                    } else {
                        clips = loadedClips || [];
                    }
                    finish();
                }
            );
        } catch (error) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer bundle asset loading could not start",
                error
            );
        }
    }

    private finishLoading(prefabs: cc.Prefab[], loadedClips: cc.SkeletonAnimationClip[]): void {
        if (this.disposed || this.loadFailed) {
            return;
        }
        try {
            this.finishLoadingAssets(prefabs, loadedClips);
        } catch (error) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer assets failed to initialize",
                error
            );
        }
    }

    private finishLoadingAssets(prefabs: cc.Prefab[], loadedClips: cc.SkeletonAnimationClip[]): void {
        if (!cc.isValid(this.container)) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer container became invalid while initializing"
            );
            return;
        }
        const prefab = prefabs.filter((item) => this.normalizedAssetName(item.name) === PREFAB_NAME)[0]
            || (prefabs.length === 1 ? prefabs[0] : null);
        if (!prefab) {
            this.rollbackToFallback(
                "[DancerAnimationController] BullDancer Prefab is missing from dancer bundle"
            );
            return;
        }

        const clipsByName: { [key: string]: cc.SkeletonAnimationClip } = {};
        loadedClips.forEach((clip) => {
            clipsByName[this.normalizedAssetName(clip.name)] = clip;
        });
        const missingClips = Object.keys(STATE_CLIPS).map((state) => STATE_CLIPS[state])
            .filter((name) => !clipsByName[name]);
        if (missingClips.length > 0) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer clips are missing: " + missingClips.join(", ")
            );
            return;
        }
        let modelNode: cc.Node;
        try {
            modelNode = cc.instantiate(prefab) as cc.Node;
        } catch (error) {
            this.rollbackToFallback(
                "[DancerAnimationController] BullDancer Prefab failed to instantiate",
                error
            );
            return;
        }
        this.modelNode = modelNode;
        if (this.disposed || this.loadFailed) {
            this.destroyOwnedNode(modelNode, "model");
            this.modelNode = null;
            return;
        }
        if (!cc.isValid(this.container)) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer container became invalid after instantiation"
            );
            return;
        }
        modelNode.name = "BullDancerRuntime";
        modelNode.setPosition(0, MODEL_Y_OFFSET, 0);
        modelNode.scale = MODEL_SCALE;

        const groupList = (cc.game as any).groupList as string[];
        const groupIndex = groupList ? groupList.indexOf(DANCER_GROUP_NAME) : -1;
        const hudGroupIndex = groupList ? groupList.indexOf(HUD_GROUP_NAME) : -1;
        if (groupIndex <= 0 || hudGroupIndex <= 0) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer or hud render group is unavailable"
            );
            return;
        }
        modelNode.groupIndex = groupIndex;

        const animation = modelNode.getComponent(cc.SkeletonAnimation)
            || modelNode.getComponentInChildren(cc.SkeletonAnimation);
        const renderer = modelNode.getComponent(cc.SkinnedMeshRenderer)
            || modelNode.getComponentInChildren(cc.SkinnedMeshRenderer);
        if (!animation || !renderer) {
            this.rollbackToFallback(
                "[DancerAnimationController] BullDancer Prefab is missing SkeletonAnimation"
                + " or SkinnedMeshRenderer"
            );
            return;
        }

        this.renderer = renderer;
        this.animation = animation;
        this.clips = clipsByName;
        try {
            Object.keys(STATE_CLIPS).forEach((state) => {
                const clipName = STATE_CLIPS[state];
                animation.addClip(clipsByName[clipName], clipName);
            });
        } catch (error) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer clips failed to attach",
                error
            );
            return;
        }
        if (!this.createDirectPresentation(modelNode, groupIndex, hudGroupIndex)) {
            return;
        }
        this.ready = true;
        if (!this.applyDesiredState()) {
            return;
        }
        this.firstFrameListenerActive = true;
        try {
            cc.director.on(cc.Director.EVENT_AFTER_DRAW, this.onFirstRenderedFrame, this);
        } catch (error) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer first-frame gate failed to attach",
                error
            );
        }
    }

    private createDirectPresentation(
        modelNode: cc.Node,
        groupIndex: number,
        hudGroupIndex: number
    ): boolean {
        const mainCamera = cc.Camera.main;
        const scene = cc.director.getScene();
        if (!mainCamera || !cc.isValid(mainCamera.node) || !mainCamera.node.parent
            || !scene || !cc.isValid(scene) || !cc.isValid(this.container)) {
            this.rollbackToFallback(
                "[DancerAnimationController] main camera or active scene is unavailable"
            );
            return false;
        }

        this.primaryCamera = mainCamera;
        this.primaryCameraMask = mainCamera.cullingMask;
        try {
            const cameraNode = new cc.Node("DancerOverlayCamera");
            this.cameraNode = cameraNode;
            const hudCameraNode = new cc.Node("DancerHudCamera");
            this.hudCameraNode = hudCameraNode;
            const lightNode = new cc.Node("DancerAmbientLight");
            this.lightNode = lightNode;
            modelNode.parent = this.container;
            modelNode.groupIndex = groupIndex;

            lightNode.parent = scene;
            const light = lightNode.addComponent(cc.Light) as any;
            const LightClass = cc.Light as any;
            light.type = LightClass.Type && typeof LightClass.Type.AMBIENT === "number"
                ? LightClass.Type.AMBIENT
                : 3;
            light.color = cc.Color.WHITE;
            light.intensity = 1;

            cameraNode.is3DNode = mainCamera.node.is3DNode;
            cameraNode.parent = mainCamera.node.parent;
            cameraNode.setPosition(mainCamera.node.x, mainCamera.node.y, mainCamera.node.z);
            cameraNode.eulerAngles = mainCamera.node.eulerAngles;
            cameraNode.scaleX = mainCamera.node.scaleX;
            cameraNode.scaleY = mainCamera.node.scaleY;
            cameraNode.scaleZ = mainCamera.node.scaleZ;

            hudCameraNode.is3DNode = mainCamera.node.is3DNode;
            hudCameraNode.parent = mainCamera.node.parent;
            hudCameraNode.setPosition(mainCamera.node.x, mainCamera.node.y, mainCamera.node.z);
            hudCameraNode.eulerAngles = mainCamera.node.eulerAngles;
            hudCameraNode.scaleX = mainCamera.node.scaleX;
            hudCameraNode.scaleY = mainCamera.node.scaleY;
            hudCameraNode.scaleZ = mainCamera.node.scaleZ;

            const camera = cameraNode.addComponent(cc.Camera);
            camera.ortho = mainCamera.ortho;
            camera.orthoSize = mainCamera.orthoSize;
            camera.nearClip = mainCamera.nearClip;
            camera.farClip = mainCamera.farClip;
            camera.rect = mainCamera.rect;
            camera.alignWithScreen = mainCamera.alignWithScreen;
            camera.renderStages = mainCamera.renderStages;
            camera.depth = mainCamera.depth + 1;
            camera.clearFlags = cc.Camera.ClearFlags.DEPTH | cc.Camera.ClearFlags.STENCIL;
            camera.cullingMask = 1 << groupIndex;

            const hudCamera = hudCameraNode.addComponent(cc.Camera);
            hudCamera.ortho = mainCamera.ortho;
            hudCamera.orthoSize = mainCamera.orthoSize;
            hudCamera.nearClip = mainCamera.nearClip;
            hudCamera.farClip = mainCamera.farClip;
            hudCamera.rect = mainCamera.rect;
            hudCamera.alignWithScreen = mainCamera.alignWithScreen;
            hudCamera.renderStages = mainCamera.renderStages;
            hudCamera.depth = mainCamera.depth + 2;
            hudCamera.clearFlags = cc.Camera.ClearFlags.DEPTH | cc.Camera.ClearFlags.STENCIL;
            hudCamera.cullingMask = 1 << hudGroupIndex;

            mainCamera.cullingMask = mainCamera.cullingMask
                & ~(1 << groupIndex)
                & ~(1 << hudGroupIndex);
            return true;
        } catch (error) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer overlay camera failed",
                error
            );
            return false;
        }
    }

    private onFirstRenderedFrame(): void {
        if (this.disposed || this.loadFailed || this.presented || !this.ready) {
            return;
        }
        if (!cc.isValid(this.container)) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer container became invalid before first frame"
            );
            return;
        }
        if (!this.container.activeInHierarchy) {
            return;
        }
        if (!this.modelNode || !cc.isValid(this.modelNode)
            || !this.renderer || !cc.isValid(this.renderer.node)) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer model became invalid before first frame"
            );
            return;
        }
        if (!this.hasFiniteJointMatrices(this.renderer)) {
            this.rollbackToFallback(
                "[DancerAnimationController] first dancer frame has invalid joint data"
            );
            return;
        }
        this.detachFirstFrameListener();
        if (this.fallback && cc.isValid(this.fallback.node)) {
            try {
                this.fallback.enabled = false;
            } catch (error) {
                this.rollbackToFallback(
                    "[DancerAnimationController] 2D fallback failed to hide",
                    error
                );
                return;
            }
        }
        this.presented = true;
        console.info("[DancerAnimationController] dancer first frame presented; 2D fallback disabled");
    }

    private hasFiniteJointMatrices(renderer: cc.SkinnedMeshRenderer): boolean {
        try {
            const internalRenderer = renderer as any;
            if (typeof internalRenderer.calcJointMatrix !== "function") {
                return false;
            }
            internalRenderer.calcJointMatrix();
            const matrices = internalRenderer._jointsFloat32Data as Float32Array;
            if (!matrices || matrices.length < JOINT_MATRIX_FLOAT_COUNT) {
                return false;
            }
            for (let index = 0; index < JOINT_MATRIX_FLOAT_COUNT; index += 1) {
                if (!isFinite(matrices[index])) {
                    return false;
                }
            }
            return true;
        } catch (_error) {
            return false;
        }
    }

    private applyDesiredState(): boolean {
        if (!this.animation || !cc.isValid(this.animation.node)) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer animation component became unavailable"
            );
            return false;
        }
        const clipName = STATE_CLIPS[this.desiredState];
        try {
            const state = this.animation.getAnimationState(clipName);
            if (!state) {
                this.rollbackToFallback(
                    "[DancerAnimationController] animation state is unavailable: " + clipName
                );
                return false;
            }
            this.animation.off("finished", this.onAnimationFinished, this);
            this.resultHeldAtEnd = false;
            const playsOnce = this.desiredState === "result" || this.desiredState === "dance";
            state.wrapMode = playsOnce ? cc.WrapMode.Normal : cc.WrapMode.Loop;
            state.repeatCount = playsOnce ? 1 : Number.POSITIVE_INFINITY;
            let startTimeSeconds = 0;
            if (this.desiredState === "dance") {
                const clip = this.clips[clipName];
                const groupCount = Math.max(1, this.desiredDanceGroupCount);
                const segmentDurationSeconds = clip.duration / groupCount;
                startTimeSeconds = clip.duration * this.desiredDanceGroupIndex / groupCount
                    + Math.min(segmentDurationSeconds, this.desiredDanceElapsedMs / 1000);
            }
            state.time = startTimeSeconds;
            this.animation.play(clipName, 0);
            if (startTimeSeconds > 0) {
                this.animation.setCurrentTime(startTimeSeconds, clipName);
                this.animation.sample(clipName);
            }
            this.playingState = this.desiredState;
            this.playingDanceSegmentKey = this.desiredState === "dance"
                ? this.desiredDanceGroupIndex + "/" + this.desiredDanceGroupCount
                : "";
            if (this.desiredState === "result") {
                this.animation.on("finished", this.onAnimationFinished, this);
            }
            if (this.paused) {
                this.animation.pause();
            }
            return true;
        } catch (error) {
            this.rollbackToFallback(
                "[DancerAnimationController] dancer animation state failed to apply",
                error
            );
            return false;
        }
    }

    private onAnimationFinished(): void {
        if (this.disposed || this.loadFailed
            || this.desiredState !== "result" || !this.animation) {
            return;
        }
        try {
            this.animation.off("finished", this.onAnimationFinished, this);
            const clipName = STATE_CLIPS.result;
            const clip = this.clips[clipName];
            if (clip && cc.isValid(this.animation.node)) {
                this.animation.setCurrentTime(clip.duration, clipName);
                this.animation.sample(clipName);
                this.animation.pause(clipName);
                this.resultHeldAtEnd = true;
            }
        } catch (error) {
            this.rollbackToFallback(
                "[DancerAnimationController] result pose failed to hold its final frame",
                error
            );
        }
    }

    private normalizedAssetName(name: string): string {
        return (name || "").replace(/\.(prefab|sac)$/i, "");
    }

    private rollbackToFallback(message: string, detail?: any): void {
        if (this.disposed || this.loadFailed) {
            return;
        }
        this.loadFailed = true;
        if (typeof detail === "undefined") {
            console.warn(message);
        } else {
            console.warn(message, detail);
        }
        this.releaseRuntimeResources(true);
    }

    private releaseRuntimeResources(enableFallback: boolean): void {
        this.ready = false;
        this.presented = false;
        const animation = this.animation;
        if (animation) {
            try {
                if (cc.isValid(animation.node)) {
                    animation.off("finished", this.onAnimationFinished, this);
                }
            } catch (error) {
                console.warn(
                    "[DancerAnimationController] dancer animation listener cleanup failed",
                    error
                );
            }
            try {
                if (cc.isValid(animation.node)) {
                    animation.stop();
                }
            } catch (error) {
                console.warn("[DancerAnimationController] dancer animation stop failed", error);
            }
        }
        this.detachFirstFrameListener();
        const primaryCamera = this.primaryCamera;
        const primaryCameraMask = this.primaryCameraMask;
        if (primaryCamera && primaryCameraMask !== null) {
            try {
                if (cc.isValid(primaryCamera.node)) {
                    primaryCamera.cullingMask = primaryCameraMask;
                }
            } catch (error) {
                console.warn("[DancerAnimationController] main camera mask restore failed", error);
            }
        }
        this.destroyOwnedNode(this.modelNode, "model");
        this.destroyOwnedNode(this.lightNode, "light");
        this.destroyOwnedNode(this.cameraNode, "camera");
        this.destroyOwnedNode(this.hudCameraNode, "HUD camera");
        const bundle = this.bundle;
        this.bundle = null;
        this.modelNode = null;
        this.lightNode = null;
        this.cameraNode = null;
        this.hudCameraNode = null;
        this.primaryCamera = null;
        this.primaryCameraMask = null;
        this.renderer = null;
        this.animation = null;
        this.clips = {};
        this.playingState = null;
        this.playingDanceSegmentKey = "";
        this.resultHeldAtEnd = false;
        const fallback = this.fallback;
        if (enableFallback && fallback) {
            try {
                if (cc.isValid(fallback.node)) {
                    fallback.enabled = true;
                }
            } catch (error) {
                console.warn("[DancerAnimationController] 2D fallback restore failed", error);
            }
        }
        if (bundle) {
            this.releaseBundle(bundle);
        }
    }

    private detachFirstFrameListener(): void {
        if (!this.firstFrameListenerActive) {
            return;
        }
        try {
            cc.director.off(cc.Director.EVENT_AFTER_DRAW, this.onFirstRenderedFrame, this);
            this.firstFrameListenerActive = false;
        } catch (error) {
            console.warn("[DancerAnimationController] first-frame listener cleanup failed", error);
        }
    }

    private destroyOwnedNode(node: cc.Node | null, label: string): void {
        if (!node) {
            return;
        }
        try {
            if (cc.isValid(node)) {
                node.destroy();
            }
        } catch (error) {
            console.warn("[DancerAnimationController] dancer " + label + " cleanup failed", error);
        }
    }

    private releaseBundle(bundle: cc.AssetManager.Bundle): void {
        if (this.bundleReleased) {
            return;
        }
        this.bundleReleased = true;
        try {
            bundle.releaseAll();
        } catch (error) {
            console.warn("[DancerAnimationController] dancer bundle releaseAll failed", error);
        }
        try {
            cc.assetManager.removeBundle(bundle);
        } catch (error) {
            console.warn("[DancerAnimationController] dancer bundle removal failed", error);
        }
    }
}
