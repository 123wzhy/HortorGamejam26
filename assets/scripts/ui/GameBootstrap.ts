import { DEMO_BEATMAP, Direction } from "../domain/Beatmap";
import { GroupNoteStatus, EngineAction, SequenceEngine } from "../gameplay/SequenceEngine";
import { DEFAULT_JUDGE_WINDOWS, JudgeGrade, JudgeSystem } from "../gameplay/JudgeSystem";
import { noteApproachProgress, timelineProgress } from "../gameplay/TimingProgress";
import { InputRouter } from "../input/InputRouter";
import { BuildaAdapter, BuildaViewportMetrics, calculateRightAvoidance } from "../platform/BuildaAdapter";
import { SongClock } from "../timing/SongClock";
import { calculateNoteChipVerticalLayout, calculateRhythmVerticalLayout } from "./RhythmLayout";

const { ccclass } = cc._decorator;

const ARROW_TEXT: { [key: string]: string } = {
    left: "←",
    down: "↓",
    up: "↑",
    right: "→"
};

const DIRECTION_NAME: { [key: string]: string } = {
    left: "左",
    down: "下",
    up: "上",
    right: "右"
};

const GRADE_TEXT: { [key: string]: string } = {
    Perfect: "完美",
    Good: "好",
    Bad: "差",
    Miss: "失败"
};

const NOTE_APPROACH_MS = 1200;
const GROUP_RESULT_HOLD_MS = 420;

interface NoteChipView {
    node: cc.Node;
    card: cc.Graphics;
    miniBar: cc.Graphics;
    arrow: cc.Label;
    status: cc.Label;
    noteIndex: number;
    width: number;
    height: number;
}

@ccclass
export default class GameBootstrap extends cc.Component {
    private readonly adapter: BuildaAdapter = new BuildaAdapter();
    private readonly clock: SongClock = new SongClock();
    private readonly judge: JudgeSystem = new JudgeSystem();
    private readonly engine: SequenceEngine = new SequenceEngine(DEMO_BEATMAP, this.judge);
    private readonly songDurationMs: number =
        DEMO_BEATMAP.groups[DEMO_BEATMAP.groups.length - 1].notes.slice(-1)[0].targetTimeMs
        + DEFAULT_JUDGE_WINDOWS.badMs;
    private input: InputRouter | null = null;

    private root: cc.Node = null;
    private background: cc.Graphics = null;
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
        this.lastResultColor = cc.color(159, 176, 255);
        this.buildUi();
        this.input = new InputRouter(
            (direction) => this.onDirection(direction),
            () => this.restartGame()
        );
        this.input.attach();
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

        this.layout();
        this.showTransient("正在连接宿主", cc.color(159, 176, 255), Number.POSITIVE_INFINITY);
        if (this.isDocumentHidden()) {
            this.pauseForHost();
        }

        this.adapter.ready().then(() => {
            if (!cc.isValid(this.node)) {
                return;
            }
            this.platformReady = true;
            this.layout();
            this.restartGame();
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
        if (!this.platformReady || !this.clock.isStarted() || this.clock.isPaused()) {
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

        const backgroundNode = new cc.Node("Background");
        backgroundNode.parent = this.root;
        this.background = backgroundNode.addComponent(cc.Graphics);

        const stageNode = new cc.Node("OriginalStage");
        stageNode.parent = this.root;
        this.stage = stageNode.addComponent(cc.Graphics);

        this.dancerNode = new cc.Node("AbstractDancer");
        this.dancerNode.parent = this.root;
        this.drawDancer(this.dancerNode.addComponent(cc.Graphics));

        const panelNode = new cc.Node("CurrentGroupPanel");
        panelNode.parent = this.root;
        this.groupPanel = panelNode.addComponent(cc.Graphics);

        this.levelLabel = this.makeLabel(this.root, "Level", "STAGE 01 · 节拍训练场", 20, cc.color(234, 240, 255));
        this.trackLabel = this.makeLabel(this.root, "Track", DEMO_BEATMAP.title, 14, cc.color(159, 176, 255));
        this.hostLabel = this.makeLabel(this.root, "Host", "正在初始化", 11, cc.color(104, 226, 255));
        this.scoreLabel = this.makeLabel(this.root, "Score", "得分\n000000", 31, cc.color(245, 248, 255));
        this.judgementLabel = this.makeLabel(this.root, "Judgement", "等待第一键", 23, cc.color(159, 176, 255));
        this.comboLabel = this.makeLabel(this.root, "Combo", "连击 0\n最高 0", 21, cc.color(104, 226, 255));
        this.groupLabel = this.makeLabel(this.root, "Group", "组合 1 / 8", 15, cc.color(192, 202, 233));
        this.progressLabel = this.makeLabel(this.root, "Progress", "谱面 0% · 等待开始", 13, cc.color(192, 202, 233));
        this.instructionLabel = this.makeLabel(
            this.root,
            "Instruction",
            "方向键 / WASD · 在每个箭头的目标时刻直接输入",
            13,
            cc.color(145, 157, 194)
        );

        this.sequenceRow = new cc.Node("GroupNotes");
        this.sequenceRow.parent = this.root;

        const globalTimelineNode = new cc.Node("SongJudgeTimeline");
        globalTimelineNode.parent = this.root;
        this.globalTimeline = globalTimelineNode.addComponent(cc.Graphics);

        this.directionPad = new cc.Node("DirectionPad");
        this.directionPad.parent = this.root;
        const directions: Direction[] = ["left", "down", "up", "right"];
        directions.forEach((direction, index) => {
            const button = this.makeTapButton(
                this.directionPad,
                "Touch-" + direction,
                ARROW_TEXT[direction] + "  " + DIRECTION_NAME[direction],
                136,
                84,
                cc.color(33, 43, 77),
                cc.color(104, 226, 255),
                () => this.input && this.input.routeDirection(direction)
            );
            button.x = (index - 1.5) * 150;
            this.directionButtons.push(button);
        });

        this.restartButton = this.makeTapButton(
            this.root,
            "RestartButton",
            "重新开始",
            126,
            40,
            cc.color(30, 38, 68),
            cc.color(159, 176, 255),
            () => this.input && this.input.routeRestart()
        );
    }

    private layout(): void {
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
        const padNaturalWidth = 586;
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

        this.drawBackground();
        this.drawStage();
        this.drawGroupPanel();

        const topY = halfHeight - vertical.safeTopApplied - 25;
        const leftX = -halfWidth + this.metrics.safe.left + 22;
        const leftBoxWidth = Math.min(350, Math.max(230, contentWidth * 0.31));
        this.levelLabel.node.setContentSize(leftBoxWidth, 30);
        this.levelLabel.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
        this.levelLabel.node.setPosition(leftX + leftBoxWidth * 0.5, topY);
        this.trackLabel.node.setContentSize(leftBoxWidth, 24);
        this.trackLabel.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
        this.trackLabel.node.setPosition(leftX + leftBoxWidth * 0.5, topY - 29);
        this.hostLabel.string = (this.metrics.hosted ? "BUILDA RUNTIME" : "浏览器兼容模式")
            + (vertical.safeInsetsClamped ? " · 安全区受限" : "");
        this.hostLabel.node.setContentSize(leftBoxWidth, 20);
        this.hostLabel.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
        this.hostLabel.node.setPosition(leftX + leftBoxWidth * 0.5, topY - 52);

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

    private restartGame(): void {
        if (!this.platformReady) {
            return;
        }
        this.engine.restart();
        this.clock.restart();
        this.pausedByHost = false;
        this.heldGroupIndex = -1;
        this.holdUntilSongTimeMs = 0;
        this.groupRenderKey = "";
        this.lastResultText = "等待第一键";
        this.lastResultColor = cc.color(159, 176, 255);
        this.showTransient("准备", cc.color(159, 176, 255), 800);
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
        if (!this.platformReady || this.clock.isPaused()) {
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

            const arrow = this.makeLabel(
                chip,
                "Arrow",
                ARROW_TEXT[item.note.direction],
                chipLayout.arrowFontSize,
                cc.color(245, 248, 255)
            );
            arrow.node.setContentSize(chipWidth - 10, chipLayout.arrowBoxHeight);
            arrow.node.setPosition(0, chipLayout.arrowY);
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
            ? cc.color(104, 226, 255)
            : cc.color(79, 91, 132);
        const fill = grade
            ? this.gradeFillColor(grade)
            : status.current ? cc.color(65, 48, 124, 245) : cc.color(29, 36, 65, 235);

        view.card.clear();
        view.card.fillColor = fill;
        view.card.roundRect(-view.width * 0.5, -view.height * 0.5, view.width, view.height, 13);
        view.card.fill();
        view.card.strokeColor = accent;
        view.card.lineWidth = status.current ? 4 : 2;
        view.card.roundRect(-view.width * 0.5, -view.height * 0.5, view.width, view.height, 13);
        view.card.stroke();

        view.arrow.node.color = grade || status.current ? cc.color(248, 251, 255) : cc.color(173, 183, 214);
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
        view.miniBar.strokeColor = cc.color(57, 68, 105);
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
            : cc.color(104, 226, 255);

        this.globalTimeline.clear();
        this.globalTimeline.lineCap = cc.Graphics.LineCap.ROUND;
        this.globalTimeline.strokeColor = cc.color(47, 57, 92);
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
            this.progressLabel.node.color = cc.color(192, 202, 233);
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

    private drawBackground(): void {
        const width = this.viewportWidth;
        const height = this.viewportHeight;
        this.background.clear();
        this.background.fillColor = cc.color(7, 11, 28);
        this.background.rect(-width * 0.5, -height * 0.5, width, height);
        this.background.fill();

        this.background.fillColor = cc.color(77, 40, 133, 80);
        this.background.circle(width * 0.36, height * 0.23, 250);
        this.background.fill();
        this.background.fillColor = cc.color(10, 126, 139, 55);
        this.background.circle(-width * 0.39, -height * 0.25, 285);
        this.background.fill();

        this.background.strokeColor = cc.color(255, 105, 213, 25);
        this.background.lineWidth = 2;
        for (let y = -height * 0.5; y <= height * 0.5; y += 54) {
            this.background.moveTo(-width * 0.5, y);
            this.background.lineTo(width * 0.5, y + 38);
        }
        this.background.stroke();
    }

    private drawStage(): void {
        const compact = this.viewportHeight < 640;
        const width = Math.min(650, this.panelWidth * 0.72);
        const height = compact ? 78 : 110;
        this.stage.clear();

        this.stage.fillColor = cc.color(16, 24, 52, 180);
        this.stage.moveTo(-width * 0.5, -height * 0.25);
        this.stage.lineTo(-width * 0.34, height * 0.4);
        this.stage.lineTo(width * 0.34, height * 0.4);
        this.stage.lineTo(width * 0.5, -height * 0.25);
        this.stage.close();
        this.stage.fill();
        this.stage.strokeColor = cc.color(104, 226, 255, 110);
        this.stage.lineWidth = 3;
        this.stage.moveTo(-width * 0.5, -height * 0.25);
        this.stage.lineTo(width * 0.5, -height * 0.25);
        this.stage.stroke();

        this.stage.fillColor = cc.color(104, 226, 255, 28);
        this.stage.moveTo(-width * 0.36, height * 0.42);
        this.stage.lineTo(-width * 0.08, -height * 0.28);
        this.stage.lineTo(-width * 0.48, -height * 0.28);
        this.stage.close();
        this.stage.fill();
        this.stage.fillColor = cc.color(255, 105, 213, 28);
        this.stage.moveTo(width * 0.36, height * 0.42);
        this.stage.lineTo(width * 0.48, -height * 0.28);
        this.stage.lineTo(width * 0.08, -height * 0.28);
        this.stage.close();
        this.stage.fill();
    }

    private drawDancer(graphics: cc.Graphics): void {
        graphics.clear();
        graphics.fillColor = cc.color(241, 245, 255);
        graphics.circle(0, 38, 12);
        graphics.fill();
        graphics.fillColor = cc.color(104, 226, 255);
        graphics.roundRect(-15, 3, 30, 31, 9);
        graphics.fill();
        graphics.strokeColor = cc.color(255, 105, 213);
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
        this.groupPanel.fillColor = cc.color(14, 20, 45, 244);
        this.groupPanel.roundRect(
            -this.panelWidth * 0.5,
            -this.panelHeight * 0.5,
            this.panelWidth,
            this.panelHeight,
            22
        );
        this.groupPanel.fill();
        this.groupPanel.strokeColor = cc.color(103, 82, 171, 180);
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
                return cc.color(104, 226, 255);
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
                return cc.color(24, 92, 112, 240);
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
