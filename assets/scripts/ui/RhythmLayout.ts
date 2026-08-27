export interface RhythmVerticalLayoutInput {
    viewportHeight: number;
    safeTop: number;
    safeBottom: number;
    directionPadScale: number;
}

export interface RhythmVerticalLayout {
    compact: boolean;
    controlsY: number;
    buttonBottom: number;
    buttonTop: number;
    globalLineY: number;
    progressLabelY: number;
    instructionLabelY: number;
    showInstruction: boolean;
    globalBlockTop: number;
    globalBlockBottom: number;
    panelY: number;
    panelHeight: number;
    panelTop: number;
    panelBottom: number;
    showStage: boolean;
    stageBaseY: number;
    dancerScale: number;
}

export interface NoteChipVerticalLayout {
    arrowFontSize: number;
    arrowBoxHeight: number;
    arrowY: number;
    statusFontSize: number;
    statusBoxHeight: number;
    statusY: number;
    miniBarY: number;
    miniBarHalfHeight: number;
}

function finiteOr(value: number, fallback: number): number {
    return isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Allocates the lower screen from the safe-area edge upwards in one stack:
 * direction buttons -> global judge block -> current-group panel. Secondary
 * instruction text is removed before the note panel becomes too short.
 */
export function calculateRhythmVerticalLayout(input: RhythmVerticalLayoutInput): RhythmVerticalLayout {
    const viewportHeight = Math.max(320, finiteOr(input.viewportHeight, 720));
    const safeTop = Math.max(0, finiteOr(input.safeTop, 0));
    const safeBottom = Math.max(0, finiteOr(input.safeBottom, 0));
    const directionPadScale = clamp(finiteOr(input.directionPadScale, 1), 0.82, 1);
    const compact = viewportHeight < 640;
    const halfHeight = viewportHeight * 0.5;

    const buttonHeight = 84 * directionPadScale;
    const buttonBottom = -halfHeight + safeBottom + 14;
    const buttonTop = buttonBottom + buttonHeight;
    const controlsY = buttonBottom + buttonHeight * 0.5;

    const preferredPanelHeight = compact ? 142 : 174;
    const preferredPanelY = compact ? -30 : -64;
    const preferredPanelBottom = preferredPanelY - preferredPanelHeight * 0.5;
    const minimumPanelHeight = 118;

    const topY = halfHeight - safeTop - 25;
    const judgementBottom = topY - (compact ? 67 : 76) - 19;
    const maximumPanelTopWithStage = Math.min(
        compact ? 60 : 104,
        judgementBottom - (compact ? 42 : 55)
    );
    const maximumPanelTopWithoutStage = judgementBottom - 12;

    let showInstruction = true;
    let globalLineY = buttonTop + 36;
    let progressLabelY = globalLineY + 22;
    let instructionLabelY = globalLineY - 17;
    let globalBlockTop = progressLabelY + 12;
    let globalBlockBottom = instructionLabelY - 11;
    let panelBottom = Math.max(preferredPanelBottom, globalBlockTop + 12);

    if (maximumPanelTopWithStage - panelBottom < minimumPanelHeight) {
        showInstruction = false;
        globalLineY = buttonTop + 18;
        progressLabelY = globalLineY + 22;
        instructionLabelY = globalLineY - 17;
        globalBlockTop = progressLabelY + 12;
        globalBlockBottom = globalLineY - 10;
        panelBottom = Math.max(preferredPanelBottom, globalBlockTop + 12);
    }

    let availablePanelHeight = maximumPanelTopWithStage - panelBottom;
    let panelHeight = Math.min(preferredPanelHeight, Math.max(minimumPanelHeight, availablePanelHeight));
    let panelTop = panelBottom + panelHeight;
    let panelY = panelBottom + panelHeight * 0.5;
    const dancerScale = compact ? 0.78 : 1;
    const stagePanelClearance = compact ? 30 : 36;
    let desiredStageBaseY = panelTop + (compact ? 49 : 70);
    let stageBaseY = Math.min(
        desiredStageBaseY,
        judgementBottom - (compact ? 42 : 58)
    );
    let showStage = availablePanelHeight >= minimumPanelHeight
        && stageBaseY >= panelTop + stagePanelClearance;

    if (!showStage) {
        availablePanelHeight = maximumPanelTopWithoutStage - panelBottom;
        panelHeight = Math.min(preferredPanelHeight, Math.max(minimumPanelHeight, availablePanelHeight));
        panelTop = panelBottom + panelHeight;
        panelY = panelBottom + panelHeight * 0.5;
        desiredStageBaseY = panelTop + (compact ? 49 : 70);
        stageBaseY = desiredStageBaseY;
    }

    return {
        compact,
        controlsY,
        buttonBottom,
        buttonTop,
        globalLineY,
        progressLabelY,
        instructionLabelY,
        showInstruction,
        globalBlockTop,
        globalBlockBottom,
        panelY,
        panelHeight,
        panelTop,
        panelBottom,
        showStage,
        stageBaseY,
        dancerScale
    };
}

/**
 * Keeps the arrow, persistent judgement text and mini timing bar separated when
 * the group panel reaches its supported minimum height.
 */
export function calculateNoteChipVerticalLayout(chipHeightInput: number): NoteChipVerticalLayout {
    const chipHeight = Math.max(64, finiteOr(chipHeightInput, 127));
    const compressed = chipHeight < 92;
    return compressed
        ? {
            arrowFontSize: 28,
            arrowBoxHeight: 30,
            arrowY: 17,
            statusFontSize: 11,
            statusBoxHeight: 14,
            statusY: -6,
            miniBarY: -chipHeight * 0.5 + 11,
            miniBarHalfHeight: 7
        }
        : {
            arrowFontSize: 36,
            arrowBoxHeight: 42,
            arrowY: 22,
            statusFontSize: 13,
            statusBoxHeight: 20,
            statusY: -10,
            miniBarY: -chipHeight * 0.5 + 18,
            miniBarHalfHeight: 7
        };
}
