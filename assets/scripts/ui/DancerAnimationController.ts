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
        if (this.initStarted || this.disposed) {
            return;
        }
        this.initStarted = true;
        cc.assetManager.loadBundle(BUNDLE_NAME, (bundleError: Error, bundle: cc.AssetManager.Bundle) => {
            if (this.disposed) {
                if (bundle) {
                    this.releaseBundle(bundle);
                }
                return;
            }
            if (bundleError || !bundle) {
                console.warn("[DancerAnimationController] dancer bundle failed to load", bundleError);
                return;
            }
            if (!cc.isValid(this.container)) {
                this.releaseBundle(bundle);
                return;
            }
            this.bundle = bundle;
            this.loadBundleAssets(bundle);
        });
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
            this.animation.pause();
        }
    }

    public resume(): void {
        if (this.disposed || !this.paused) {
            return;
        }
        this.paused = false;
        if (this.animation && cc.isValid(this.animation.node) && !this.resultHeldAtEnd) {
            this.animation.resume();
        }
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.ready = false;
        this.presented = false;
        if (this.animation && cc.isValid(this.animation.node)) {
            this.animation.off("finished", this.onAnimationFinished, this);
            this.animation.stop();
        }
        if (this.firstFrameListenerActive) {
            cc.director.off(cc.Director.EVENT_AFTER_DRAW, this.onFirstRenderedFrame, this);
            this.firstFrameListenerActive = false;
        }
        if (this.primaryCamera && this.primaryCameraMask !== null
            && cc.isValid(this.primaryCamera.node)) {
            this.primaryCamera.cullingMask = this.primaryCameraMask;
        }
        if (this.modelNode && cc.isValid(this.modelNode)) {
            this.modelNode.destroy();
        }
        if (this.lightNode && cc.isValid(this.lightNode)) {
            this.lightNode.destroy();
        }
        if (this.cameraNode && cc.isValid(this.cameraNode)) {
            this.cameraNode.destroy();
        }
        if (this.hudCameraNode && cc.isValid(this.hudCameraNode)) {
            this.hudCameraNode.destroy();
        }
        if (this.bundle) {
            this.releaseBundle(this.bundle);
        }
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
        this.fallback = null;
        this.playingState = null;
        this.playingDanceSegmentKey = "";
    }

    private loadBundleAssets(bundle: cc.AssetManager.Bundle): void {
        let prefabs: cc.Prefab[] | null = null;
        let clips: cc.SkeletonAnimationClip[] | null = null;
        let failed = false;
        let completed = 0;
        const finish = (): void => {
            completed += 1;
            if (completed < 2 || failed || this.disposed) {
                return;
            }
            this.finishLoading(prefabs || [], clips || []);
        };

        bundle.loadDir("", cc.Prefab, (prefabError: Error, loadedPrefabs: cc.Prefab[]) => {
            if (this.disposed) {
                return;
            }
            if (prefabError) {
                failed = true;
                console.warn("[DancerAnimationController] BullDancer Prefab failed to load", prefabError);
            } else {
                prefabs = loadedPrefabs || [];
            }
            finish();
        });
        bundle.loadDir(
            "",
            cc.SkeletonAnimationClip,
            (clipError: Error, loadedClips: cc.SkeletonAnimationClip[]) => {
                if (this.disposed) {
                    return;
                }
                if (clipError) {
                    failed = true;
                    console.warn("[DancerAnimationController] skeleton clips failed to load", clipError);
                } else {
                    clips = loadedClips || [];
                }
                finish();
            }
        );
    }

    private finishLoading(prefabs: cc.Prefab[], loadedClips: cc.SkeletonAnimationClip[]): void {
        if (this.disposed || !cc.isValid(this.container)) {
            return;
        }
        const prefab = prefabs.filter((item) => this.normalizedAssetName(item.name) === PREFAB_NAME)[0]
            || (prefabs.length === 1 ? prefabs[0] : null);
        if (!prefab) {
            console.warn("[DancerAnimationController] BullDancer Prefab is missing from dancer bundle");
            return;
        }

        const clipsByName: { [key: string]: cc.SkeletonAnimationClip } = {};
        loadedClips.forEach((clip) => {
            clipsByName[this.normalizedAssetName(clip.name)] = clip;
        });
        const missingClips = Object.keys(STATE_CLIPS).map((state) => STATE_CLIPS[state])
            .filter((name) => !clipsByName[name]);
        if (missingClips.length > 0) {
            console.warn(
                "[DancerAnimationController] dancer clips are missing: " + missingClips.join(", ")
            );
            return;
        }
        let modelNode: cc.Node;
        try {
            modelNode = cc.instantiate(prefab) as cc.Node;
        } catch (error) {
            console.warn("[DancerAnimationController] BullDancer Prefab failed to instantiate", error);
            return;
        }
        if (!cc.isValid(this.container) || this.disposed) {
            modelNode.destroy();
            return;
        }
        modelNode.name = "BullDancerRuntime";
        modelNode.setPosition(0, MODEL_Y_OFFSET, 0);
        modelNode.scale = MODEL_SCALE;

        const groupList = (cc.game as any).groupList as string[];
        const groupIndex = groupList ? groupList.indexOf(DANCER_GROUP_NAME) : -1;
        const hudGroupIndex = groupList ? groupList.indexOf(HUD_GROUP_NAME) : -1;
        if (groupIndex <= 0 || hudGroupIndex <= 0) {
            modelNode.destroy();
            console.warn("[DancerAnimationController] dancer or hud render group is unavailable");
            return;
        }
        modelNode.groupIndex = groupIndex;

        const animation = modelNode.getComponent(cc.SkeletonAnimation)
            || modelNode.getComponentInChildren(cc.SkeletonAnimation);
        const renderer = modelNode.getComponent(cc.SkinnedMeshRenderer)
            || modelNode.getComponentInChildren(cc.SkinnedMeshRenderer);
        if (!animation || !renderer) {
            modelNode.destroy();
            console.warn(
                "[DancerAnimationController] BullDancer Prefab is missing SkeletonAnimation"
                + " or SkinnedMeshRenderer"
            );
            return;
        }

        Object.keys(STATE_CLIPS).forEach((state) => {
            const clipName = STATE_CLIPS[state];
            animation.addClip(clipsByName[clipName], clipName);
        });
        if (!this.createDirectPresentation(modelNode, groupIndex, hudGroupIndex)) {
            modelNode.destroy();
            return;
        }
        this.modelNode = modelNode;
        this.renderer = renderer;
        this.animation = animation;
        this.clips = clipsByName;
        this.ready = true;
        this.applyDesiredState();
        cc.director.on(cc.Director.EVENT_AFTER_DRAW, this.onFirstRenderedFrame, this);
        this.firstFrameListenerActive = true;
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
            console.warn("[DancerAnimationController] main camera or active scene is unavailable");
            return false;
        }

        const cameraNode = new cc.Node("DancerOverlayCamera");
        const hudCameraNode = new cc.Node("DancerHudCamera");
        const lightNode = new cc.Node("DancerAmbientLight");
        let savedMask: number | null = null;
        try {
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

            savedMask = mainCamera.cullingMask;
            mainCamera.cullingMask = mainCamera.cullingMask
                & ~(1 << groupIndex)
                & ~(1 << hudGroupIndex);
            this.cameraNode = cameraNode;
            this.hudCameraNode = hudCameraNode;
            this.lightNode = lightNode;
            this.primaryCamera = mainCamera;
            this.primaryCameraMask = savedMask;
            return true;
        } catch (error) {
            if (savedMask !== null && cc.isValid(mainCamera.node)) {
                mainCamera.cullingMask = savedMask;
            }
            if (cc.isValid(cameraNode)) {
                cameraNode.destroy();
            }
            if (cc.isValid(hudCameraNode)) {
                hudCameraNode.destroy();
            }
            if (cc.isValid(lightNode)) {
                lightNode.destroy();
            }
            console.warn("[DancerAnimationController] dancer overlay camera failed", error);
            return false;
        }
    }

    private onFirstRenderedFrame(): void {
        if (this.disposed || this.presented || !this.ready || !this.modelNode
            || !cc.isValid(this.modelNode) || !this.renderer || !cc.isValid(this.renderer.node)
            || !cc.isValid(this.container) || !this.container.activeInHierarchy) {
            return;
        }
        if (this.firstFrameListenerActive) {
            cc.director.off(cc.Director.EVENT_AFTER_DRAW, this.onFirstRenderedFrame, this);
            this.firstFrameListenerActive = false;
        }
        if (!this.hasFiniteJointMatrices(this.renderer)) {
            this.ready = false;
            if (this.modelNode && cc.isValid(this.modelNode)) {
                this.modelNode.active = false;
            }
            if (this.fallback && cc.isValid(this.fallback.node)) {
                this.fallback.enabled = true;
            }
            console.warn("[DancerAnimationController] first dancer frame has invalid joint data");
            return;
        }
        this.presented = true;
        if (this.fallback && cc.isValid(this.fallback.node)) {
            this.fallback.enabled = false;
        }
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

    private applyDesiredState(): void {
        if (!this.animation || !cc.isValid(this.animation.node)) {
            return;
        }
        const clipName = STATE_CLIPS[this.desiredState];
        const state = this.animation.getAnimationState(clipName);
        if (!state) {
            console.warn("[DancerAnimationController] animation state is unavailable: " + clipName);
            return;
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
    }

    private onAnimationFinished(): void {
        if (this.disposed || this.desiredState !== "result" || !this.animation) {
            return;
        }
        this.animation.off("finished", this.onAnimationFinished, this);
        const clipName = STATE_CLIPS.result;
        const clip = this.clips[clipName];
        if (clip && cc.isValid(this.animation.node)) {
            this.animation.setCurrentTime(clip.duration, clipName);
            this.animation.sample(clipName);
            this.animation.pause(clipName);
            this.resultHeldAtEnd = true;
        }
    }

    private normalizedAssetName(name: string): string {
        return (name || "").replace(/\.(prefab|sac)$/i, "");
    }

    private releaseBundle(bundle: cc.AssetManager.Bundle): void {
        try {
            bundle.releaseAll();
            cc.assetManager.removeBundle(bundle);
        } catch (error) {
            console.warn("[DancerAnimationController] dancer bundle release failed", error);
        }
    }
}
