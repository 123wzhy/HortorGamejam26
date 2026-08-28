export interface UiStartupState {
    platformReady: boolean;
    artLoadComplete: boolean;
    missingArtCount: number;
}

export function initialUiStartupState(): UiStartupState {
    return {
        platformReady: false,
        artLoadComplete: false,
        missingArtCount: 0
    };
}

export function markPlatformReady(state: UiStartupState): UiStartupState {
    return {
        platformReady: true,
        artLoadComplete: state.artLoadComplete,
        missingArtCount: state.missingArtCount
    };
}

export function markArtLoaded(state: UiStartupState, missingArtCount: number): UiStartupState {
    return {
        platformReady: state.platformReady,
        artLoadComplete: true,
        missingArtCount: Math.max(0, Math.floor(isFinite(missingArtCount) ? missingArtCount : 0))
    };
}

export function canEnterGameplay(state: UiStartupState): boolean {
    return state.platformReady;
}

/** Single source of truth so async completion cannot erase layout degradation notices. */
export function startupStatusText(state: UiStartupState, informationCardsHidden: boolean = false): string {
    let status: string;
    if (!state.platformReady) {
        if (!state.artLoadComplete) {
            status = "降级菜单可用 · 正在连接创游世界与加载美术…";
        } else {
            status = state.missingArtCount > 0
                ? "降级菜单可用 · 部分美术缺失 · 正在连接创游世界…"
                : "美术已就绪 · 正在连接创游世界…";
        }
    } else if (!state.artLoadComplete) {
        status = "准备就绪 · 美术加载中 · 可点击开始";
    } else {
        status = state.missingArtCount > 0
            ? "准备就绪 · 部分美术缺失，已启用降级界面"
            : "准备就绪 · 点击开始跳舞";
    }
    return informationCardsHidden
        ? status + " · 安全区受限，已隐藏信息卡"
        : status;
}
