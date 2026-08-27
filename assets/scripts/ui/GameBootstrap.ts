import { DEMO_BEATMAP, Direction } from "../domain/Beatmap";
import { EngineAction, SequenceEngine } from "../gameplay/SequenceEngine";
import { JudgeSystem } from "../gameplay/JudgeSystem";
import { InputRouter } from "../input/InputRouter";
import { BuildaAdapter, BuildaViewportMetrics } from "../platform/BuildaAdapter";
import { SongClock } from "../timing/SongClock";

const { ccclass } = cc._decorator;

const ARROW_TEXT: { [key: string]: string } = {
    left: "←",
    down: "↓",
    up: "↑",
    right: "→"
};

@ccclass
export default class GameBootstrap extends cc.Component {
    private readonly adapter: BuildaAdapter = new BuildaAdapter();
    private readonly clock: SongClock = new SongClock();
    private readonly judge: JudgeSystem = new JudgeSystem();
    private readonly engine: SequenceEngine = new SequenceEngine(DEMO_BEATMAP, this.judge);
    private input: InputRouter | null = null;

    private root: cc.Node = null;
    private background: cc.Graphics = null;
    private sequencePanel: cc.Graphics = null;
    private sequenceRow: cc.Node = null;
    private timeline: cc.Graphics = null;
    private pulseNode: cc.Node = null;
    private scoreLabel: cc.Label = null;
    private comboLabel: cc.Label = null;
    private phraseLabel: cc.Label = null;
    private countdownLabel: cc.Label = null;
    private judgementLabel: cc.Label = null;
    private instructionLabel: cc.Label = null;
    private titleLabel: cc.Label = null;
    private hostLabel: cc.Label = null;
    private directionPad: cc.Node = null;
    private beatButton: cc.Node = null;
    private restartButton: cc.Node = null;

    private viewportWidth: number = 1280;
    private viewportHeight: number = 720;
    private panelWidth: number = 960;
    private metrics: BuildaViewportMetrics = {
        safe: { top: 0, right: 0, bottom: 0, left: 0 },
        capsule: { top: 0, right: 0, width: 0, height: 0 },
        hosted: false
    };
    private platformReady: boolean = false;
    private pausedByHost: boolean = false;
    private sequenceRenderKey: string = "";
    private messageExpiresAtMs: number = 0;
    private resizeHandler: (() => void) | null = null;

    protected onLoad(): void {
        cc.game.setFrameRate(60);
        cc.view.resizeWithBrowserSize(true);
        this.buildUi();
        this.input = new InputRouter(
            (direction) => this.onDirection(direction),
            () => this.onBeat(),
            () => this.restartGame()
        );
        this.input.attach();
        cc.game.on(cc.game.EVENT_HIDE, this.onGameHide, this);
        cc.game.on(cc.game.EVENT_SHOW, this.onGameShow, this);

        if (typeof window !== "undefined") {
            this.resizeHandler = this.onWindowResize.bind(this);
            window.addEventListener("resize", this.resizeHandler);
        }
        this.layout();
        this.setJudgement("CONNECTING", cc.color(159, 176, 255), Number.POSITIVE_INFINITY);

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
        if (typeof window !== "undefined" && this.resizeHandler) {
            window.removeEventListener("resize", this.resizeHandler);
        }
    }

    protected update(): void {
        if (!this.platformReady || !this.clock.isStarted() || this.clock.isPaused()) {
            return;
        }
        const songTimeMs = this.clock.currentTimeMs();
        const timeoutActions = this.engine.update(songTimeMs);
        timeoutActions.forEach((action) => this.presentAction(action, songTimeMs));
        this.updateTimeline(songTimeMs);
        this.refreshStats();
        this.renderSequenceIfNeeded();

        if (!this.engine.getSnapshot().finished && songTimeMs > this.messageExpiresAtMs) {
            this.judgementLabel.string = "";
        }
    }

    private buildUi(): void {
        this.node.removeAllChildren();
        this.root = new cc.Node("RhythmUI");
        this.root.parent = this.node;

        const backgroundNode = new cc.Node("Background");
        backgroundNode.parent = this.root;
        this.background = backgroundNode.addComponent(cc.Graphics);

        const panelNode = new cc.Node("SequencePanel");
        panelNode.parent = this.root;
        this.sequencePanel = panelNode.addComponent(cc.Graphics);

        this.titleLabel = this.makeLabel(this.root, "Title", DEMO_BEATMAP.title, 26, cc.color(220, 228, 255));
        this.hostLabel = this.makeLabel(this.root, "Host", "INITIALIZING", 12, cc.color(104, 226, 255));
        this.scoreLabel = this.makeLabel(this.root, "Score", "SCORE 000000", 24, cc.color(241, 245, 255));
        this.comboLabel = this.makeLabel(this.root, "Combo", "COMBO 0", 18, cc.color(104, 226, 255));
        this.phraseLabel = this.makeLabel(this.root, "Phrase", "PHRASE 1 / 8", 16, cc.color(157, 169, 205));
        this.countdownLabel = this.makeLabel(this.root, "Countdown", "NEXT BEAT", 15, cc.color(157, 169, 205));
        this.judgementLabel = this.makeLabel(this.root, "Judgement", "", 44, cc.color(255, 255, 255));
        this.instructionLabel = this.makeLabel(
            this.root,
            "Instruction",
            "ARROWS / WASD TO ENTER · SPACE / ENTER ON BEAT",
            15,
            cc.color(145, 157, 194)
        );

        this.sequenceRow = new cc.Node("SequenceRow");
        this.sequenceRow.parent = this.root;

        const timelineNode = new cc.Node("Timeline");
        timelineNode.parent = this.root;
        this.timeline = timelineNode.addComponent(cc.Graphics);

        this.pulseNode = new cc.Node("BeatPulse");
        this.pulseNode.parent = this.root;
        const pulseGraphics = this.pulseNode.addComponent(cc.Graphics);
        pulseGraphics.fillColor = cc.color(104, 226, 255, 50);
        pulseGraphics.circle(0, 0, 25);
        pulseGraphics.fill();
        pulseGraphics.strokeColor = cc.color(104, 226, 255, 180);
        pulseGraphics.lineWidth = 3;
        pulseGraphics.circle(0, 0, 25);
        pulseGraphics.stroke();

        this.directionPad = new cc.Node("DirectionPad");
        this.directionPad.parent = this.root;
        const directions: Direction[] = ["left", "down", "up", "right"];
        directions.forEach((direction, index) => {
            const button = this.makeTapButton(
                this.directionPad,
                "Touch-" + direction,
                ARROW_TEXT[direction],
                84,
                84,
                cc.color(44, 54, 94),
                cc.color(104, 226, 255),
                () => this.input && this.input.routeDirection(direction)
            );
            button.x = (index - 1.5) * 96;
        });

        this.beatButton = this.makeTapButton(
            this.root,
            "BeatButton",
            "BEAT",
            156,
            92,
            cc.color(116, 62, 205),
            cc.color(255, 105, 213),
            () => this.input && this.input.routeBeat()
        );
        this.restartButton = this.makeTapButton(
            this.root,
            "RestartButton",
            "RESTART",
            132,
            44,
            cc.color(34, 42, 74),
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
        this.panelWidth = Math.min(980, this.viewportWidth - 96 - this.metrics.safe.left - this.metrics.safe.right);

        const halfWidth = this.viewportWidth * 0.5;
        const halfHeight = this.viewportHeight * 0.5;
        const safeTop = this.metrics.safe.top;
        const safeBottom = this.metrics.safe.bottom;

        this.drawBackground();
        this.drawSequencePanel();

        this.titleLabel.node.setPosition(0, halfHeight - safeTop - 35);
        this.hostLabel.string = this.metrics.hosted ? "BUILDA RUNTIME" : "BROWSER FALLBACK";
        this.hostLabel.node.setPosition(0, halfHeight - safeTop - 60);
        this.scoreLabel.node.setPosition(-halfWidth + this.metrics.safe.left + 112, halfHeight - safeTop - 38);
        this.comboLabel.node.setPosition(-halfWidth + this.metrics.safe.left + 95, halfHeight - safeTop - 69);

        this.sequencePanel.node.setPosition(0, 82);
        this.phraseLabel.node.setPosition(0, 175);
        this.sequenceRow.setPosition(0, 102);
        this.timeline.node.setPosition(0, 27);
        this.countdownLabel.node.setPosition(0, -2);
        this.pulseNode.setPosition(this.panelWidth * 0.5 - 58, 28);
        this.judgementLabel.node.setPosition(0, -71);
        this.instructionLabel.node.setPosition(0, -137);

        const controlsY = -halfHeight + safeBottom + 73;
        this.directionPad.setPosition(-halfWidth + this.metrics.safe.left + 230, controlsY);
        this.beatButton.setPosition(halfWidth - this.metrics.safe.right - 126, controlsY);

        const capsuleBlock = this.metrics.capsule.width > 0
            ? this.metrics.capsule.right + this.metrics.capsule.width + 18
            : this.metrics.safe.right + 18;
        this.restartButton.setPosition(
            halfWidth - capsuleBlock - 66,
            halfHeight - Math.max(safeTop, this.metrics.capsule.top) - 34
        );

        this.sequenceRenderKey = "";
        this.renderSequenceIfNeeded();
        this.updateTimeline(this.clock.isStarted() ? this.clock.currentTimeMs() : 0);
    }

    private restartGame(): void {
        if (!this.platformReady) {
            return;
        }
        this.engine.restart();
        this.clock.restart();
        this.pausedByHost = false;
        this.sequenceRenderKey = "";
        this.setJudgement("GET READY", cc.color(159, 176, 255), 850);
        this.instructionLabel.string = "ARROWS / WASD TO ENTER · SPACE / ENTER ON BEAT";
        this.refreshStats();
        this.renderSequenceIfNeeded();
        this.updateTimeline(0);
    }

    private onDirection(direction: Direction): void {
        if (!this.platformReady || this.clock.isPaused()) {
            return;
        }
        const songTimeMs = this.clock.currentTimeMs();
        this.presentAction(this.engine.inputDirection(direction, songTimeMs), songTimeMs);
        this.renderSequenceIfNeeded();
        this.refreshStats();
    }

    private onBeat(): void {
        if (!this.platformReady || this.clock.isPaused()) {
            return;
        }
        const songTimeMs = this.clock.currentTimeMs();
        this.presentAction(this.engine.confirm(songTimeMs), songTimeMs);
        this.renderSequenceIfNeeded();
        this.refreshStats();
    }

    private presentAction(action: EngineAction, songTimeMs: number): void {
        if (action.kind === "wrong") {
            this.setJudgement("WRONG · RESET", cc.color(255, 112, 146), songTimeMs + 520);
        } else if (action.kind === "ready") {
            this.setJudgement("SEQUENCE READY", cc.color(104, 226, 255), songTimeMs + 520);
        } else if (action.kind === "tooEarly") {
            this.setJudgement("WAIT FOR BEAT", cc.color(255, 210, 112), songTimeMs + 360);
        } else if (action.judgement) {
            const suffix = action.kind === "finished" ? " · CLEAR" : "";
            this.setJudgement(
                action.judgement.grade.toUpperCase() + suffix,
                this.judgementColor(action.judgement.grade),
                action.kind === "finished" ? Number.POSITIVE_INFINITY : songTimeMs + 720
            );
        }

        if (this.engine.getSnapshot().finished) {
            this.instructionLabel.string = "SONG CLEAR · TAP RESTART OR PRESS R";
        }
    }

    private refreshStats(): void {
        const snapshot = this.engine.getSnapshot();
        this.scoreLabel.string = "SCORE " + this.padScore(snapshot.score);
        this.comboLabel.string = "COMBO " + snapshot.combo + "   MAX " + snapshot.maxCombo;
        const shownIndex = Math.min(snapshot.sequenceIndex + 1, snapshot.sequenceCount);
        this.phraseLabel.string = "PHRASE " + shownIndex + " / " + snapshot.sequenceCount;
    }

    private renderSequenceIfNeeded(): void {
        const sequence = this.engine.getCurrentSequence();
        const snapshot = this.engine.getSnapshot();
        const key = snapshot.sequenceIndex + ":" + snapshot.enteredCount + ":" + snapshot.finished;
        if (key === this.sequenceRenderKey) {
            return;
        }
        this.sequenceRenderKey = key;
        this.sequenceRow.removeAllChildren();

        if (!sequence) {
            const clear = this.makeLabel(this.sequenceRow, "Clear", "ALL PHRASES COMPLETE", 24, cc.color(104, 226, 255));
            clear.node.setContentSize(this.panelWidth - 80, 60);
            return;
        }

        const count = sequence.directions.length;
        const chipWidth = Math.min(108, (this.panelWidth - 120) / count - 12);
        const stride = chipWidth + 12;
        sequence.directions.forEach((direction, index) => {
            const chip = new cc.Node("Step-" + (index + 1));
            chip.parent = this.sequenceRow;
            chip.setContentSize(chipWidth, 76);
            chip.x = (index - (count - 1) * 0.5) * stride;
            const graphics = chip.addComponent(cc.Graphics);
            const completed = index < snapshot.enteredCount;
            const current = index === snapshot.enteredCount;
            graphics.fillColor = completed
                ? cc.color(28, 139, 146, 230)
                : current
                    ? cc.color(98, 65, 179, 240)
                    : cc.color(31, 38, 70, 230);
            graphics.roundRect(-chipWidth * 0.5, -38, chipWidth, 76, 14);
            graphics.fill();
            graphics.strokeColor = completed
                ? cc.color(104, 226, 255)
                : current
                    ? cc.color(255, 105, 213)
                    : cc.color(72, 83, 126);
            graphics.lineWidth = current ? 4 : 2;
            graphics.roundRect(-chipWidth * 0.5, -38, chipWidth, 76, 14);
            graphics.stroke();
            const arrow = this.makeLabel(chip, "Arrow", ARROW_TEXT[direction], 42, cc.color(245, 248, 255));
            arrow.node.setContentSize(chipWidth, 64);
        });
    }

    private updateTimeline(songTimeMs: number): void {
        const sequence = this.engine.getCurrentSequence();
        const width = this.panelWidth - 160;
        const x = -width * 0.5;
        this.timeline.clear();
        this.timeline.lineCap = cc.Graphics.LineCap.ROUND;
        this.timeline.strokeColor = cc.color(55, 65, 105);
        this.timeline.lineWidth = 8;
        this.timeline.moveTo(x, 0);
        this.timeline.lineTo(x + width, 0);
        this.timeline.stroke();

        if (!sequence) {
            this.timeline.strokeColor = cc.color(104, 226, 255);
            this.timeline.moveTo(x, 0);
            this.timeline.lineTo(x + width, 0);
            this.timeline.stroke();
            this.countdownLabel.string = "COMPLETE";
            this.pulseNode.scale = 1;
            return;
        }

        const leadWindowMs = 1800;
        const progress = Math.max(0, Math.min(1, (songTimeMs - (sequence.targetTimeMs - leadWindowMs)) / leadWindowMs));
        this.timeline.strokeColor = cc.color(255, 105, 213);
        this.timeline.lineWidth = 8;
        this.timeline.moveTo(x, 0);
        this.timeline.lineTo(x + width * progress, 0);
        this.timeline.stroke();

        const remaining = sequence.targetTimeMs - songTimeMs;
        this.countdownLabel.string = remaining >= 0
            ? "BEAT IN " + (remaining / 1000).toFixed(2) + "s"
            : "LATE +" + (Math.abs(remaining) / 1000).toFixed(2) + "s";

        const beatDuration = 60000 / DEMO_BEATMAP.bpm;
        const phase = ((songTimeMs % beatDuration) + beatDuration) % beatDuration / beatDuration;
        const pulse = 1 + Math.pow(1 - phase, 2) * 0.34;
        this.pulseNode.scale = pulse;
        this.pulseNode.opacity = Math.round(110 + (1 - phase) * 145);
    }

    private drawBackground(): void {
        const width = this.viewportWidth;
        const height = this.viewportHeight;
        this.background.clear();
        this.background.fillColor = cc.color(8, 12, 31);
        this.background.rect(-width * 0.5, -height * 0.5, width, height);
        this.background.fill();

        this.background.fillColor = cc.color(46, 27, 91, 90);
        this.background.circle(width * 0.34, height * 0.22, 240);
        this.background.fill();
        this.background.fillColor = cc.color(11, 111, 123, 55);
        this.background.circle(-width * 0.38, -height * 0.3, 280);
        this.background.fill();

        this.background.strokeColor = cc.color(255, 105, 213, 28);
        this.background.lineWidth = 2;
        for (let y = -height * 0.5; y <= height * 0.5; y += 54) {
            this.background.moveTo(-width * 0.5, y);
            this.background.lineTo(width * 0.5, y + 40);
        }
        this.background.stroke();
    }

    private drawSequencePanel(): void {
        this.sequencePanel.clear();
        this.sequencePanel.fillColor = cc.color(18, 24, 52, 238);
        this.sequencePanel.roundRect(-this.panelWidth * 0.5, -102, this.panelWidth, 204, 24);
        this.sequencePanel.fill();
        this.sequencePanel.strokeColor = cc.color(103, 82, 171, 170);
        this.sequencePanel.lineWidth = 2;
        this.sequencePanel.roundRect(-this.panelWidth * 0.5, -102, this.panelWidth, 204, 24);
        this.sequencePanel.stroke();
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
        label.lineHeight = Math.round(fontSize * 1.2);
        label.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
        label.verticalAlign = cc.Label.VerticalAlign.CENTER;
        label.overflow = cc.Label.Overflow.SHRINK;
        // Adding cc.Label resets a fresh node's size; apply the intended box
        // afterwards so SHRINK labels do not collapse to an unreadable width.
        node.setContentSize(700, Math.max(44, fontSize + 12));
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
        const label = this.makeLabel(node, name + "Label", text, text.length > 2 ? 20 : 38, cc.color(245, 248, 255));
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

    private setJudgement(text: string, color: cc.Color, expiresAtMs: number): void {
        this.judgementLabel.string = text;
        this.judgementLabel.node.color = color;
        this.messageExpiresAtMs = expiresAtMs;
    }

    private judgementColor(grade: string): cc.Color {
        switch (grade) {
            case "Perfect":
                return cc.color(104, 226, 255);
            case "Great":
                return cc.color(255, 105, 213);
            case "Good":
                return cc.color(255, 210, 112);
            default:
                return cc.color(255, 112, 146);
        }
    }

    private padScore(score: number): string {
        const value = String(Math.max(0, Math.floor(score)));
        return ("000000" + value).slice(-6);
    }

    private onGameHide(): void {
        if (this.clock.isStarted() && !this.clock.isPaused()) {
            this.clock.pause();
            this.pausedByHost = true;
            this.instructionLabel.string = "PAUSED BY HOST";
        }
    }

    private onGameShow(): void {
        if (this.pausedByHost) {
            this.clock.resume();
            this.pausedByHost = false;
            this.instructionLabel.string = this.engine.getSnapshot().finished
                ? "SONG CLEAR · TAP RESTART OR PRESS R"
                : "ARROWS / WASD TO ENTER · SPACE / ENTER ON BEAT";
        }
        this.layout();
    }

    private onWindowResize(): void {
        this.scheduleOnce(() => this.layout(), 0);
    }
}
