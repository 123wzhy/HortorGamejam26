import { DEMO_BEATMAP, Direction } from "../domain/Beatmap";
import { GroupNoteStatus, EngineAction, SequenceEngine } from "../gameplay/SequenceEngine";
import { DEFAULT_JUDGE_WINDOWS, JudgeGrade, JudgeSystem } from "../gameplay/JudgeSystem";
import { noteApproachProgress, timelineProgress } from "../gameplay/TimingProgress";
import { InputRouter } from "../input/InputRouter";
import { BuildaAdapter, BuildaViewportMetrics, calculateRightAvoidance } from "../platform/BuildaAdapter";
import { SongClock } from "../timing/SongClock";
import { ArtAssetCatalog, ArtAssetName } from "./ArtAssetCatalog";
import { calculateNoteChipVerticalLayout, calculateRhythmVerticalLayout } from "./RhythmLayout";

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
const GROUP_RESULT_HOLD_MS = 420;

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

@ccclass
export default class GameBootstrap extends cc.Component {
    private readonly adapter: BuildaAdapter = new BuildaAdapter();
    private readonly art: ArtAssetCatalog = new ArtAssetCatalog();
    private readonly clock: SongClock = new SongClock();
    private readonly judge: JudgeSystem = new JudgeSystem();
    private readonly engine: SequenceEngine = new SequenceEngine(DEMO_BEATMAP, this.judge);
    private readonly songDurationMs: number =
        DEMO_BEATMAP.groups[DEMO_BEATMAP.groups.length - 1].notes.slice(-1)[0].targetTimeMs
        + DEFAULT_JUDGE_WINDOWS.badMs;
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
    private menuTaskGraphics: cc.Graphics = null;
    private menuTaskLabel: cc.Label = null;
    private menuSongPanel: cc.Node = null;
    private menuSongGraphics: cc.Graphics = null;
    private menuSongLabel: cc.Label = null;
    private menuHintRow: cc.Node = null;
    private menuStatusLabel: cc.Label = null;
    private infoOverlay: cc.Node = null;
    private infoBackdrop: cc.Graphics = null;
    private infoPanel: cc.Graphics = null;
    private infoTitle: cc.Label = null;
    private infoBody: cc.Label = null;
    private stage: cc.Graphics = null;
    private dancerNode: cc.Node = null;
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
    private platformReady: boolean = false;
    private uiReady: boolean = false;
    private gameplayActive: boolean = false;
    private pausedByHost: boolean = false;
    private hostSuspended: boolean = false;
    private groupRenderKey: string = "";
    private heldGroupIndex: number = -1;
    private holdUntilSongTimeMs: number = 0;
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
        this.art.load().then((missing) => {
            if (!cc.isValid(this.node)) {
                return;
            }
            this.buildUi();
            this.input = new InputRouter(
                (direction) => this.onDirection(direction),
                () => this.restartGame()
            );
            this.input.attach();
            this.uiReady = true;
            this.layout();
            this.showMenu();
            this.menuStatusLabel.string = missing.length > 0
                ? "部分美术加载失败，已启用可操作降级界面"
                : "正在连接创游世界…";
            if (this.isDocumentHidden()) {
                this.pauseForHost();
            }

            this.adapter.ready().then(() => {
                if (!cc.isValid(this.node)) {
                    return;
                }
                this.platformReady = true;
                this.layout();
                this.menuStatusLabel.string = missing.length > 0
                    ? "美术资源不完整 · 可继续体验"
                    : "准备就绪 · 点击开始跳舞";
            });
        });
    }

    protected onDestroy(): void {
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

    protected update(): void {
        if (!this.gameplayActive || !this.platformReady || !this.clock.isStarted() || this.clock.isPaused()) {
            return;
        }

        const songTimeMs = this.clock.currentTimeMs();
        this.presentActions(this.engine.update(songTimeMs), songTimeMs);
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
        this.root = new cc.Node("RhythmUI");
        this.root.parent = this.node;

        this.backgroundNode = new cc.Node("Background");
        this.backgroundNode.parent = this.root;
        const backgroundFallbackNode = new cc.Node("BackgroundFallback");
        backgroundFallbackNode.parent = this.backgroundNode;
        this.backgroundFallback = backgroundFallbackNode.addComponent(cc.Graphics);
        const backgroundFrame = this.art.get("BackGround");
        if (backgroundFrame) {
            this.backgroundSpriteNode = new cc.Node("BackgroundArtwork");
            this.backgroundSpriteNode.parent = this.backgroundNode;
            this.backgroundSprite = this.backgroundSpriteNode.addComponent(cc.Sprite);
            this.backgroundSprite.spriteFrame = backgroundFrame;
            this.backgroundSprite.sizeMode = cc.Sprite.SizeMode.RAW;
        }

        this.gameRoot = new cc.Node("Gameplay");
        this.gameRoot.parent = this.root;
        this.menuRoot = new cc.Node("MainMenu");
        this.menuRoot.parent = this.root;

        this.menuLogo = this.makeSpriteNode(this.menuRoot, "MenuLogo", this.art.get("logo"), 320, 214);
        this.gameLogo = this.makeSpriteNode(this.gameRoot, "GameLogo", this.art.get("logo"), 320, 214);
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
        this.menuTaskLabel = this.makeLabel(
            this.menuTaskPanel,
            "TodayTaskText",
            "今日目标\n\n完成 3 组舞步\n获得 8000 分\n连击达到 10 次",
            18,
            cc.color(255, 239, 204)
        );
        this.menuTaskLabel.horizontalAlign = cc.Label.HorizontalAlign.LEFT;

        this.menuSongPanel = new cc.Node("SongPanel");
        this.menuSongPanel.parent = this.menuRoot;
        this.menuSongGraphics = this.menuSongPanel.addComponent(cc.Graphics);
        this.menuSongLabel = this.makeLabel(
            this.menuSongPanel,
            "SongText",
            "选择歌曲\n\n▶  " + DEMO_BEATMAP.title + "\n    100 BPM · 8 组舞步",
            18,
            cc.color(255, 239, 204)
        );
        this.menuSongLabel.horizontalAlign = cc.Label.HorizontalAlign.LEFT;

        this.menuHintRow = new cc.Node("ControlHint");
        this.menuHintRow.parent = this.menuRoot;
        const directions: Direction[] = ["left", "down", "up", "right"];
        directions.forEach((direction, index) => {
            const arrow = this.makeSpriteNode(
                this.menuHintRow,
                "Hint-" + direction,
                this.art.get(DIRECTION_ART[direction]),
                54,
                53
            );
            arrow.x = (index - 2.2) * 58;
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
            "正在加载美术资源…",
            14,
            cc.color(255, 224, 139)
        );

        const stageNode = new cc.Node("OriginalStage");
        stageNode.parent = this.gameRoot;
        this.stage = stageNode.addComponent(cc.Graphics);

        this.dancerNode = new cc.Node("AbstractDancer");
        this.dancerNode.parent = this.gameRoot;
        this.drawDancer(this.dancerNode.addComponent(cc.Graphics));

        const panelNode = new cc.Node("CurrentGroupPanel");
        panelNode.parent = this.gameRoot;
        this.groupPanel = panelNode.addComponent(cc.Graphics);

        this.levelLabel = this.makeLabel(this.gameRoot, "Level", "节拍训练场", 18, cc.color(255, 239, 204));
        this.trackLabel = this.makeLabel(this.gameRoot, "Track", DEMO_BEATMAP.title, 14, cc.color(255, 207, 82));
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
        directions.forEach((direction, index) => {
            const button = this.makeSpriteButton(
                this.directionPad,
                "Touch-" + direction,
                this.art.get(DIRECTION_TOUCH_ART[direction]),
                82,
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
        this.dancerNode.active = this.stageVisible;
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
        const logoScale = compact ? 0.52 : 0.68;
        this.menuLogo.scale = logoScale;
        this.menuLogo.setPosition(
            -halfWidth + this.metrics.safe.left + 18 + 160 * logoScale,
            halfHeight - this.metrics.safe.top - 16 - 107 * logoScale
        );

        const topScale = compact ? 0.55 : 0.66;
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

        const cardWidth = Math.min(310, contentWidth * 0.28);
        const cardHeight = compact ? 164 : 190;
        const cardSideMargin = Math.max(24, Math.min(42, contentWidth * 0.035));
        const cardY = compact ? 2 : 22;
        this.menuTaskPanel.setPosition(
            -halfWidth + this.metrics.safe.left + cardSideMargin + cardWidth * 0.5,
            cardY
        );
        this.menuSongPanel.setPosition(
            halfWidth - this.metrics.safe.right - cardSideMargin - cardWidth * 0.5,
            cardY
        );
        this.drawMenuCard(this.menuTaskGraphics, cardWidth, cardHeight);
        this.drawMenuCard(this.menuSongGraphics, cardWidth, cardHeight);
        this.menuTaskLabel.node.setContentSize(cardWidth - 42, cardHeight - 30);
        this.menuSongLabel.node.setContentSize(cardWidth - 42, cardHeight - 30);

        const startScale = Math.min(compact ? 0.62 : 0.76, Math.max(0.54, (contentWidth - 80) / 527));
        const hintY = -halfHeight + this.metrics.safe.bottom + 40;
        const startY = hintY + 50 + 72.5 * startScale;
        this.menuStartButton.scale = startScale;
        this.menuStartButton.setPosition(contentCenterX, startY);
        this.menuHintRow.setPosition(contentCenterX, hintY);
        this.menuStatusLabel.node.setContentSize(Math.min(620, contentWidth - 40), 24);
        this.menuStatusLabel.node.setPosition(contentCenterX, startY + 82 * startScale);
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
        if (!this.platformReady) {
            this.menuStatusLabel.string = "仍在连接创游世界，请稍候…";
            return;
        }
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
        if (this.clock.isStarted() && !this.clock.isPaused()) {
            this.clock.pause();
        }
        if (this.input) {
            this.input.resetPressed();
        }
        this.gameplayActive = false;
        this.gameRoot.active = false;
        this.menuRoot.active = true;
        this.hideInfo();
        this.refreshMenuSummary();
        console.info("[GameBootstrap] screen=menu");
        this.layout();
    }

    private refreshMenuSummary(): void {
        const snapshot = this.engine.getSnapshot();
        const completedGroups = snapshot.finished ? snapshot.groupCount : snapshot.groupIndex;
        const groupMark = completedGroups >= 3 ? "✓" : "·";
        const scoreMark = snapshot.score >= 8000 ? "✓" : "·";
        const comboMark = snapshot.maxCombo >= 10 ? "✓" : "·";
        this.menuTaskLabel.string = "今日目标\n\n"
            + groupMark + "  完成 3 组舞步    " + Math.min(completedGroups, 3) + "/3\n"
            + scoreMark + "  获得 8000 分      " + snapshot.score + "/8000\n"
            + comboMark + "  连击达到 10 次   " + snapshot.maxCombo + "/10";
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
        const snapshot = this.engine.getSnapshot();
        this.showInfo(
            "本局成绩",
            "当前得分：" + snapshot.score + "\n"
            + "最高连击：" + snapshot.maxCombo + "\n"
            + "已完成舞步：" + snapshot.settledNoteCount + " / " + snapshot.totalNoteCount + "\n\n"
            + "平台排行榜尚未配置，因此这里不会伪造全服名次。"
        );
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
        console.info("[GameBootstrap] overlay=" + title);
    }

    private hideInfo(): void {
        if (this.infoOverlay) {
            this.infoOverlay.active = false;
        }
    }

    private restartGame(): void {
        if (!this.platformReady || !this.gameplayActive) {
            return;
        }
        this.engine.restart();
        this.clock.restart();
        this.pausedByHost = false;
        this.heldGroupIndex = -1;
        this.holdUntilSongTimeMs = 0;
        this.groupRenderKey = "";
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

    private onDirection(direction: Direction): void {
        if (!this.gameplayActive || !this.platformReady || this.clock.isPaused()) {
            return;
        }
        const songTimeMs = this.clock.currentTimeMs();
        this.presentActions(this.engine.inputDirection(direction, songTimeMs), songTimeMs);
        this.renderGroup(songTimeMs);
        this.updateNoteChips(songTimeMs);
        this.updateGlobalTimeline(songTimeMs);
        this.refreshStats();
    }

    private presentActions(actions: EngineAction[], songTimeMs: number): void {
        actions.forEach((action) => this.presentAction(action, songTimeMs));
    }

    private presentAction(action: EngineAction, songTimeMs: number): void {
        if (action.groupCompleted) {
            this.heldGroupIndex = action.groupIndex;
            this.holdUntilSongTimeMs = action.finished
                ? Number.POSITIVE_INFINITY
                : songTimeMs + GROUP_RESULT_HOLD_MS;
            this.groupRenderKey = "";
        }

        if (action.kind === "tooEarly") {
            this.showTransient("还没到判定窗口，请等待", cc.color(255, 210, 112), songTimeMs + 380);
        } else if (action.judgement) {
            const timing = action.judgement.grade === "Miss"
                ? ""
                : "  " + (action.judgement.deltaMs >= 0 ? "+" : "")
                    + Math.round(action.judgement.deltaMs) + "ms";
            const suffix = action.finished ? " · 完成" : "";
            this.lastResultText = GRADE_TEXT[action.judgement.grade] + timing + suffix;
            this.lastResultColor = this.judgementColor(action.judgement.grade);
            this.restoreLastResult();
        }

        if (action.finished) {
            this.instructionLabel.string = "COMPLETE / 完成 · 点击重新开始或按 R";
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

            const arrowNode = this.makeSpriteNode(
                chip,
                "Arrow",
                this.art.get(DIRECTION_ART[item.note.direction]),
                Math.min(chipWidth - 18, chipLayout.arrowBoxHeight + 8),
                Math.min(chipWidth - 18, chipLayout.arrowBoxHeight + 8)
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

    private displayedGroupIndex(songTimeMs: number): number {
        const snapshot = this.engine.getSnapshot();
        if (this.heldGroupIndex >= 0) {
            if (snapshot.finished || songTimeMs < this.holdUntilSongTimeMs) {
                return this.heldGroupIndex;
            }
            this.heldGroupIndex = -1;
            this.groupRenderKey = "";
        }
        return Math.min(snapshot.groupIndex, snapshot.groupCount - 1);
    }

    private updateGlobalTimeline(songTimeMs: number): void {
        const snapshot = this.engine.getSnapshot();
        const currentNote = this.engine.getCurrentNote();
        const width = this.globalBarWidth;
        const x = -width * 0.5;
        const progress = snapshot.finished ? 1 : timelineProgress(songTimeMs, this.songDurationMs);
        const feedbackColor = snapshot.lastJudgement
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

        if (snapshot.finished) {
            this.progressLabel.string = "谱面 100% · COMPLETE / 完成";
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
        const beatDuration = 60000 / DEMO_BEATMAP.bpm;
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
        height: number
    ): cc.Node {
        const node = new cc.Node(name);
        node.parent = parent;
        node.setContentSize(width, height);
        const sprite = node.addComponent(cc.Sprite);
        sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        sprite.type = cc.Sprite.Type.SIMPLE;
        sprite.spriteFrame = frame;
        if (!frame) {
            const fallback = this.makeLabel(node, name + "Fallback", "?", Math.min(34, height * 0.5), cc.Color.WHITE);
            fallback.node.setContentSize(width, height);
        }
        return node;
    }

    private makeSpriteButton(
        parent: cc.Node,
        name: string,
        frame: cc.SpriteFrame | null,
        width: number,
        height: number,
        fallbackText: string,
        onTap: () => void
    ): cc.Node {
        const node = new cc.Node(name);
        node.parent = parent;
        node.setContentSize(width, height);
        const visual = this.makeSpriteNode(node, name + "Visual", frame, width, height);
        if (!frame) {
            const label = visual.getChildByName(name + "VisualFallback");
            const component = label && label.getComponent(cc.Label);
            if (component) {
                component.string = fallbackText;
            }
        }
        node.on(cc.Node.EventType.TOUCH_START, () => {
            visual.scale = 0.94;
            visual.color = cc.color(255, 222, 168);
        });
        node.on(cc.Node.EventType.TOUCH_END, () => {
            visual.scale = 1;
            visual.color = cc.Color.WHITE;
            onTap();
        });
        node.on(cc.Node.EventType.TOUCH_CANCEL, () => {
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
        if (this.input) {
            this.input.resetPressed();
        }
        if (this.clock.isStarted() && !this.clock.isPaused()) {
            this.clock.pause();
            this.pausedByHost = true;
        }
        if (this.platformReady) {
            this.instructionLabel.string = "宿主已暂停 · 返回后继续";
        }
    }

    private resumeFromHostIfVisible(): void {
        if (this.isDocumentHidden()) {
            return;
        }
        this.hostSuspended = false;
        if (this.input) {
            this.input.resetPressed();
        }
        if (this.pausedByHost) {
            this.clock.resume();
            this.pausedByHost = false;
            this.instructionLabel.string = this.engine.getSnapshot().finished
                ? "COMPLETE / 完成 · 点击重新开始或按 R"
                : "方向键 / WASD · 在每个箭头的目标时刻直接输入";
        }
        this.layout();
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
