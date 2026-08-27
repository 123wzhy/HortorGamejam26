/** Tracks held keys without depending on Cocos, so focus-loss recovery is testable. */
export class PressedKeyState {
    private readonly pressed: { [keyCode: number]: boolean } = {};

    public press(keyCode: number): boolean {
        if (this.pressed[keyCode]) {
            return false;
        }
        this.pressed[keyCode] = true;
        return true;
    }

    public release(keyCode: number): void {
        delete this.pressed[keyCode];
    }

    public reset(): void {
        Object.keys(this.pressed).forEach((key) => delete this.pressed[Number(key)]);
    }
}
