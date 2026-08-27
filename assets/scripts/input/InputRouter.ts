import { Direction } from "../domain/Beatmap";

export type DirectionHandler = (direction: Direction) => void;
export type ActionHandler = () => void;

/** Normalizes keyboard and programmatic touch-button input into game actions. */
export class InputRouter {
    private readonly onDirection: DirectionHandler;
    private readonly onBeat: ActionHandler;
    private readonly onRestart: ActionHandler;
    private readonly pressed: { [keyCode: number]: boolean } = {};
    private attached: boolean = false;

    public constructor(onDirection: DirectionHandler, onBeat: ActionHandler, onRestart: ActionHandler) {
        this.onDirection = onDirection;
        this.onBeat = onBeat;
        this.onRestart = onRestart;
    }

    public attach(): void {
        if (this.attached) {
            return;
        }
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.handleKeyDown, this);
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_UP, this.handleKeyUp, this);
        this.attached = true;
    }

    public detach(): void {
        if (!this.attached) {
            return;
        }
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.handleKeyDown, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.handleKeyUp, this);
        this.attached = false;
        Object.keys(this.pressed).forEach((key) => delete this.pressed[Number(key)]);
    }

    public routeDirection(direction: Direction): void {
        this.onDirection(direction);
    }

    public routeBeat(): void {
        this.onBeat();
    }

    public routeRestart(): void {
        this.onRestart();
    }

    private handleKeyDown(event: cc.Event.EventKeyboard): void {
        const keyCode = event.keyCode;
        if (this.pressed[keyCode]) {
            return;
        }
        this.pressed[keyCode] = true;
        switch (keyCode) {
            case cc.macro.KEY.left:
            case cc.macro.KEY.a:
                this.routeDirection("left");
                break;
            case cc.macro.KEY.down:
            case cc.macro.KEY.s:
                this.routeDirection("down");
                break;
            case cc.macro.KEY.up:
            case cc.macro.KEY.w:
                this.routeDirection("up");
                break;
            case cc.macro.KEY.right:
            case cc.macro.KEY.d:
                this.routeDirection("right");
                break;
            case cc.macro.KEY.space:
            case cc.macro.KEY.enter:
                this.routeBeat();
                break;
            case cc.macro.KEY.r:
                this.routeRestart();
                break;
            default:
                break;
        }
    }

    private handleKeyUp(event: cc.Event.EventKeyboard): void {
        delete this.pressed[event.keyCode];
    }
}
