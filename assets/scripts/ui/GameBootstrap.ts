import { Direction } from "../domain/Beatmap";
import { analyzeBeatmapDifficulty, MAX_DIFFICULTY_STARS } from "../domain/BeatmapDifficulty";
import {
    LocalLeaderboard,
    LocalLeaderboardPersistenceIssue,
    LocalLeaderboardStorage
} from "../domain/LocalLeaderboard";
import {
    beatmapNoteCount,
    createSongSessionConfig,
    DEMO_SONGS,
    resolveSongOutcome,
    SongDefinition,
    SongOutcome,
    SongSessionConfig
} from "../domain/SongCatalog";
import {
    GroupDanceFlow,
    GroupDanceSegment,
    GroupDanceTransition
} from "../gameplay/GroupDanceFlow";
import { GroupNoteStatus, EngineAction, SequenceEngine } from "../gameplay/SequenceEngine";
import { DEFAULT_JUDGE_WINDOWS, JudgeGrade, JudgeSystem } from "../gameplay/JudgeSystem";
import { noteApproachProgress, timelineProgress } from "../gameplay/TimingProgress";
import { InputRouter } from "../input/InputRouter";
import { BuildaAdapter, BuildaViewportMetrics, calculateRightAvoidance } from "../platform/BuildaAdapter";
import { SongClock } from "../timing/SongClock";
import { ArtAssetCatalog, ArtAssetName, REQUIRED_ART_ASSETS } from "./ArtAssetCatalog";
import { DancerAnimationController } from "./DancerAnimationController";
import {
    calculateMenuCardVerticalLayout,
    calculateMenuFooterVerticalLayout,
    calculateNoteChipVerticalLayout,
    calculateRhythmVerticalLayout
} from "./RhythmLayout";
import { SongPreviewController, SongPreviewSnapshot } from "./SongPreviewController";
import {
    canEnterGameplay,
    initialUiStartupState,
    markArtLoaded,
    markPlatformReady,
    startupStatusText,
    UiStartupState
} from "./UiStartupState";

const { ccclass } = cc._decorator;

const ARROW_TEXT: { [key: string]: string } = {
    left: "←",
    down: "↓",
    up: "↑",
    right: "→"
};

const GRADE_TEXT: { [key: string]: string } = {
    Perfect: "完美",
    Good: "好",
    Bad: "差",
    Miss: "失败"
};

const NOTE_APPROACH_MS = 1200;
const DIRECTIONS: Direction[] = ["left", "down", "up", "right"];
const SMALL_ARROW_ASPECT = 73 / 71;
const TOUCH_ARROW_ASPECT = 142 / 146;

function browserLocalLeaderboardStorage(): LocalLeaderboardStorage | null {
    try {
        if (typeof window === "undefined" || !window.localStorage) {
            return null;
        }
        const storage = window.localStorage;
        return typeof storage.getItem === "function" && typeof storage.setItem === "function"
            ? storage
            : null;
    } catch (_error) {
        return null;
    }
}

const DIRECTION_ART: { [key: string]: ArtAssetName } = {
    left: "leftArrow",
    down: "downArrow",
    up: "upArrow",
    right: "rightArrow"
};

const DIRECTION_TOUCH_ART: { [key: string]: ArtAssetName } = {
    left: "leftArrow2",
    down: "downArrow2",
    up: "upArrow2",
    right: "rightArrow2"
};

interface NoteChipView {
    node: cc.Node;
    card: cc.Graphics;
    miniBar: cc.Graphics;
    arrow: cc.Sprite;
    status: cc.Label;
    noteIndex: number;
    width: number;
    height: number;
}

interface SongRowView {
    node: cc.Node;
    idleBackground: cc.Sprite;
    selectedBackground: cc.Sprite;
    fallback: cc.Graphics;
    previewButton: cc.Node;
    title: cc.Label;
    stars: cc.Node[];
    songIndex: number;
}

@ccclass
export default class GameBootstrap extends cc.Component {
    private readonly adapter: BuildaAdapter = new BuildaAdapter();
    private readonly art: ArtAssetCatalog = new ArtAssetCatalog();
    private readonly songPreview: SongPreviewController = new SongPreviewController(this.adapter);
    private readonly clock: SongClock = new SongClock();
    private readonly judge: JudgeSystem = new JudgeSystem();
    private activeSong: SongDefinition = DEMO_SONGS[0];
    private activeSession: SongSessionConfig = createSongSessionConfig(
        this.activeSong,
        DEFAULT_JUDGE_WINDOWS.badMs
    );
    private engine: SequenceEngine = new SequenceEngine(this.activeSession.beatmap, this.judge);
    private danceFlow: GroupDanceFlow = new GroupDanceFlow(
        this.activeSession.groupCount,
        this.activeSession.danceDurationMs
    );
    private readonly leaderboard: LocalLeaderboard = new LocalLeaderboard(browserLocalLeaderboardStorage());
    private songDurationMs: number = this.activeSession.songDurationMs;
    private input: InputRouter | null = null;

    private root: cc.Node = null;
    private backgroundNode: cc.Node = null;
    private backgroundSpriteNode: cc.Node = null;
    private backgroundSprite: cc.Sprite = null;
    private backgroundFallback: cc.Graphics = null;
    private menuRoot: cc.Node = null;
    private gameRoot: cc.Node = null;
    private menuLogo: cc.Node = null;
    private gameLogo: cc.Node = null;
    private menuStartButton: cc.Node = null;
    private menuTopButtons: cc.Node[] = [];
    private menuTaskPanel: cc.Node = null;
    private menuTaskArtwork: cc.Node = null;
    private menuTaskGraphics: cc.Graphics = null;
    private menuTaskTitle: cc.Label = null;
    private menuTaskLabel: cc.Label = null;
    private menuSongPanel: cc.Node = null;
    private menuSongArtwork: cc.Node = null;
    private menuSongGraphics: cc.Graphics = null;
    private menuSongTitle: cc.Label = null;
    private menuSongRowsRoot: cc.Node = null;
    private menuSongRows: SongRowView[] = [];
    private menuSongStatusLabel: cc.Label = null;
    private menuHintRow: cc.Node = null;
    private menuHintArrows: cc.Node[] = [];
    private menuStatusLabel: cc.Label = null;
    private infoOverlay: cc.Node = null;
    private infoBackdrop: cc.Graphics = null;
    private infoPanel: cc.Graphics = null;
    private infoTitle: cc.Label = null;
    private infoBody: cc.Label = null;
    private stage: cc.Graphics = null;
    private dancerNode: cc.Node = null;
    private dancerFallback: cc.Graphics = null;
    private dancerController: DancerAnimationController | null = null;
    private groupPanel: cc.Graphics = null;
    private sequenceRow: cc.Node = null;
    private globalTimeline: cc.Graphics = null;
    private scoreLabel: cc.Label = null;
    private comboLabel: cc.Label = null;
    private levelLabel: cc.Label = null;
    private trackLabel: cc.Label = null;
    private hostLabel: cc.Label = null;
    private judgementLabel: cc.Label = null;
    private groupLabel: cc.Label = null;
    private progressLabel: cc.Label = null;
    private instructionLabel: cc.Label = null;
    private directionPad: cc.Node = null;
    private restartButton: cc.Node = null;
    private homeButton: cc.Node = null;
    private directionButtons: cc.Node[] = [];
    private noteChipViews: NoteChipView[] = [];

    private viewportWidth: number = 1280;
    private viewportHeight: number = 720;
    private panelWidth: number = 1000;
    private panelHeight: number = 174;
    private stageBaseY: number = 92;
    private dancerBaseScale: number = 1;
    private stageVisible: boolean = true;
    private globalBarWidth: number = 900;
    private metrics: BuildaViewportMetrics = {
        safe: { top: 0, right: 0, bottom: 0, left: 0 },
        capsule: { top: 0, right: 0, width: 0, height: 0 },
        hosted: false
    };
    private startupState: UiStartupState = initialUiStartupState();
    private menuCardsHiddenForSafeArea: boolean = false;
    private selectedSongIndex: number = 0;
    private uiReady: boolean = false;
    private gameplayActive: boolean = false;
    private gameplayStartPending: boolean = false;
    private gameplayStartRequestId: number = 0;
    private pausedByHost: boolean = false;
    private clockHeldForDanceFlow: boolean = false;
    private hostSuspended: boolean = false;
    private completionRecordedForRun: boolean = false;
    private currentOutcome: SongOutcome | null = null;
    private groupRenderKey: string = "";
    private heldGroupIndex: number = -1;
    private lastResultText: string = "等待第一键";
    private lastResultColor: cc.Color = null;
    private messageExpiresAtMs: number = 0;
    private resizeHandler: (() => void) | null = null;
    private visibilityHandler: (() => void) | null = null;
    private pageHideHandler: (() => void) | null = null;
    private pageShowHandler: (() => void) | null = null;
    private blurHandler: (() => void) | null = null;

    protected onLoad(): void {
        cc.game.setFrameRate(60);
        cc.view.resizeWithBrowserSize(true);
        this.lastResultColor = cc.color(255, 207, 82);
        cc.game.on(cc.game.EVENT_HIDE, this.onGameHide, this);
        cc.game.on(cc.game.EVENT_SHOW, this.onGameShow, this);

        if (typeof window !== "undefined") {
            this.resizeHandler = this.onWindowResize.bind(this);
            this.pageHideHandler = this.pauseForHost.bind(this);
            this.pageShowHandler = this.resumeFromHostIfVisible.bind(this);
            this.blurHandler = this.onWindowBlur.bind(this);
            window.addEventListener("resize", this.resizeHandler);
            window.addEventListener("pagehide", this.pageHideHandler);
            window.addEventListener("pageshow", this.pageShowHandler);
            window.addEventListener("blur", this.blurHandler);
        }
        if (typeof document !== "undefined") {
            this.visibilityHandler = this.onVisibilityChange.bind(this);
            document.addEventListener("visibilitychange", this.visibilityHandler);
        }

        this.initializeUi();
    }

    private initializeUi(): void {
        this.buildUi();
        this.dancerController = new DancerAnimationController(this.dancerNode, this.dancerFallback);
        this.dancerController.init();
        this.input = new InputRouter(
            (direction) => this.onDirection(direction),
            () => this.restartGame()
        );
        this.input.attach();
        this.uiReady = true;
        this.layout();
        this.showMenu();
        this.refreshStartupStatus();
        if (this.isDocumentHidden()) {
            this.pauseForHost();
        }

        this.art.load().then((missing) => {
            if (!cc.isValid(this.node)) {
                return;
            }
            this.startupState = markArtLoaded(this.startupState, missing.length);
            this.applyLoadedArt();
            this.layout();
            this.refreshStartupStatus();
        }).catch((error: unknown) => {
            console.error("[GameBootstrap] unexpected art load failure", error);
            if (!cc.isValid(this.node)) {
                return;
            }
            this.startupState = markArtLoaded(this.startupState, REQUIRED_ART_ASSETS.length);
            this.applyLoadedArt();
            this.layout();
            this.refreshStartupStatus();
        });

        this.adapter.ready().then(() => {
            if (!cc.isValid(this.node)) {
                return;
            }
            this.startupState = markPlatformReady(this.startupState);
            this.layout();
            this.refreshStartupStatus();
        });
    }

    private applyLoadedArt(): void {
        this.backgroundSprite.spriteFrame = this.art.get("BackGround");
        this.applySpriteFrame(this.menuLogo, this.art.get("logo"));
        this.applySpriteFrame(this.gameLogo, this.art.get("logo"));
        this.applyButtonFrame(this.menuStartButton, this.art.get("startBtn"));
        ["settingBtn", "rankBtn", "helpBtn"].forEach((name, index) => {
            this.applyButtonFrame(this.menuTopButtons[index], this.art.get(name as ArtAssetName));
        });
        DIRECTIONS.forEach((direction, index) => {
            this.applySpriteFrame(this.menuHintArrows[index], this.art.get(DIRECTION_ART[direction]));
            this.applyButtonFrame(this.directionButtons[index], this.art.get(DIRECTION_TOUCH_ART[direction]));
        });
        this.applyArtworkFrame(this.menuTaskArtwork, this.art.get("todayTaskPanel"));
        this.applyArtworkFrame(this.menuSongArtwork, this.art.get("songSelectPanel"));
        this.menuSongRows.forEach((view) => this.bindSongRowBackgroundFrames(view));
        this.refreshSongRows();
        this.groupRenderKey = "";
    }

    private refreshStartupStatus(): void {
        if (this.menuStatusLabel) {
            this.menuStatusLabel.string = startupStatusText(
                this.startupState,
                this.menuCardsHiddenForSafeArea
            );
        }
    }

    protected onDestroy(): void {
        this.cancelPendingGameplayStart();
        this.songPreview.stop();
        if (this.dancerController) {
            this.dancerController.dispose();
            this.dancerController = null;
        }
        if (this.input) {
            this.input.detach();
        }
        cc.game.off(cc.game.EVENT_HIDE, this.onGameHide, this);
        cc.game.off(cc.game.EVENT_SHOW, this.onGameShow, this);
        if (typeof window !== "undefined") {
            if (this.resizeHandler) {
                window.removeEventListener("resize", this.resizeHandler);
            }
            if (this.pageHideHandler) {
                window.removeEventListener("pagehide", this.pageHideHandler);
            }
            if (this.pageShowHandler) {
                window.removeEventListener("pageshow", this.pageShowHandler);
            }
            if (this.blurHandler) {
                window.removeEventListener("blur", this.blurHandler);
            }
        }
        if (typeof document !== "undefined" && this.visibilityHandler) {
            document.removeEventListener("visibilitychange", this.visibilityHandler);
        }
    }

    protected update(deltaSeconds: number): void {
        if (!this.gameplayActive || !canEnterGameplay(this.startupState) || this.hostSuspended) {
            return;
        }

        const danceSnapshot = this.danceFlow.getSnapshot();
        if (danceSnapshot.phase === "dance") {
            this.updateDanceInterlude(deltaSeconds);
            return;
        }
        if (danceSnapshot.phase === "result"
            || !this.clock.isStarted() || this.clock.isPaused()) {
            return;
        }

        const songTimeMs = this.clock.currentTimeMs();
        this.presentActions(this.engine.update(songTimeMs), songTimeMs);
        if (this.danceFlow.getSnapshot().phase === "dance") {
            this.refreshStats();
            return;
        }
        this.renderGroup(songTimeMs);
        this.updateNoteChips(songTimeMs);
        this.updateGlobalTimeline(songTimeMs);
        this.updateStage(songTimeMs);
        this.refreshStats();

        if (this.messageExpiresAtMs > 0 && songTimeMs > this.messageExpiresAtMs) {
            this.restoreLastResult();
        }
    }

    private buildUi(): void {
        this.node.removeAllChildren();
        this.menuTopButtons = [];
        this.menuHintArrows = [];
        this.menuSongRows = [];
        this.directionButtons = [];
        this.noteChipViews = [];
        const dancerGroupIndex = this.renderGroupIndex("dancer");
        const hudGroupIndex = this.renderGroupIndex("hud");
        this.root = new cc.Node("RhythmUI");
        this.root.parent = this.node;

        this.backgroundNode = new cc.Node("Background");
        this.backgroundNode.parent = this.root;
        const backgroundFallbackNode = new cc.Node("BackgroundFallback");
        backgroundFallbackNode.parent = this.backgroundNode;
        this.backgroundFallback = backgroundFallbackNode.addComponent(cc.Graphics);
        this.backgroundSpriteNode = new cc.Node("BackgroundArtwork");
        this.backgroundSpriteNode.parent = this.backgroundNode;
        this.backgroundSprite = this.backgroundSpriteNode.addComponent(cc.Sprite);
        this.backgroundSprite.sizeMode = cc.Sprite.SizeMode.RAW;
        this.backgroundSprite.spriteFrame = this.art.get("BackGround");

        this.gameRoot = new cc.Node("Gameplay");
        this.gameRoot.parent = this.root;
        this.assignRenderGroup(this.gameRoot, hudGroupIndex);
        this.menuRoot = new cc.Node("MainMenu");
        this.menuRoot.parent = this.root;
        this.assignRenderGroup(this.menuRoot, hudGroupIndex);

        this.menuLogo = this.makeSpriteNode(
            this.menuRoot,
            "MenuLogo",
            this.art.get("logo"),
            420,
            420 * 214 / 320,
            "劲舞牛"
        );
        this.gameLogo = this.makeSpriteNode(this.gameRoot, "GameLogo", this.art.get("logo"), 320, 214, "牛来");
        this.menuTopButtons = [
            this.makeSpriteButton(
                this.menuRoot,
                "PlatformSettings",
                this.art.get("settingBtn"),
                181,
                84,
                "设置",
                () => this.openPlatformSettings()
            ),
            this.makeSpriteButton(
                this.menuRoot,
                "RankInfo",
                this.art.get("rankBtn"),
                226,
                84,
                "排行榜",
                () => this.showRankInfo()
            ),
            this.makeSpriteButton(
                this.menuRoot,
                "Help",
                this.art.get("helpBtn"),
                181,
                84,
                "帮助",
                () => this.showHelp()
            )
        ];
        this.menuStartButton = this.makeSpriteButton(
            this.menuRoot,
            "StartDance",
            this.art.get("startBtn"),
            527,
            145,
            "开始跳舞",
            () => this.startGame()
        );

        this.menuTaskPanel = new cc.Node("TodayTaskPanel");
        this.menuTaskPanel.parent = this.menuRoot;
        this.menuTaskGraphics = this.menuTaskPanel.addComponent(cc.Graphics);
        this.menuTaskArtwork = this.makeArtworkNode(
            this.menuTaskPanel,
            "TodayTaskArtwork",
            this.art.get("todayTaskPanel")
        );
        this.menuTaskTitle = this.makeLabel(
            this.menuTaskPanel,
            "TodayTaskFallbackTitle",
            "今日目标",
            20,
            cc.color(255, 183, 55)
        );
        this.menuTaskLabel = this.makeLabel(
            this.menuTaskPanel,
            "TodayTaskText",
            "·  完成 3 组舞步        0/3\n"
            + "·  获得 8000 分      0/8000\n"
            + "·  连击达到 10 次    0/10",
            16,
            cc.color(255, 239, 204)
        );
        this.menuTaskLabel.horizontalAlign = cc.Label.HorizontalAlign.LEFT;

        this.menuSongPanel = new cc.Node("SongPanel");
        this.menuSongPanel.parent = this.menuRoot;
        this.menuSongGraphics = this.menuSongPanel.addComponent(cc.Graphics);
        this.menuSongArtwork = this.makeArtworkNode(
            this.menuSongPanel,
            "SongPanelArtwork",
            this.art.get("songSelectPanel")
        );
        this.menuSongTitle = this.makeLabel(
            this.menuSongPanel,
            "SongFallbackTitle",
            "选择歌曲",
            20,
            cc.color(255, 183, 55)
        );
        this.menuSongRowsRoot = new cc.Node("SongRows");
        this.menuSongRowsRoot.parent = this.menuSongPanel;
        DEMO_SONGS.forEach((_song, songIndex) => {
            this.menuSongRows.push(this.makeSongRow(this.menuSongRowsRoot, songIndex));
        });
        this.menuSongStatusLabel = this.makeLabel(
            this.menuSongPanel,
            "SongPreviewStatus",
            "黄底为当前选择 · 左侧可试听",
            11,
            cc.color(238, 220, 183)
        );
        this.refreshSongRows();

        this.menuHintRow = new cc.Node("ControlHint");
        this.menuHintRow.parent = this.menuRoot;
        DIRECTIONS.forEach((direction, index) => {
            const arrow = this.makeSpriteNode(
                this.menuHintRow,
                "Hint-" + direction,
                this.art.get(DIRECTION_ART[direction]),
                54,
                54 / SMALL_ARROW_ASPECT,
                ARROW_TEXT[direction]
            );
            arrow.x = (index - 2.2) * 58;
            this.menuHintArrows.push(arrow);
        });
        const hintLabel = this.makeLabel(
            this.menuHintRow,
            "HintText",
            "+  WASD    跟随节拍输入方向",
            17,
            cc.color(255, 239, 204)
        );
        hintLabel.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
        hintLabel.node.setContentSize(310, 54);
        hintLabel.node.setPosition(112, 0);
        this.menuStatusLabel = this.makeLabel(
            this.menuRoot,
            "MenuStatus",
            startupStatusText(this.startupState),
            14,
            cc.color(255, 224, 139)
        );

        const stageNode = new cc.Node("OriginalStage");
        stageNode.parent = this.gameRoot;
        this.assignRenderGroup(stageNode, dancerGroupIndex);
        this.stage = stageNode.addComponent(cc.Graphics);

        this.dancerNode = new cc.Node("AbstractDancer");
        this.dancerNode.parent = this.root;
        this.assignRenderGroup(this.dancerNode, dancerGroupIndex);
        this.dancerFallback = this.dancerNode.addComponent(cc.Graphics);
        this.drawDancer(this.dancerFallback);

        const panelNode = new cc.Node("CurrentGroupPanel");
        panelNode.parent = this.gameRoot;
        this.groupPanel = panelNode.addComponent(cc.Graphics);

        this.levelLabel = this.makeLabel(this.gameRoot, "Level", "节拍训练场", 18, cc.color(255, 239, 204));
        this.trackLabel = this.makeLabel(
            this.gameRoot,
            "Track",
            DEMO_SONGS[0].beatmap.title,
            14,
            cc.color(255, 207, 82)
        );
        this.hostLabel = this.makeLabel(this.gameRoot, "Host", "正在初始化", 11, cc.color(255, 224, 139));
        this.scoreLabel = this.makeLabel(this.gameRoot, "Score", "得分\n000000", 31, cc.color(255, 248, 225));
        this.judgementLabel = this.makeLabel(this.gameRoot, "Judgement", "等待第一键", 23, cc.color(255, 207, 82));
        this.comboLabel = this.makeLabel(this.gameRoot, "Combo", "连击 0\n最高 0", 21, cc.color(255, 207, 82));
        this.groupLabel = this.makeLabel(this.gameRoot, "Group", "组合 1 / 8", 15, cc.color(238, 220, 183));
        this.progressLabel = this.makeLabel(this.gameRoot, "Progress", "谱面 0% · 等待开始", 13, cc.color(238, 220, 183));
        this.instructionLabel = this.makeLabel(
            this.gameRoot,
            "Instruction",
            "方向键 / WASD · 在每个箭头的目标时刻直接输入",
            13,
            cc.color(218, 194, 146)
        );

        this.sequenceRow = new cc.Node("GroupNotes");
        this.sequenceRow.parent = this.gameRoot;

        const globalTimelineNode = new cc.Node("SongJudgeTimeline");
        globalTimelineNode.parent = this.gameRoot;
        this.globalTimeline = globalTimelineNode.addComponent(cc.Graphics);

        this.directionPad = new cc.Node("DirectionPad");
        this.directionPad.parent = this.gameRoot;
        DIRECTIONS.forEach((direction, index) => {
            const button = this.makeSpriteButton(
                this.directionPad,
                "Touch-" + direction,
                this.art.get(DIRECTION_TOUCH_ART[direction]),
                84 * TOUCH_ARROW_ASPECT,
                84,
                ARROW_TEXT[direction],
                () => this.input && this.input.routeDirection(direction)
            );
            button.x = (index - 1.5) * 96;
            this.directionButtons.push(button);
        });

        this.restartButton = this.makeTapButton(
            this.gameRoot,
            "RestartButton",
            "重新开始",
            126,
            40,
            cc.color(32, 27, 19, 235),
            cc.color(255, 183, 55),
            () => this.input && this.input.routeRestart()
        );
        this.homeButton = this.makeTapButton(
            this.gameRoot,
            "HomeButton",
            "返回主页",
            126,
            40,
            cc.color(32, 27, 19, 235),
            cc.color(255, 183, 55),
            () => this.showMenu()
        );

        this.infoOverlay = new cc.Node("InfoOverlay");
        this.infoOverlay.parent = this.root;
        this.assignRenderGroup(this.infoOverlay, hudGroupIndex);
        this.infoOverlay.addComponent(cc.BlockInputEvents);
        const backdropNode = new cc.Node("Backdrop");
        backdropNode.parent = this.infoOverlay;
        this.infoBackdrop = backdropNode.addComponent(cc.Graphics);
        const infoPanelNode = new cc.Node("InfoPanel");
        infoPanelNode.parent = this.infoOverlay;
        this.infoPanel = infoPanelNode.addComponent(cc.Graphics);
        this.infoTitle = this.makeLabel(infoPanelNode, "Title", "帮助", 30, cc.color(255, 183, 55));
        this.infoBody = this.makeLabel(infoPanelNode, "Body", "", 20, cc.color(255, 239, 204));
        this.infoBody.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
        this.infoBody.verticalAlign = cc.Label.VerticalAlign.TOP;
        const closeButton = this.makeTapButton(
            infoPanelNode,
            "Close",
            "关闭",
            130,
            44,
            cc.color(49, 39, 25),
            cc.color(255, 183, 55),
            () => this.hideInfo()
        );
        closeButton.setPosition(0, -126);
        this.infoOverlay.active = false;
    }

    private layout(): void {
        if (!this.uiReady || !this.root) {
            return;
        }
        const visible = cc.view.getVisibleSize();
        this.viewportWidth = Math.max(960, visible.width || 1280);
        this.viewportHeight = Math.max(540, visible.height || 720);
        this.metrics = this.adapter.viewportMetrics(this.viewportWidth, this.viewportHeight);
        this.root.setContentSize(this.viewportWidth, this.viewportHeight);

        const halfWidth = this.viewportWidth * 0.5;
        const halfHeight = this.viewportHeight * 0.5;
        const safeTop = this.metrics.safe.top;
        const safeBottom = this.metrics.safe.bottom;
        const contentWidth = Math.max(320, this.viewportWidth - this.metrics.safe.left - this.metrics.safe.right);
        const contentCenterX = (this.metrics.safe.left - this.metrics.safe.right) * 0.5;
        const padNaturalWidth = 370;
        const padScale = Math.max(0.82, Math.min(1, (contentWidth - 32) / padNaturalWidth));
        const vertical = calculateRhythmVerticalLayout({
            viewportHeight: this.viewportHeight,
            safeTop,
            safeBottom,
            directionPadScale: padScale
        });
        const compact = vertical.compact;
        this.panelWidth = Math.max(320, Math.min(1000, contentWidth - 56));
        this.panelHeight = vertical.panelHeight;
        this.globalBarWidth = Math.max(280, this.panelWidth - 84);

        this.layoutBackground();
        this.layoutMenu(contentWidth, contentCenterX);
        this.layoutInfoOverlay();
        this.drawStage();
        this.drawGroupPanel();

        const topY = halfHeight - vertical.safeTopApplied - 25;
        const leftX = -halfWidth + this.metrics.safe.left + 22;
        const gameLogoScale = compact ? 0.34 : 0.42;
        this.gameLogo.scale = gameLogoScale;
        this.gameLogo.setPosition(leftX + 160 * gameLogoScale, topY - 107 * gameLogoScale + 5);
        const leftBoxWidth = Math.min(260, Math.max(210, contentWidth * 0.24));
        this.levelLabel.node.setContentSize(leftBoxWidth, 26);
        this.levelLabel.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
        this.levelLabel.node.setPosition(leftX + leftBoxWidth * 0.5, topY - 92);
        this.trackLabel.node.setContentSize(leftBoxWidth, 24);
        this.trackLabel.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
        this.trackLabel.node.setPosition(leftX + leftBoxWidth * 0.5, topY - 116);
        this.hostLabel.string = (this.metrics.hosted ? "BUILDA RUNTIME" : "浏览器兼容模式")
            + (vertical.safeInsetsClamped ? " · 安全区受限" : "");
        this.hostLabel.node.setContentSize(leftBoxWidth, 20);
        this.hostLabel.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
        this.hostLabel.node.setPosition(leftX + leftBoxWidth * 0.5, topY - 138);

        this.scoreLabel.node.setContentSize(320, compact ? 70 : 80);
        this.scoreLabel.node.setPosition(contentCenterX, topY - 18);
        this.judgementLabel.node.setContentSize(320, 38);
        this.judgementLabel.node.setPosition(contentCenterX, topY - (compact ? 67 : 76));

        const rightAvoidance = calculateRightAvoidance(
            this.metrics.safe.right,
            this.metrics.capsule.right,
            this.metrics.capsule.width
        );
        const rightEdge = halfWidth - rightAvoidance;
        this.comboLabel.node.setContentSize(210, 66);
        this.comboLabel.horizontalAlign = cc.Label.HorizontalAlign.RIGHT;
        this.comboLabel.node.setPosition(rightEdge - 105, topY - 15);
        this.restartButton.setPosition(rightEdge - 63, topY - 71);
        this.homeButton.setPosition(rightEdge - 63, topY - 119);

        const panelY = vertical.panelY;
        this.groupPanel.node.setPosition(contentCenterX, panelY);
        this.groupLabel.node.setContentSize(this.panelWidth - 48, 28);
        this.groupLabel.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
        this.groupLabel.node.setPosition(contentCenterX, panelY + this.panelHeight * 0.5 - 17);
        this.sequenceRow.setPosition(contentCenterX, panelY - 9);

        this.stageBaseY = vertical.stageBaseY;
        this.dancerBaseScale = vertical.dancerScale;
        this.stageVisible = vertical.showStage;
        this.stage.node.active = this.stageVisible;
        this.refreshDancerVisibility();
        this.stage.node.setPosition(contentCenterX, this.stageBaseY);
        this.dancerNode.setPosition(contentCenterX, this.stageBaseY + 3);
        this.dancerNode.scale = this.dancerBaseScale;

        this.directionPad.setPosition(contentCenterX, vertical.controlsY);
        this.directionPad.scale = padScale;

        this.globalTimeline.node.setPosition(contentCenterX, vertical.globalLineY);
        this.globalTimeline.node.active = vertical.showTimelineBar;
        this.progressLabel.node.setContentSize(this.globalBarWidth, 24);
        this.progressLabel.node.setPosition(contentCenterX, vertical.progressLabelY);
        this.progressLabel.node.active = vertical.showProgressLabel;
        this.instructionLabel.node.setContentSize(this.globalBarWidth, 22);
        this.instructionLabel.node.setPosition(contentCenterX, vertical.instructionLabelY);
        this.instructionLabel.node.active = vertical.showInstruction;

        this.groupRenderKey = "";
        const songTimeMs = this.clock.isStarted() ? this.clock.currentTimeMs() : 0;
        this.renderGroup(songTimeMs);
        this.updateNoteChips(songTimeMs);
        this.updateGlobalTimeline(songTimeMs);
    }

    private layoutBackground(): void {
        if (this.backgroundSprite && this.backgroundSprite.spriteFrame) {
            const source = this.backgroundSprite.spriteFrame.getOriginalSize();
            const sourceWidth = Math.max(1, source.width || 1448);
            const sourceHeight = Math.max(1, source.height || 1086);
            this.backgroundSpriteNode.setContentSize(sourceWidth, sourceHeight);
            this.backgroundSpriteNode.scale = Math.max(
                this.viewportWidth / sourceWidth,
                this.viewportHeight / sourceHeight
            );
            this.backgroundFallback.node.active = false;
            this.backgroundFallback.clear();
            return;
        }

        this.backgroundFallback.node.active = true;
        this.backgroundNode.setContentSize(this.viewportWidth, this.viewportHeight);
        this.backgroundFallback.clear();
        this.backgroundFallback.fillColor = cc.color(104, 68, 16);
        this.backgroundFallback.rect(
            -this.viewportWidth * 0.5,
            -this.viewportHeight * 0.5,
            this.viewportWidth,
            this.viewportHeight
        );
        this.backgroundFallback.fill();
    }

    private layoutMenu(contentWidth: number, contentCenterX: number): void {
        const halfWidth = this.viewportWidth * 0.5;
        const halfHeight = this.viewportHeight * 0.5;
        const compact = this.viewportHeight < 640;
        const safePressure = Math.min(1, (this.metrics.safe.top + this.metrics.safe.bottom) / 150);
        const logoScale = compact ? 0.45 - safePressure * 0.15 : 0.62;
        this.menuLogo.scale = logoScale;
        const logoWidth = this.menuLogo.width * logoScale;
        const logoHeight = this.menuLogo.height * logoScale;
        this.menuLogo.setPosition(
            -halfWidth + this.metrics.safe.left + 18 + logoWidth * 0.5,
            halfHeight - this.metrics.safe.top - 12 - logoHeight * 0.5
        );

        const topScale = compact ? 0.52 : 0.66;
        const rightAvoidance = calculateRightAvoidance(
            this.metrics.safe.right,
            this.metrics.capsule.right,
            this.metrics.capsule.width,
            12
        );
        const topRight = halfWidth - rightAvoidance;
        const buttonWidths = [181, 226, 181];
        const totalWidth = buttonWidths.reduce((sum, width) => sum + width, 0) * topScale;
        let cursor = topRight - totalWidth;
        const topButtonY = halfHeight - this.metrics.safe.top - 12 - 42 * topScale;
        this.menuTopButtons.forEach((button, index) => {
            const scaledWidth = buttonWidths[index] * topScale;
            button.scale = topScale;
            button.setPosition(cursor + scaledWidth * 0.5, topButtonY);
            cursor += scaledWidth;
        });

        const startScaleLimit = compact ? 0.62 - safePressure * 0.08 : 0.76;
        const startScale = Math.min(startScaleLimit, Math.max(0.52, (contentWidth - 80) / 527));
        const footer = calculateMenuFooterVerticalLayout({
            viewportHeight: this.viewportHeight,
            safeBottom: this.metrics.safe.bottom,
            startButtonHeight: this.menuStartButton.height,
            startButtonScale: startScale
        });
        this.menuStartButton.scale = startScale;
        this.menuStartButton.setPosition(contentCenterX, footer.startY);
        this.menuHintRow.setPosition(contentCenterX, footer.hintY);
        this.menuStatusLabel.node.setContentSize(
            Math.min(620, contentWidth - 40),
            footer.statusLabelHeight
        );
        this.menuStatusLabel.node.setPosition(contentCenterX, footer.statusY);

        const panelAspect = 696 / 565;
        const preferredCardWidth = Math.min(310, contentWidth * 0.28);
        const cardBottom = footer.cardBottom;
        const logoBottom = this.menuLogo.y - logoHeight * 0.5;
        const cardLayout = calculateMenuCardVerticalLayout({
            logoBottom,
            cardBottom,
            preferredCardHeight: preferredCardWidth / panelAspect,
            maximumCardHeight: compact ? 184 : 252
        });
        this.menuCardsHiddenForSafeArea = !cardLayout.visible;
        this.menuTaskPanel.active = cardLayout.visible;
        this.menuSongPanel.active = cardLayout.visible;
        this.refreshStartupStatus();
        if (!cardLayout.visible) {
            return;
        }

        const cardHeight = cardLayout.cardHeight;
        const cardWidth = Math.min(preferredCardWidth, cardHeight * panelAspect);
        const cardSideMargin = Math.max(18, Math.min(42, contentWidth * 0.035));
        const cardY = cardBottom + cardHeight * 0.5;
        this.menuTaskPanel.setPosition(
            -halfWidth + this.metrics.safe.left + cardSideMargin + cardWidth * 0.5,
            cardY
        );
        this.menuSongPanel.setPosition(
            halfWidth - this.metrics.safe.right - cardSideMargin - cardWidth * 0.5,
            cardY
        );
        this.menuTaskPanel.setContentSize(cardWidth, cardHeight);
        this.menuSongPanel.setContentSize(cardWidth, cardHeight);

        const hasTaskArt = this.layoutArtworkWithin(this.menuTaskArtwork, cardWidth, cardHeight);
        const hasSongArt = this.layoutArtworkWithin(this.menuSongArtwork, cardWidth, cardHeight);
        if (hasTaskArt) {
            this.menuTaskGraphics.clear();
        } else {
            this.drawMenuCard(this.menuTaskGraphics, cardWidth, cardHeight);
        }
        if (hasSongArt) {
            this.menuSongGraphics.clear();
        } else {
            this.drawMenuCard(this.menuSongGraphics, cardWidth, cardHeight);
        }

        this.menuTaskTitle.node.active = !hasTaskArt;
        this.menuSongTitle.node.active = !hasSongArt;
        const fallbackTitleY = cardHeight * 0.5 - Math.min(28, cardHeight * 0.2);
        [this.menuTaskTitle, this.menuSongTitle].forEach((title) => {
            title.fontSize = Math.max(14, Math.min(20, cardHeight * 0.1));
            title.lineHeight = Math.round(title.fontSize * 1.18);
            title.node.setContentSize(cardWidth - 30, Math.min(44, cardHeight * 0.24));
            title.node.setPosition(0, fallbackTitleY);
        });

        const bodyFontSize = Math.max(12, Math.min(16, cardHeight * 0.075));
        this.menuTaskLabel.fontSize = bodyFontSize;
        this.menuTaskLabel.lineHeight = Math.max(25, Math.round(cardHeight * 0.19));
        this.menuTaskLabel.node.setContentSize(Math.max(96, cardWidth - 42), cardHeight * 0.66);
        this.menuTaskLabel.node.setPosition(0, -cardHeight * 0.1);
        this.layoutSongRows(cardWidth, cardHeight);
    }

    private layoutSongRows(cardWidth: number, cardHeight: number): void {
        const rowWidth = Math.max(170, cardWidth * 0.86);
        const rowHeight = Math.max(34, Math.min(52, cardHeight * 0.205));
        const rowGap = rowHeight + Math.max(2, cardHeight * 0.012);
        const firstRowY = cardHeight * 0.205;
        const previewScale = rowHeight / 66;
        const starSize = Math.max(14, Math.min(21, rowHeight * 0.41));
        const starScale = starSize / 128;
        const starsWidth = MAX_DIFFICULTY_STARS * starSize + (MAX_DIFFICULTY_STARS - 1) * 2;

        this.menuSongRowsRoot.setContentSize(cardWidth, cardHeight);
        this.menuSongRows.forEach((view, rowIndex) => {
            view.node.setContentSize(rowWidth, rowHeight);
            view.node.setPosition(0, firstRowY - rowIndex * rowGap);
            [view.idleBackground, view.selectedBackground].forEach((background) => {
                background.node.setContentSize(rowWidth, rowHeight);
                background.type = cc.Sprite.Type.SLICED;
            });

            view.previewButton.scale = previewScale;
            view.previewButton.setPosition(-rowWidth * 0.5 + rowHeight * 0.58, 0);

            const textLeft = -rowWidth * 0.5 + rowHeight * 1.12;
            const textRight = rowWidth * 0.5 - starsWidth - 13;
            const textWidth = Math.max(60, textRight - textLeft);
            view.title.fontSize = Math.max(9, Math.min(12, rowHeight * 0.245));
            view.title.lineHeight = Math.max(11, Math.round(view.title.fontSize * 1.12));
            view.title.node.setContentSize(textWidth, rowHeight - 8);
            view.title.node.setPosition(textLeft + textWidth * 0.5, 0);

            const firstStarX = rowWidth * 0.5 - starsWidth + starSize * 0.5 - 7;
            view.stars.forEach((star, starIndex) => {
                star.scale = starScale;
                star.setPosition(firstStarX + starIndex * (starSize + 2), 0);
            });
        });

        this.menuSongStatusLabel.fontSize = Math.max(9, Math.min(11, cardHeight * 0.05));
        this.menuSongStatusLabel.lineHeight = Math.round(this.menuSongStatusLabel.fontSize * 1.15);
        this.menuSongStatusLabel.node.setContentSize(Math.max(120, rowWidth), Math.max(22, cardHeight * 0.12));
        this.menuSongStatusLabel.node.setPosition(0, -cardHeight * 0.285);
        this.refreshSongRows();
    }

    private makeSongRow(parent: cc.Node, songIndex: number): SongRowView {
        const node = new cc.Node("SongRow-" + (songIndex + 1));
        node.parent = parent;
        const fallback = node.addComponent(cc.Graphics);

        const idleBackgroundNode = new cc.Node("IdleBackground");
        idleBackgroundNode.parent = node;
        const idleBackground = idleBackgroundNode.addComponent(cc.Sprite);
        idleBackground.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        idleBackground.type = cc.Sprite.Type.SLICED;

        const selectedBackgroundNode = new cc.Node("SelectedBackground");
        selectedBackgroundNode.parent = node;
        const selectedBackground = selectedBackgroundNode.addComponent(cc.Sprite);
        selectedBackground.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        selectedBackground.type = cc.Sprite.Type.SLICED;

        const previewButton = this.makeSpriteButton(
            node,
            "Preview-" + (songIndex + 1),
            this.art.get("songPreviewPlay"),
            64,
            64,
            "▶",
            () => this.toggleSongPreview(songIndex),
            true
        );
        const title = this.makeLabel(node, "Title", "", 12, cc.color(255, 239, 204));
        title.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
        const stars: cc.Node[] = [];
        for (let starIndex = 0; starIndex < MAX_DIFFICULTY_STARS; starIndex += 1) {
            stars.push(this.makeSpriteNode(
                node,
                "DifficultyStar-" + (starIndex + 1),
                this.art.get("starEmpty"),
                128,
                128,
                "☆"
            ));
        }

        node.on(cc.Node.EventType.TOUCH_START, () => {
            node.scale = 0.985;
        });
        node.on(cc.Node.EventType.TOUCH_END, () => {
            node.scale = 1;
            this.selectSong(songIndex);
        });
        node.on(cc.Node.EventType.TOUCH_CANCEL, () => {
            node.scale = 1;
        });

        const view = {
            node,
            idleBackground,
            selectedBackground,
            fallback,
            previewButton,
            title,
            stars,
            songIndex
        };
        this.bindSongRowBackgroundFrames(view);
        return view;
    }

    private bindSongRowBackgroundFrames(view: SongRowView): void {
        view.idleBackground.spriteFrame = this.art.get("songRowIdle");
        view.selectedBackground.spriteFrame = this.art.get("songRowSelected");
    }

    private selectedSong(): SongDefinition {
        return DEMO_SONGS[this.selectedSongIndex] || DEMO_SONGS[0];
    }

    private selectSong(songIndex: number): void {
        if (songIndex < 0 || songIndex >= DEMO_SONGS.length) {
            return;
        }
        this.cancelPendingGameplayStart();
        const changed = this.selectedSongIndex !== songIndex;
        this.selectedSongIndex = songIndex;
        if (changed && this.songPreview.getSnapshot().phase !== "idle") {
            const pendingStop = this.songPreview.stop();
            this.refreshSongRows();
            pendingStop.then(() => {
                if (cc.isValid(this.node)) {
                    this.refreshSongRows();
                }
            });
        } else {
            this.refreshSongRows();
        }
        console.info("[GameBootstrap] selected-song=" + this.selectedSong().id);
    }

    private toggleSongPreview(songIndex: number): void {
        if (songIndex < 0 || songIndex >= DEMO_SONGS.length) {
            return;
        }
        this.cancelPendingGameplayStart();
        this.selectedSongIndex = songIndex;
        const song = this.selectedSong();
        const pending = this.songPreview.toggle(song.id, song.previewPath, song.previewVolume);
        this.refreshSongRows();
        pending.then((snapshot) => {
            if (!cc.isValid(this.node)) {
                return;
            }
            this.refreshSongRows(snapshot);
        });
        console.info("[GameBootstrap] preview-toggle=" + song.id);
    }

    private stopSongPreview(): Promise<SongPreviewSnapshot> {
        if (this.songPreview.getSnapshot().phase === "idle") {
            return Promise.resolve(this.songPreview.getSnapshot());
        }
        const pending = this.songPreview.stop();
        this.refreshSongRows();
        pending.then((snapshot) => {
            if (cc.isValid(this.node)) {
                this.refreshSongRows(snapshot);
            }
        });
        return pending;
    }

    private refreshSongRows(snapshot: SongPreviewSnapshot = this.songPreview.getSnapshot()): void {
        if (!this.menuSongRows || this.menuSongRows.length === 0) {
            return;
        }
        this.menuSongRows.forEach((view) => {
            const song = DEMO_SONGS[view.songIndex];
            const selected = view.songIndex === this.selectedSongIndex;
            view.idleBackground.node.active = !selected;
            view.selectedBackground.node.active = selected;
            const activeBackground = selected ? view.selectedBackground : view.idleBackground;
            this.drawSongRowFallback(view, selected, !!activeBackground.spriteFrame);

            const difficulty = analyzeBeatmapDifficulty(song.beatmap);
            const previewActive = snapshot.songId === song.id && snapshot.phase !== "idle";
            this.applyButtonFrame(
                view.previewButton,
                this.art.get(previewActive ? "songPreviewPause" : "songPreviewPlay")
            );
            view.title.string = song.beatmap.title + "\n"
                + song.beatmap.bpm + " BPM · " + song.beatmap.groups.length + " 组 · "
                + beatmapNoteCount(song.beatmap) + " 音符";
            view.title.node.color = selected ? cc.color(48, 31, 8) : cc.color(255, 239, 204);
            view.stars.forEach((star, starIndex) => {
                this.applySpriteFrame(
                    star,
                    this.art.get(starIndex < difficulty.stars ? "starFilled" : "starEmpty")
                );
            });
        });

        if (!this.menuSongStatusLabel) {
            return;
        }
        if (snapshot.phase === "starting") {
            this.menuSongStatusLabel.string = "正在加载试听…";
            this.menuSongStatusLabel.node.color = cc.color(255, 224, 139);
        } else if (snapshot.phase === "playing") {
            this.menuSongStatusLabel.string = "正在试听 · 再点左侧按钮暂停";
            this.menuSongStatusLabel.node.color = cc.color(255, 224, 139);
        } else if (snapshot.phase === "stopping") {
            this.menuSongStatusLabel.string = "正在停止试听…";
            this.menuSongStatusLabel.node.color = cc.color(238, 220, 183);
        } else if (snapshot.available === false) {
            this.menuSongStatusLabel.string = "试听不可用 · 请在 Builda 测试外壳或 App 中重试";
            this.menuSongStatusLabel.node.color = cc.color(255, 151, 128);
        } else {
            this.menuSongStatusLabel.string = "黄底为当前选择 · 左侧可试听";
            this.menuSongStatusLabel.node.color = cc.color(238, 220, 183);
        }
    }

    private drawSongRowFallback(view: SongRowView, selected: boolean, hasFrame: boolean): void {
        view.fallback.clear();
        if (hasFrame) {
            return;
        }
        const width = Math.max(1, view.node.width);
        const height = Math.max(1, view.node.height);
        view.fallback.fillColor = selected ? cc.color(183, 133, 0, 248) : cc.color(24, 22, 19, 248);
        view.fallback.roundRect(-width * 0.5, -height * 0.5, width, height, Math.min(9, height * 0.12));
        view.fallback.fill();
        view.fallback.strokeColor = selected ? cc.color(255, 208, 35) : cc.color(93, 82, 66);
        view.fallback.lineWidth = 2;
        view.fallback.roundRect(-width * 0.5, -height * 0.5, width, height, Math.min(9, height * 0.12));
        view.fallback.stroke();
    }

    private layoutInfoOverlay(): void {
        const width = Math.min(680, this.viewportWidth - 100);
        const height = Math.min(360, this.viewportHeight - 90);
        this.infoBackdrop.clear();
        this.infoBackdrop.fillColor = cc.color(0, 0, 0, 185);
        this.infoBackdrop.rect(
            -this.viewportWidth * 0.5,
            -this.viewportHeight * 0.5,
            this.viewportWidth,
            this.viewportHeight
        );
        this.infoBackdrop.fill();

        const panelNode = this.infoPanel.node;
        panelNode.setContentSize(width, height);
        this.infoPanel.clear();
        this.infoPanel.fillColor = cc.color(24, 21, 16, 250);
        this.infoPanel.roundRect(-width * 0.5, -height * 0.5, width, height, 22);
        this.infoPanel.fill();
        this.infoPanel.strokeColor = cc.color(255, 183, 55);
        this.infoPanel.lineWidth = 4;
        this.infoPanel.roundRect(-width * 0.5, -height * 0.5, width, height, 22);
        this.infoPanel.stroke();
        this.infoTitle.node.setContentSize(width - 60, 50);
        this.infoTitle.node.setPosition(0, height * 0.5 - 48);
        this.infoBody.node.setContentSize(width - 90, height - 145);
        this.infoBody.node.setPosition(0, 5);
        const closeButton = panelNode.getChildByName("Close");
        if (closeButton) {
            closeButton.setPosition(0, -height * 0.5 + 36);
        }
    }

    private startGame(): void {
        if (!canEnterGameplay(this.startupState)) {
            this.refreshStartupStatus();
            return;
        }
        if (this.gameplayStartPending) {
            return;
        }
        const song = this.selectedSong();
        const requestId = ++this.gameplayStartRequestId;
        this.gameplayStartPending = true;
        this.stopSongPreview().then((snapshot) => {
            if (!cc.isValid(this.node) || requestId !== this.gameplayStartRequestId) {
                return;
            }
            this.gameplayStartPending = false;
            this.refreshSongRows(snapshot);
            if (!canEnterGameplay(this.startupState) || this.hostSuspended) {
                this.refreshStartupStatus();
                return;
            }
            this.beginGameplay(song);
        });
    }

    private beginGameplay(song: SongDefinition): void {
        this.activeSong = song;
        this.hideInfo();
        this.menuRoot.active = false;
        this.gameRoot.active = true;
        this.gameplayActive = true;
        console.info("[GameBootstrap] screen=gameplay");
        this.restartGame();
        this.layout();
    }

    private showMenu(): void {
        if (!this.uiReady) {
            return;
        }
        this.cancelPendingGameplayStart();
        this.stopSongPreview();
        if (this.clock.isStarted() && !this.clock.isPaused()) {
            this.clock.pause();
        }
        if (this.input) {
            this.input.resetPressed();
        }
        this.danceFlow.reset();
        this.clockHeldForDanceFlow = false;
        this.heldGroupIndex = -1;
        this.gameplayActive = false;
        this.currentOutcome = null;
        if (this.dancerController) {
            this.dancerController.setMenuIdle(true);
        }
        this.setGroupInputUiVisible(true);
        this.gameRoot.active = false;
        this.menuRoot.active = true;
        this.hideInfo();
        this.refreshMenuSummary();
        this.refreshSongRows();
        console.info("[GameBootstrap] screen=menu");
        this.layout();
    }

    private refreshMenuSummary(): void {
        const snapshot = this.engine.getSnapshot();
        const completedGroups = snapshot.finished ? snapshot.groupCount : snapshot.groupIndex;
        const groupMark = completedGroups >= 3 ? "✓" : "·";
        const scoreMark = snapshot.score >= 8000 ? "✓" : "·";
        const comboMark = snapshot.maxCombo >= 10 ? "✓" : "·";
        this.menuTaskLabel.string = groupMark + "  完成 3 组舞步        " + Math.min(completedGroups, 3) + "/3\n"
            + scoreMark + "  获得 8000 分      " + snapshot.score + "/8000\n"
            + comboMark + "  连击达到 10 次    " + snapshot.maxCombo + "/10";
    }

    private openPlatformSettings(): void {
        this.adapter.openPlatformMenu().then((opened) => {
            if (!opened && cc.isValid(this.node)) {
                this.showInfo(
                    "设置",
                    "音乐、音效、暂停与退出由创游世界平台统一管理。\n\n"
                    + "当前是普通浏览器兼容模式，请在 Builda 测试外壳或 App 内使用平台胶囊菜单。"
                );
            }
        });
    }

    private showRankInfo(): void {
        const snapshot = this.leaderboard.getSnapshot();
        const lines: string[] = ["仅统计本设备完整结算的成绩，不代表平台排名。", ""];
        if (snapshot.entries.length === 0) {
            lines.push("暂无完整结算记录。", "完成全部 8 组舞步与最终舞段后才会入榜。");
        } else {
            snapshot.entries.slice(0, 5).forEach((entry, index) => {
                lines.push("#" + (index + 1) + "  " + entry.score + " 分 · 最高连击 " + entry.maxCombo);
            });
        }
        if (snapshot.latest) {
            const latestText = snapshot.latest.retained && snapshot.latest.rank !== null
                ? "第 " + snapshot.latest.rank + " 名"
                : "未进入前 10";
            lines.push("", "最近完整结算：" + latestText);
        }
        const persistenceNotice = this.leaderboardPersistenceNotice(snapshot.persistenceIssue);
        if (persistenceNotice) {
            lines.push("", persistenceNotice);
        }
        this.showInfo("本地排行榜", lines.join("\n"));
    }

    private showHelp(): void {
        this.showInfo(
            "跳舞帮助",
            "键盘：方向键或 W / A / S / D\n"
            + "触控：点击画面下方四个方向按钮\n\n"
            + "箭头进入判定窗口后输入；过早输入不会消耗音符，窗口内按错方向会立即失败。\n"
            + "Perfect ±50ms · Good ±100ms · Bad ±180ms"
        );
    }

    private showInfo(title: string, body: string): void {
        this.infoTitle.string = title;
        this.infoBody.string = body;
        this.infoOverlay.active = true;
        this.infoOverlay.setSiblingIndex(this.root.childrenCount - 1);
        this.refreshDancerVisibility();
        console.info("[GameBootstrap] overlay=" + title);
    }

    private hideInfo(): void {
        if (this.infoOverlay) {
            this.infoOverlay.active = false;
        }
        this.refreshDancerVisibility();
    }

    private refreshDancerVisibility(): void {
        if (!this.dancerNode) {
            return;
        }
        this.dancerNode.active = this.stageVisible && (!this.infoOverlay || !this.infoOverlay.active);
    }

    private restartGame(): void {
        if (!canEnterGameplay(this.startupState) || !this.gameplayActive) {
            return;
        }
        this.configureActiveSongSession();
        this.engine.start();
        this.completionRecordedForRun = false;
        this.clock.restart();
        if (this.dancerController) {
            this.dancerController.setGameplayIdle(true);
            this.dancerController.setAnimationProfile(this.activeSong.animation);
        }
        this.pausedByHost = false;
        this.clockHeldForDanceFlow = false;
        this.heldGroupIndex = -1;
        this.groupRenderKey = "";
        this.setGroupInputUiVisible(true);
        this.lastResultText = "等待第一键";
        this.lastResultColor = cc.color(255, 207, 82);
        this.showTransient("准备", cc.color(255, 207, 82), 800);
        this.instructionLabel.string = "方向键 / WASD · 在每个箭头的目标时刻直接输入";
        this.refreshStats();
        this.renderGroup(0);
        this.updateNoteChips(0);
        this.updateGlobalTimeline(0);
        if (this.hostSuspended) {
            this.pauseForHost();
        }
    }

    private configureActiveSongSession(): void {
        this.activeSession = createSongSessionConfig(
            this.activeSong,
            DEFAULT_JUDGE_WINDOWS.badMs
        );
        this.engine = new SequenceEngine(this.activeSession.beatmap, this.judge);
        this.danceFlow = new GroupDanceFlow(
            this.activeSession.groupCount,
            this.activeSession.danceDurationMs
        );
        this.songDurationMs = this.activeSession.songDurationMs;
        this.currentOutcome = null;
        this.trackLabel.string = this.activeSession.title;
        this.levelLabel.string = this.activeSong.beatmap.bpm + " BPM · 节拍训练场";
    }

    private cancelPendingGameplayStart(): void {
        if (!this.gameplayStartPending) {
            return;
        }
        this.gameplayStartRequestId += 1;
        this.gameplayStartPending = false;
    }

    private onDirection(direction: Direction): void {
        if (!this.gameplayActive || !canEnterGameplay(this.startupState)
            || this.danceFlow.getSnapshot().inputLocked || this.clock.isPaused()) {
            return;
        }
        const songTimeMs = this.clock.currentTimeMs();
        this.presentActions(this.engine.inputDirection(direction, songTimeMs), songTimeMs);
        if (this.danceFlow.getSnapshot().phase === "dance") {
            this.refreshStats();
            return;
        }
        this.renderGroup(songTimeMs);
        this.updateNoteChips(songTimeMs);
        this.updateGlobalTimeline(songTimeMs);
        this.refreshStats();
    }

    private presentActions(actions: EngineAction[], songTimeMs: number): void {
        actions.forEach((action) => this.presentAction(action, songTimeMs));
    }

    private presentAction(action: EngineAction, songTimeMs: number): void {
        if (action.kind === "tooEarly") {
            this.showTransient("还没到判定窗口，请等待", cc.color(255, 210, 112), songTimeMs + 380);
        } else if (action.judgement) {
            const timing = action.judgement.grade === "Miss"
                ? ""
                : "  " + (action.judgement.deltaMs >= 0 ? "+" : "")
                    + Math.round(action.judgement.deltaMs) + "ms";
            const suffix = action.groupCompleted ? " · 本组完成" : "";
            this.lastResultText = GRADE_TEXT[action.judgement.grade] + timing + suffix;
            this.lastResultColor = this.judgementColor(action.judgement.grade);
            this.restoreLastResult();
        }

        if (action.groupCompleted) {
            this.beginGroupDance(action.groupIndex);
        }
    }

    private beginGroupDance(completedGroupIndex: number): void {
        const segment = this.danceFlow.beginGroupDance(completedGroupIndex);
        this.heldGroupIndex = completedGroupIndex;
        this.groupRenderKey = "";
        if (this.clock.isStarted() && !this.clock.isPaused()) {
            this.clock.pause();
        }
        this.clockHeldForDanceFlow = true;
        if (this.input) {
            this.input.resetPressed();
        }
        this.setGroupInputUiVisible(false);
        if (this.dancerController) {
            this.dancerController.setDanceSegment(
                segment.groupIndex,
                segment.groupCount,
                segment.elapsedMs
            );
        }
        this.instructionLabel.string = this.danceInstruction(segment);
        this.progressLabel.string = "舞段 " + (segment.groupIndex + 1) + " / " + segment.groupCount
            + " · 谱面与输入已暂停";
        this.progressLabel.node.color = cc.color(255, 207, 82);
        this.updateStage(segment.startMs);
    }

    private updateDanceInterlude(deltaSeconds: number): void {
        const transition = this.danceFlow.update(Math.max(0, deltaSeconds) * 1000);
        const snapshot = this.danceFlow.getSnapshot();
        if (snapshot.segment) {
            if (this.dancerController) {
                this.dancerController.setDanceSegment(
                    snapshot.segment.groupIndex,
                    snapshot.segment.groupCount,
                    snapshot.segment.elapsedMs
                );
            }
            this.updateStage(snapshot.segment.startMs + snapshot.segment.elapsedMs);
            this.instructionLabel.string = this.danceInstruction(snapshot.segment);
        }
        if (transition) {
            this.finishDanceInterlude(transition);
        }
    }

    private finishDanceInterlude(transition: GroupDanceTransition): void {
        const songTimeMs = this.clock.currentTimeMs();
        if (this.input) {
            this.input.resetPressed();
        }
        if (transition.kind === "next-group") {
            if (this.dancerController) {
                this.dancerController.setGameplayIdle(true);
            }
            this.heldGroupIndex = -1;
            this.groupRenderKey = "";
            this.clockHeldForDanceFlow = false;
            this.instructionLabel.string = "方向键 / WASD · 在每个箭头的目标时刻直接输入";
            this.progressLabel.node.color = cc.color(238, 220, 183);
            this.setGroupInputUiVisible(true);
            this.renderGroup(songTimeMs);
            this.updateNoteChips(songTimeMs);
            this.updateGlobalTimeline(songTimeMs);
            this.refreshStats();
            if (!this.hostSuspended && this.clock.isPaused()) {
                this.clock.resume();
            }
            return;
        }

        this.clockHeldForDanceFlow = true;
        this.setGroupInputUiVisible(false);
        const snapshot = this.engine.getSnapshot();
        this.currentOutcome = resolveSongOutcome(this.activeSong, snapshot.score);
        this.recordCompletedRun();
        this.lastResultText = (this.currentOutcome.passed ? "成功 / PASS" : "失败 / FAIL")
            + " · 得分 " + this.currentOutcome.score + " · 及格 " + this.currentOutcome.passingScore;
        this.lastResultColor = this.outcomeColor(this.currentOutcome);
        this.restoreLastResult();
        this.instructionLabel.string = this.resultInstruction(this.currentOutcome);
        if (this.dancerController) {
            this.dancerController.setResult(this.currentOutcome.passed, true);
        }
        this.updateGlobalTimeline(songTimeMs);
        this.refreshStats();
    }

    private recordCompletedRun(): void {
        if (this.completionRecordedForRun || this.danceFlow.getSnapshot().phase !== "result") {
            return;
        }
        this.completionRecordedForRun = true;
        const snapshot = this.engine.getSnapshot();
        if (!snapshot.finished) {
            console.warn("[GameBootstrap] ignored leaderboard record before engine completion");
            return;
        }
        const result = this.leaderboard.record({
            score: snapshot.score,
            maxCombo: snapshot.maxCombo
        });
        console.info(
            "[GameBootstrap] local-leaderboard rank=" + (result.rank === null ? "outside-top-10" : result.rank)
            + " retained=" + result.retained
        );
    }

    private leaderboardPersistenceNotice(issue: LocalLeaderboardPersistenceIssue | null): string {
        if (!issue) {
            return "";
        }
        if (issue === "storage-data-corrupt") {
            return "未持久化：检测到损坏的本地榜数据，本次成绩仅在当前会话保留。";
        }
        return "未持久化：本地存储不可用，本次成绩仅在当前会话保留。";
    }

    private danceInstruction(segment: GroupDanceSegment): string {
        const destination = segment.final ? "完成演出" : "出现下一组";
        return "舞段 " + (segment.groupIndex + 1) + " / " + segment.groupCount
            + " · " + Math.max(0, segment.remainingMs / 1000).toFixed(1)
            + "s 后" + destination;
    }

    private resultInstruction(outcome: SongOutcome): string {
        const status = outcome.passed ? "成功 / PASS" : "失败 / FAIL";
        return status + " · 得分 " + outcome.score + " / " + outcome.maximumScore
            + " · 及格线 " + outcome.passingScore + " · 点击重新开始或按 R";
    }

    private resultProgressText(outcome: SongOutcome): string {
        return "谱面 100% · " + (outcome.passed ? "成功" : "失败")
            + " · 得分 " + outcome.score + " · 及格线 " + outcome.passingScore;
    }

    private setGroupInputUiVisible(visible: boolean): void {
        if (this.groupPanel) {
            this.groupPanel.node.active = visible;
        }
        if (this.groupLabel) {
            this.groupLabel.node.active = visible;
        }
        if (this.sequenceRow) {
            this.sequenceRow.active = visible;
        }
        if (this.directionPad) {
            this.directionPad.active = visible;
        }
    }

    private refreshStats(): void {
        const snapshot = this.engine.getSnapshot();
        this.scoreLabel.string = "得分\n" + this.padScore(snapshot.score);
        this.comboLabel.string = "连击 " + snapshot.combo + "\n最高 " + snapshot.maxCombo;
        const songTimeMs = this.clock.isStarted() ? this.clock.currentTimeMs() : 0;
        const displayIndex = this.displayedGroupIndex(songTimeMs);
        const showingCompletedGroup = snapshot.finished || displayIndex < snapshot.groupIndex;
        this.groupLabel.string = "组合 " + (displayIndex + 1) + " / " + snapshot.groupCount
            + (showingCompletedGroup ? " · 本组结果" : "")
            + "     已结算 " + snapshot.settledNoteCount + " / " + snapshot.totalNoteCount;
    }

    private renderGroup(songTimeMs: number): void {
        const displayIndex = this.displayedGroupIndex(songTimeMs);
        const groupStatus = this.engine.getGroupStatus(displayIndex);
        if (!groupStatus) {
            return;
        }
        const statusKey = groupStatus.notes.map((item) => {
            return (item.judgement ? item.judgement.grade : "-") + (item.current ? "*" : "");
        }).join(",");
        const key = displayIndex + ":" + statusKey + ":" + this.panelWidth + ":" + this.panelHeight;
        if (key === this.groupRenderKey) {
            return;
        }
        this.groupRenderKey = key;
        this.sequenceRow.removeAllChildren();
        this.noteChipViews = [];

        const count = groupStatus.notes.length;
        const gap = count === 5 ? 9 : 12;
        const chipWidth = Math.max(66, Math.min(130, (this.panelWidth - 62 - gap * (count - 1)) / count));
        const chipHeight = this.panelHeight - 47;
        const chipLayout = calculateNoteChipVerticalLayout(chipHeight);
        const stride = chipWidth + gap;
        groupStatus.notes.forEach((item, noteIndex) => {
            const chip = new cc.Node("Note-" + (noteIndex + 1));
            chip.parent = this.sequenceRow;
            chip.setContentSize(chipWidth, chipHeight);
            chip.x = (noteIndex - (count - 1) * 0.5) * stride;
            const card = chip.addComponent(cc.Graphics);

            const arrowWidth = Math.min(chipWidth - 18, chipLayout.arrowBoxHeight + 8);
            const arrowNode = this.makeSpriteNode(
                chip,
                "Arrow",
                this.art.get(DIRECTION_ART[item.note.direction]),
                arrowWidth,
                arrowWidth / SMALL_ARROW_ASPECT,
                ARROW_TEXT[item.note.direction]
            );
            arrowNode.setPosition(0, chipLayout.arrowY);
            const arrow = arrowNode.getComponent(cc.Sprite);
            const status = this.makeLabel(
                chip,
                "Status",
                "未到",
                chipLayout.statusFontSize,
                cc.color(145, 157, 194)
            );
            status.node.setContentSize(chipWidth - 8, chipLayout.statusBoxHeight);
            status.node.setPosition(0, chipLayout.statusY);

            const barNode = new cc.Node("MiniJudgeBar");
            barNode.parent = chip;
            barNode.setPosition(0, chipLayout.miniBarY);
            const miniBar = barNode.addComponent(cc.Graphics);
            this.noteChipViews.push({
                node: chip,
                card,
                miniBar,
                arrow,
                status,
                noteIndex,
                width: chipWidth,
                height: chipHeight
            });
        });
    }

    private updateNoteChips(songTimeMs: number): void {
        const displayIndex = this.displayedGroupIndex(songTimeMs);
        const groupStatus = this.engine.getGroupStatus(displayIndex);
        if (!groupStatus || groupStatus.notes.length !== this.noteChipViews.length) {
            return;
        }
        groupStatus.notes.forEach((status, index) => this.drawNoteChip(this.noteChipViews[index], status, songTimeMs));
    }

    private drawNoteChip(view: NoteChipView, status: GroupNoteStatus, songTimeMs: number): void {
        const grade = status.judgement ? status.judgement.grade : "";
        const accent = grade ? this.judgementColor(grade) : status.current
            ? cc.color(255, 183, 55)
            : cc.color(117, 99, 66);
        const fill = grade
            ? this.gradeFillColor(grade)
            : status.current ? cc.color(91, 58, 18, 245) : cc.color(31, 27, 20, 238);

        view.card.clear();
        view.card.fillColor = fill;
        view.card.roundRect(-view.width * 0.5, -view.height * 0.5, view.width, view.height, 13);
        view.card.fill();
        view.card.strokeColor = accent;
        view.card.lineWidth = status.current ? 4 : 2;
        view.card.roundRect(-view.width * 0.5, -view.height * 0.5, view.width, view.height, 13);
        view.card.stroke();

        view.arrow.node.color = grade || status.current ? cc.color(255, 255, 255) : cc.color(152, 145, 125);
        view.status.string = grade ? GRADE_TEXT[grade] : status.current ? "当前 · 待判" : "未到";
        view.status.node.color = accent;

        const barWidth = Math.max(42, view.width - 24);
        const x = -barWidth * 0.5;
        const target = status.note.targetTimeMs;
        const badWindow = DEFAULT_JUDGE_WINDOWS.badMs;
        const badStart = noteApproachProgress(target - badWindow, target, NOTE_APPROACH_MS, badWindow);
        const targetPosition = noteApproachProgress(target, target, NOTE_APPROACH_MS, badWindow);
        const markerTime = status.judgement ? target + status.judgement.deltaMs : songTimeMs;
        const markerPosition = noteApproachProgress(markerTime, target, NOTE_APPROACH_MS, badWindow);

        view.miniBar.clear();
        view.miniBar.lineCap = cc.Graphics.LineCap.ROUND;
        view.miniBar.strokeColor = cc.color(80, 68, 49);
        view.miniBar.lineWidth = 5;
        view.miniBar.moveTo(x, 0);
        view.miniBar.lineTo(x + barWidth, 0);
        view.miniBar.stroke();
        view.miniBar.strokeColor = cc.color(255, 210, 112, 170);
        view.miniBar.lineWidth = 6;
        view.miniBar.moveTo(x + barWidth * badStart, 0);
        view.miniBar.lineTo(x + barWidth, 0);
        view.miniBar.stroke();
        view.miniBar.strokeColor = cc.color(245, 248, 255, 190);
        view.miniBar.lineWidth = 2;
        view.miniBar.moveTo(x + barWidth * targetPosition, -7);
        view.miniBar.lineTo(x + barWidth * targetPosition, 7);
        view.miniBar.stroke();
        view.miniBar.fillColor = accent;
        view.miniBar.circle(x + barWidth * markerPosition, 0, status.current || grade ? 5 : 3);
        view.miniBar.fill();
    }

    private displayedGroupIndex(_songTimeMs: number): number {
        const snapshot = this.engine.getSnapshot();
        if (this.heldGroupIndex >= 0) {
            return this.heldGroupIndex;
        }
        return Math.min(snapshot.groupIndex, snapshot.groupCount - 1);
    }

    private updateGlobalTimeline(songTimeMs: number): void {
        const snapshot = this.engine.getSnapshot();
        const dancePhase = this.danceFlow.getSnapshot().phase;
        const currentNote = dancePhase === "input" ? this.engine.getCurrentNote() : null;
        const presentationFinished = snapshot.finished && dancePhase === "result";
        const width = this.globalBarWidth;
        const x = -width * 0.5;
        const progress = presentationFinished ? 1 : timelineProgress(songTimeMs, this.songDurationMs);
        const feedbackColor = presentationFinished && this.currentOutcome
            ? this.outcomeColor(this.currentOutcome)
            : snapshot.lastJudgement
            ? this.judgementColor(snapshot.lastJudgement)
            : cc.color(255, 183, 55);

        this.globalTimeline.clear();
        this.globalTimeline.lineCap = cc.Graphics.LineCap.ROUND;
        this.globalTimeline.strokeColor = cc.color(68, 58, 43);
        this.globalTimeline.lineWidth = 12;
        this.globalTimeline.moveTo(x, 0);
        this.globalTimeline.lineTo(x + width, 0);
        this.globalTimeline.stroke();

        if (currentNote) {
            const badWindow = DEFAULT_JUDGE_WINDOWS.badMs;
            const start = timelineProgress(currentNote.targetTimeMs - badWindow, this.songDurationMs);
            const end = timelineProgress(currentNote.targetTimeMs + badWindow, this.songDurationMs);
            const target = timelineProgress(currentNote.targetTimeMs, this.songDurationMs);
            const actualWindowWidth = Math.max(10, width * (end - start));
            const windowCenter = x + width * (start + end) * 0.5;
            this.globalTimeline.strokeColor = cc.color(255, 210, 112, 190);
            this.globalTimeline.lineWidth = 12;
            this.globalTimeline.moveTo(windowCenter - actualWindowWidth * 0.5, 0);
            this.globalTimeline.lineTo(windowCenter + actualWindowWidth * 0.5, 0);
            this.globalTimeline.stroke();
            this.globalTimeline.strokeColor = cc.color(245, 248, 255);
            this.globalTimeline.lineWidth = 3;
            this.globalTimeline.moveTo(x + width * target, -10);
            this.globalTimeline.lineTo(x + width * target, 10);
            this.globalTimeline.stroke();
        }

        this.globalTimeline.strokeColor = feedbackColor;
        this.globalTimeline.lineWidth = 7;
        this.globalTimeline.moveTo(x, 0);
        this.globalTimeline.lineTo(x + width * progress, 0);
        this.globalTimeline.stroke();
        this.globalTimeline.fillColor = feedbackColor;
        this.globalTimeline.circle(x + width * progress, 0, 7);
        this.globalTimeline.fill();

        if (presentationFinished) {
            const outcome = this.currentOutcome || resolveSongOutcome(this.activeSong, snapshot.score);
            this.progressLabel.string = this.resultProgressText(outcome);
            this.progressLabel.node.color = feedbackColor;
        } else if (currentNote) {
            const remainingMs = currentNote.targetTimeMs - songTimeMs;
            const timingText = remainingMs >= 0
                ? "目标 " + (remainingMs / 1000).toFixed(2) + "s"
                : "已晚 " + (Math.abs(remainingMs) / 1000).toFixed(2) + "s";
            this.progressLabel.string = "谱面 " + Math.round(progress * 100) + "% · 当前 "
                + ARROW_TEXT[currentNote.direction] + " · " + timingText;
            this.progressLabel.node.color = cc.color(238, 220, 183);
        }
    }

    private updateStage(songTimeMs: number): void {
        if (!this.stageVisible) {
            return;
        }
        if (this.dancerController && this.dancerController.isReady()) {
            this.dancerNode.y = this.stageBaseY + 3;
            this.dancerNode.rotation = 0;
            this.dancerNode.scaleX = this.dancerBaseScale;
            this.dancerNode.scaleY = this.dancerBaseScale;
            return;
        }
        const beatDuration = 60000 / this.activeSong.beatmap.bpm;
        const phase = ((songTimeMs % beatDuration) + beatDuration) % beatDuration / beatDuration;
        const pulse = Math.pow(1 - phase, 2);
        this.dancerNode.y = this.stageBaseY + 3 + pulse * 8;
        this.dancerNode.rotation = Math.sin(songTimeMs / 420) * 3.5;
        this.dancerNode.scaleX = this.dancerBaseScale * (1 + pulse * 0.035);
        this.dancerNode.scaleY = this.dancerBaseScale * (1 - pulse * 0.025);
    }

    private drawStage(): void {
        const compact = this.viewportHeight < 640;
        const width = Math.min(650, this.panelWidth * 0.72);
        const height = compact ? 78 : 110;
        this.stage.clear();

        this.stage.fillColor = cc.color(27, 22, 15, 190);
        this.stage.moveTo(-width * 0.5, -height * 0.25);
        this.stage.lineTo(-width * 0.34, height * 0.4);
        this.stage.lineTo(width * 0.34, height * 0.4);
        this.stage.lineTo(width * 0.5, -height * 0.25);
        this.stage.close();
        this.stage.fill();
        this.stage.strokeColor = cc.color(255, 183, 55, 150);
        this.stage.lineWidth = 3;
        this.stage.moveTo(-width * 0.5, -height * 0.25);
        this.stage.lineTo(width * 0.5, -height * 0.25);
        this.stage.stroke();

        this.stage.fillColor = cc.color(255, 208, 84, 34);
        this.stage.moveTo(-width * 0.36, height * 0.42);
        this.stage.lineTo(-width * 0.08, -height * 0.28);
        this.stage.lineTo(-width * 0.48, -height * 0.28);
        this.stage.close();
        this.stage.fill();
        this.stage.fillColor = cc.color(212, 83, 24, 36);
        this.stage.moveTo(width * 0.36, height * 0.42);
        this.stage.lineTo(width * 0.48, -height * 0.28);
        this.stage.lineTo(width * 0.08, -height * 0.28);
        this.stage.close();
        this.stage.fill();
    }

    private drawDancer(graphics: cc.Graphics): void {
        graphics.clear();
        graphics.fillColor = cc.color(255, 239, 204);
        graphics.circle(0, 38, 12);
        graphics.fill();
        graphics.fillColor = cc.color(255, 183, 55);
        graphics.roundRect(-15, 3, 30, 31, 9);
        graphics.fill();
        graphics.strokeColor = cc.color(151, 58, 24);
        graphics.lineWidth = 7;
        graphics.moveTo(-9, 7);
        graphics.lineTo(-30, -12);
        graphics.moveTo(9, 7);
        graphics.lineTo(32, 14);
        graphics.moveTo(-7, 3);
        graphics.lineTo(-18, -28);
        graphics.moveTo(7, 3);
        graphics.lineTo(22, -24);
        graphics.stroke();
    }

    private drawGroupPanel(): void {
        this.groupPanel.clear();
        this.groupPanel.fillColor = cc.color(22, 19, 14, 244);
        this.groupPanel.roundRect(
            -this.panelWidth * 0.5,
            -this.panelHeight * 0.5,
            this.panelWidth,
            this.panelHeight,
            22
        );
        this.groupPanel.fill();
        this.groupPanel.strokeColor = cc.color(179, 126, 36, 210);
        this.groupPanel.lineWidth = 2;
        this.groupPanel.roundRect(
            -this.panelWidth * 0.5,
            -this.panelHeight * 0.5,
            this.panelWidth,
            this.panelHeight,
            22
        );
        this.groupPanel.stroke();
    }

    private renderGroupIndex(name: string): number {
        const groupList = (cc.game as any).groupList as string[];
        return groupList ? groupList.indexOf(name) : -1;
    }

    private assignRenderGroup(node: cc.Node, groupIndex: number): void {
        if (groupIndex >= 0) {
            node.groupIndex = groupIndex;
        }
    }

    private drawMenuCard(graphics: cc.Graphics, width: number, height: number): void {
        graphics.clear();
        graphics.fillColor = cc.color(24, 21, 16, 238);
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, 14);
        graphics.fill();
        graphics.strokeColor = cc.color(154, 104, 31, 235);
        graphics.lineWidth = 4;
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, 14);
        graphics.stroke();
        graphics.strokeColor = cc.color(255, 183, 55, 180);
        graphics.lineWidth = 2;
        graphics.moveTo(-width * 0.5 + 18, height * 0.5 - 48);
        graphics.lineTo(width * 0.5 - 18, height * 0.5 - 48);
        graphics.stroke();
    }

    private makeSpriteNode(
        parent: cc.Node,
        name: string,
        frame: cc.SpriteFrame | null,
        width: number,
        height: number,
        fallbackText: string = "?"
    ): cc.Node {
        const node = new cc.Node(name);
        node.parent = parent;
        node.setContentSize(width, height);
        const sprite = node.addComponent(cc.Sprite);
        sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        sprite.type = cc.Sprite.Type.SIMPLE;
        sprite.spriteFrame = frame;

        const fallback = new cc.Node(name + "Fallback");
        fallback.parent = node;
        fallback.setContentSize(width, height);
        const fallbackGraphics = fallback.addComponent(cc.Graphics);
        fallbackGraphics.fillColor = cc.color(28, 23, 16, 245);
        fallbackGraphics.roundRect(-width * 0.5, -height * 0.5, width, height, Math.min(18, height * 0.18));
        fallbackGraphics.fill();
        fallbackGraphics.strokeColor = cc.color(255, 183, 55, 235);
        fallbackGraphics.lineWidth = Math.max(2, Math.min(4, height * 0.05));
        fallbackGraphics.roundRect(-width * 0.5, -height * 0.5, width, height, Math.min(18, height * 0.18));
        fallbackGraphics.stroke();
        const fallbackLabel = this.makeLabel(
            fallback,
            name + "FallbackLabel",
            fallbackText,
            Math.min(34, Math.max(14, height * 0.38)),
            cc.color(255, 239, 204)
        );
        fallbackLabel.node.setContentSize(Math.max(20, width - 12), Math.max(20, height - 8));
        fallback.active = !frame;
        return node;
    }

    private makeArtworkNode(
        parent: cc.Node,
        name: string,
        frame: cc.SpriteFrame | null
    ): cc.Node {
        const node = new cc.Node(name);
        node.parent = parent;
        const sprite = node.addComponent(cc.Sprite);
        sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        sprite.type = cc.Sprite.Type.SIMPLE;
        sprite.spriteFrame = frame;
        node.active = !!frame;
        return node;
    }

    private applySpriteFrame(node: cc.Node, frame: cc.SpriteFrame | null): void {
        if (!node) {
            return;
        }
        const sprite = node.getComponent(cc.Sprite);
        if (sprite) {
            sprite.spriteFrame = frame;
        }
        const fallback = node.getChildByName(node.name + "Fallback");
        if (fallback) {
            fallback.active = !frame;
        }
    }

    private applyArtworkFrame(node: cc.Node, frame: cc.SpriteFrame | null): void {
        if (!node) {
            return;
        }
        const sprite = node.getComponent(cc.Sprite);
        if (sprite) {
            sprite.spriteFrame = frame;
        }
        node.active = !!frame;
    }

    private applyButtonFrame(button: cc.Node, frame: cc.SpriteFrame | null): void {
        if (!button) {
            return;
        }
        this.applySpriteFrame(button.getChildByName(button.name + "Visual"), frame);
    }

    /** Uses node scale with source dimensions so artwork is contained without stretching. */
    private layoutArtworkWithin(node: cc.Node, maximumWidth: number, maximumHeight: number): boolean {
        if (!node) {
            return false;
        }
        const sprite = node.getComponent(cc.Sprite);
        const frame = sprite && sprite.spriteFrame;
        node.active = !!frame;
        if (!frame) {
            return false;
        }
        const source = frame.getOriginalSize();
        const sourceWidth = Math.max(1, source.width);
        const sourceHeight = Math.max(1, source.height);
        node.setContentSize(sourceWidth, sourceHeight);
        node.scale = Math.min(maximumWidth / sourceWidth, maximumHeight / sourceHeight);
        return true;
    }

    private makeSpriteButton(
        parent: cc.Node,
        name: string,
        frame: cc.SpriteFrame | null,
        width: number,
        height: number,
        fallbackText: string,
        onTap: () => void,
        stopPropagation: boolean = false
    ): cc.Node {
        const node = new cc.Node(name);
        node.parent = parent;
        node.setContentSize(width, height);
        const visual = this.makeSpriteNode(node, name + "Visual", frame, width, height, fallbackText);
        node.on(cc.Node.EventType.TOUCH_START, (event: any) => {
            if (stopPropagation && event && typeof event.stopPropagation === "function") {
                event.stopPropagation();
            }
            visual.scale = 0.94;
            visual.color = cc.color(255, 222, 168);
        });
        node.on(cc.Node.EventType.TOUCH_END, (event: any) => {
            if (stopPropagation && event && typeof event.stopPropagation === "function") {
                event.stopPropagation();
            }
            visual.scale = 1;
            visual.color = cc.Color.WHITE;
            onTap();
        });
        node.on(cc.Node.EventType.TOUCH_CANCEL, (event: any) => {
            if (stopPropagation && event && typeof event.stopPropagation === "function") {
                event.stopPropagation();
            }
            visual.scale = 1;
            visual.color = cc.Color.WHITE;
        });
        return node;
    }

    private makeLabel(
        parent: cc.Node,
        name: string,
        text: string,
        fontSize: number,
        color: cc.Color
    ): cc.Label {
        const node = new cc.Node(name);
        node.parent = parent;
        node.color = color;
        const label = node.addComponent(cc.Label);
        label.string = text;
        label.fontFamily = "Arial";
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.18);
        label.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
        label.verticalAlign = cc.Label.VerticalAlign.CENTER;
        label.overflow = cc.Label.Overflow.SHRINK;
        node.setContentSize(700, Math.max(42, fontSize + 12));
        return label;
    }

    private makeTapButton(
        parent: cc.Node,
        name: string,
        text: string,
        width: number,
        height: number,
        baseColor: cc.Color,
        accentColor: cc.Color,
        onTap: () => void
    ): cc.Node {
        const node = new cc.Node(name);
        node.parent = parent;
        node.setContentSize(width, height);
        const graphics = node.addComponent(cc.Graphics);
        const redraw = (active: boolean): void => {
            graphics.clear();
            graphics.fillColor = active ? accentColor : baseColor;
            graphics.roundRect(-width * 0.5, -height * 0.5, width, height, Math.min(18, height * 0.22));
            graphics.fill();
            graphics.strokeColor = accentColor;
            graphics.lineWidth = active ? 4 : 2;
            graphics.roundRect(-width * 0.5, -height * 0.5, width, height, Math.min(18, height * 0.22));
            graphics.stroke();
        };
        redraw(false);
        const label = this.makeLabel(node, name + "Label", text, text.length > 3 ? 18 : 35, cc.color(245, 248, 255));
        label.node.setContentSize(width - 12, height - 10);

        node.on(cc.Node.EventType.TOUCH_START, () => {
            node.scale = 0.95;
            redraw(true);
        });
        node.on(cc.Node.EventType.TOUCH_END, () => {
            node.scale = 1;
            redraw(false);
            onTap();
        });
        node.on(cc.Node.EventType.TOUCH_CANCEL, () => {
            node.scale = 1;
            redraw(false);
        });
        return node;
    }

    private showTransient(text: string, color: cc.Color, expiresAtMs: number): void {
        this.judgementLabel.string = text;
        this.judgementLabel.node.color = color;
        this.messageExpiresAtMs = expiresAtMs;
    }

    private restoreLastResult(): void {
        this.judgementLabel.string = this.lastResultText;
        this.judgementLabel.node.color = this.lastResultColor;
        this.messageExpiresAtMs = 0;
    }

    private judgementColor(grade: string): cc.Color {
        switch (grade) {
            case "Perfect":
                return cc.color(255, 207, 82);
            case "Good":
                return cc.color(142, 242, 151);
            case "Bad":
                return cc.color(255, 202, 92);
            default:
                return cc.color(255, 104, 136);
        }
    }

    private outcomeColor(outcome: SongOutcome): cc.Color {
        return outcome.passed ? cc.color(142, 242, 151) : cc.color(255, 104, 136);
    }

    private gradeFillColor(grade: JudgeGrade): cc.Color {
        switch (grade) {
            case "Perfect":
                return cc.color(100, 67, 20, 240);
            case "Good":
                return cc.color(34, 94, 72, 240);
            case "Bad":
                return cc.color(105, 76, 35, 240);
            default:
                return cc.color(99, 38, 63, 240);
        }
    }

    private padScore(score: number): string {
        const value = String(Math.max(0, Math.floor(score)));
        return ("000000" + value).slice(-6);
    }

    private onGameHide(): void {
        this.pauseForHost();
    }

    private onGameShow(): void {
        this.resumeFromHostIfVisible();
    }

    private onVisibilityChange(): void {
        if (this.isDocumentHidden()) {
            this.pauseForHost();
        } else {
            this.resumeFromHostIfVisible();
        }
    }

    private pauseForHost(): void {
        this.hostSuspended = true;
        if (!this.gameplayActive) {
            this.cancelPendingGameplayStart();
            this.stopSongPreview();
        }
        if (this.dancerController) {
            this.dancerController.pause();
        }
        if (this.input) {
            this.input.resetPressed();
        }
        if (this.clock.isStarted() && !this.clock.isPaused()) {
            this.clock.pause();
            this.pausedByHost = true;
        }
        if (canEnterGameplay(this.startupState)) {
            this.instructionLabel.string = "宿主已暂停 · 返回后继续";
        }
    }

    private resumeFromHostIfVisible(): void {
        if (this.isDocumentHidden()) {
            return;
        }
        this.hostSuspended = false;
        if (this.dancerController) {
            this.dancerController.resume();
        }
        if (this.input) {
            this.input.resetPressed();
        }
        if (this.pausedByHost) {
            if (this.gameplayActive && !this.clockHeldForDanceFlow
                && this.danceFlow.getSnapshot().phase === "input") {
                this.clock.resume();
            }
            this.pausedByHost = false;
        }
        this.restoreInstructionForPhase();
        this.layout();
    }

    private restoreInstructionForPhase(): void {
        const flow = this.danceFlow.getSnapshot();
        if (flow.phase === "dance" && flow.segment) {
            this.instructionLabel.string = this.danceInstruction(flow.segment);
        } else if (flow.phase === "result") {
            const snapshot = this.engine.getSnapshot();
            const outcome = this.currentOutcome || resolveSongOutcome(this.activeSong, snapshot.score);
            this.instructionLabel.string = this.resultInstruction(outcome);
        } else if (this.gameplayActive) {
            this.instructionLabel.string = "方向键 / WASD · 在每个箭头的目标时刻直接输入";
        }
    }

    private onWindowBlur(): void {
        if (this.input) {
            this.input.resetPressed();
        }
    }

    private isDocumentHidden(): boolean {
        return typeof document !== "undefined" && !!document.hidden;
    }

    private onWindowResize(): void {
        this.scheduleOnce(() => this.layout(), 0);
    }
}
