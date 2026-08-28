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
    progressLabelHeight: number;
    instructionLabelY: number;
    instructionLabelHeight: number;
    timelineHalfHeight: number;
    textTimelineGap: number;
    timingPanelPadding: number;
    showTimelineBar: boolean;
    showProgressLabel: boolean;
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
    safeTopApplied: number;
    safeBottomApplied: number;
    safeInsetsClamped: boolean;
    hudBottom: number;
}

export interface MenuHintHorizontalLayoutInput {
    availableWidth: number;
}

export interface MenuHintHorizontalLayout {
    scale: number;
    arrowWidth: number;
    arrowHeight: number;
    arrowCenters: number[];
    arrowsLeft: number;
    arrowsRight: number;
    textX: number;
    textLeft: number;
    textRight: number;
    textWidth: number;
    groupGap: number;
    panelWidth: number;
    panelHeight: number;
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

export interface MenuFooterVerticalLayoutInput {
    viewportHeight: number;
    safeBottom: number;
    startButtonHeight: number;
    startButtonScale: number;
}

export interface MenuFooterVerticalLayout {
    hintY: number;
    startY: number;
    startButtonBottom: number;
    startButtonTop: number;
    statusY: number;
    statusLabelHeight: number;
    statusBottom: number;
    statusTop: number;
    cardBottom: number;
    buttonStatusGap: number;
    statusCardGap: number;
}

export interface MenuCardVerticalLayoutInput {
    logoBottom: number;
    cardBottom: number;
    preferredCardHeight: number;
    maximumCardHeight: number;
}

export interface MenuCardVerticalLayout {
    visible: boolean;
    cardHeight: number;
    cardTop: number | null;
    maximumCardTop: number;
    availableCardHeight: number;
    minimumReadableHeight: number;
    logoCardGap: number;
}

function finiteOr(value: number, fallback: number): number {
    return isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Lays out the four direction icons and the keyboard hint as two explicit
 * horizontal groups. Scaling is uniform, so icon artwork keeps its aspect
 * ratio while the text can never intrude into the icon bounds.
 */
export function calculateMenuHintHorizontalLayout(
    input: MenuHintHorizontalLayoutInput
): MenuHintHorizontalLayout {
    const availableWidth = Math.max(240, finiteOr(input.availableWidth, 960));
    const arrowCount = 4;
    const naturalArrowWidth = 54;
    const naturalArrowHeight = 54 / (73 / 71);
    const naturalArrowGap = 4;
    const naturalTextWidth = 236;
    const naturalGroupGap = 18;
    const naturalPanelPadding = 16;
    const naturalArrowGroupWidth = arrowCount * naturalArrowWidth
        + (arrowCount - 1) * naturalArrowGap;
    const naturalContentWidth = naturalArrowGroupWidth + naturalGroupGap + naturalTextWidth;
    const scale = Math.min(1, Math.max(
        0.48,
        (availableWidth - naturalPanelPadding * 2) / naturalContentWidth
    ));
    const arrowWidth = naturalArrowWidth * scale;
    const arrowHeight = naturalArrowHeight * scale;
    const arrowGap = naturalArrowGap * scale;
    const textWidth = naturalTextWidth * scale;
    const groupGap = naturalGroupGap * scale;
    const arrowGroupWidth = arrowCount * arrowWidth + (arrowCount - 1) * arrowGap;
    const contentWidth = arrowGroupWidth + groupGap + textWidth;
    const arrowsLeft = -contentWidth * 0.5;
    const arrowCenters: number[] = [];
    for (let index = 0; index < arrowCount; index += 1) {
        arrowCenters.push(arrowsLeft + arrowWidth * 0.5 + index * (arrowWidth + arrowGap));
    }
    const arrowsRight = arrowsLeft + arrowGroupWidth;
    const textLeft = arrowsRight + groupGap;
    const textRight = textLeft + textWidth;
    const panelPadding = naturalPanelPadding * scale;

    return {
        scale,
        arrowWidth,
        arrowHeight,
        arrowCenters,
        arrowsLeft,
        arrowsRight,
        textX: textLeft + textWidth * 0.5,
        textLeft,
        textRight,
        textWidth,
        groupGap,
        panelWidth: contentWidth + panelPadding * 2,
        panelHeight: arrowHeight + 12 * scale
    };
}

/** Portrait is unsupported by the landscape-only manifest, so it gets a guard. */
export function shouldShowLandscapeRotation(frameWidth: number, frameHeight: number): boolean {
    const width = Math.max(1, finiteOr(frameWidth, 1));
    const height = Math.max(1, finiteOr(frameHeight, 1));
    return height > width;
}

/**
 * Anchors the menu footer from the lower safe-area edge and allocates each
 * vertical layer by its real bounds. This keeps scaled button artwork, status
 * text and the two card panels separated at both supported viewport heights.
 */
export function calculateMenuFooterVerticalLayout(
    input: MenuFooterVerticalLayoutInput
): MenuFooterVerticalLayout {
    const viewportHeight = Math.max(1, finiteOr(input.viewportHeight, 720));
    const safeBottom = Math.max(0, finiteOr(input.safeBottom, 0));
    const startButtonScale = Math.max(0, finiteOr(input.startButtonScale, 1));
    const startButtonHeight = Math.max(0, finiteOr(input.startButtonHeight, 145)) * startButtonScale;
    const statusLabelHeight = 32;
    const buttonStatusGap = 10;
    const statusCardGap = 12;
    const hintY = -viewportHeight * 0.5 + safeBottom + 40;
    const startButtonBottom = hintY + 50;
    const startY = startButtonBottom + startButtonHeight * 0.5;
    const startButtonTop = startButtonBottom + startButtonHeight;
    const statusBottom = startButtonTop + buttonStatusGap;
    const statusY = statusBottom + statusLabelHeight * 0.5;
    const statusTop = statusBottom + statusLabelHeight;
    const cardBottom = statusTop + statusCardGap;

    return {
        hintY,
        startY,
        startButtonBottom,
        startButtonTop,
        statusY,
        statusLabelHeight,
        statusBottom,
        statusTop,
        cardBottom,
        buttonStatusGap,
        statusCardGap
    };
}

/**
 * Fits the optional task/song cards between the footer and the logo. Cards are
 * hidden as a pair when the remaining height cannot preserve readable content;
 * a visible card can never cross the explicit logo clearance boundary.
 */
export function calculateMenuCardVerticalLayout(
    input: MenuCardVerticalLayoutInput
): MenuCardVerticalLayout {
    const logoBottom = finiteOr(input.logoBottom, 0);
    const cardBottom = finiteOr(input.cardBottom, 0);
    const preferredCardHeight = Math.max(0, finiteOr(input.preferredCardHeight, 0));
    const maximumCardHeight = Math.max(0, finiteOr(input.maximumCardHeight, 0));
    const minimumReadableHeight = 96;
    const logoCardGap = 8;
    const maximumCardTop = logoBottom - logoCardGap;
    const availableCardHeight = Math.max(0, maximumCardTop - cardBottom);
    const desiredCardHeight = Math.min(preferredCardHeight, maximumCardHeight);
    const visible = availableCardHeight >= minimumReadableHeight
        && desiredCardHeight >= minimumReadableHeight;
    const cardHeight = visible ? Math.min(desiredCardHeight, availableCardHeight) : 0;

    return {
        visible,
        cardHeight,
        cardTop: visible ? cardBottom + cardHeight : null,
        maximumCardTop,
        availableCardHeight,
        minimumReadableHeight,
        logoCardGap
    };
}

/**
 * Allocates the lower screen from the safe-area edge upwards in one stack:
 * direction buttons -> global judge block -> current-group panel. It removes
 * instruction, stage and finally progress text before clamping impossible
 * insets; the timing bar and core interaction layers always remain allocated.
 */
export function calculateRhythmVerticalLayout(input: RhythmVerticalLayoutInput): RhythmVerticalLayout {
    const viewportHeight = Math.max(320, finiteOr(input.viewportHeight, 720));
    const requestedSafeTop = Math.max(0, finiteOr(input.safeTop, 0));
    const requestedSafeBottom = Math.max(0, finiteOr(input.safeBottom, 0));
    const directionPadScale = clamp(finiteOr(input.directionPadScale, 1), 0.82, 1);
    const compact = viewportHeight < 640;
    const halfHeight = viewportHeight * 0.5;
    const minimumPanelHeight = 118;
    const controlBottomMargin = 14;
    const timelineHalfHeight = 10;
    const progressLabelHeight = 28;
    const instructionLabelHeight = 22;
    const textTimelineGap = 4;
    const timingPanelPadding = 6;
    const buttonTimingGap = 8;
    const layerGap = 12;
    const judgementCenterOffset = compact ? 67 : 76;
    const judgementHalfHeight = 19;

    const buttonHeight = 84 * directionPadScale;
    const hudPanelOffset = 25 + judgementCenterOffset + judgementHalfHeight + layerGap;
    const minimumTimingBlockHeightAboveButtons = buttonTimingGap
        + timingPanelPadding * 2 + timelineHalfHeight * 2;
    const coreStackWithoutInsets = controlBottomMargin + buttonHeight
        + minimumTimingBlockHeightAboveButtons + layerGap + minimumPanelHeight;
    const totalInsetBudget = Math.max(0, viewportHeight - hudPanelOffset - coreStackWithoutInsets);
    const safeTopApplied = Math.min(requestedSafeTop, totalInsetBudget);
    const safeBottomBudget = Math.max(0, totalInsetBudget - safeTopApplied);
    const safeBottomApplied = Math.min(requestedSafeBottom, safeBottomBudget);
    const safeInsetsClamped = requestedSafeTop - safeTopApplied > 0.001
        || requestedSafeBottom - safeBottomApplied > 0.001;

    const buttonBottom = -halfHeight + safeBottomApplied + controlBottomMargin;
    const buttonTop = buttonBottom + buttonHeight;
    const controlsY = buttonBottom + buttonHeight * 0.5;

    const preferredPanelHeight = compact ? 142 : 174;
    const preferredPanelY = compact ? -30 : -64;
    const preferredPanelBottom = preferredPanelY - preferredPanelHeight * 0.5;

    const topY = halfHeight - safeTopApplied - 25;
    const judgementBottom = topY - judgementCenterOffset - judgementHalfHeight;
    const maximumPanelTopWithStage = Math.min(
        compact ? 60 : 104,
        judgementBottom - (compact ? 42 : 55)
    );
    const maximumPanelTopWithoutStage = judgementBottom - layerGap;

    let showProgressLabel = true;
    let showInstruction = true;
    let globalLineY = 0;
    let progressLabelY = 0;
    let instructionLabelY = 0;
    let globalBlockTop = 0;
    let globalBlockBottom = 0;

    const updateTimingBlock = (): void => {
        globalLineY = showInstruction
            ? buttonTop + buttonTimingGap + timingPanelPadding + instructionLabelHeight
                + textTimelineGap + timelineHalfHeight
            : buttonTop + buttonTimingGap + timingPanelPadding + timelineHalfHeight;
        progressLabelY = globalLineY + timelineHalfHeight + textTimelineGap
            + progressLabelHeight * 0.5;
        instructionLabelY = globalLineY - timelineHalfHeight - textTimelineGap
            - instructionLabelHeight * 0.5;
        globalBlockTop = showProgressLabel
            ? progressLabelY + progressLabelHeight * 0.5 + timingPanelPadding
            : globalLineY + timelineHalfHeight + timingPanelPadding;
        globalBlockBottom = showInstruction
            ? instructionLabelY - instructionLabelHeight * 0.5 - timingPanelPadding
            : globalLineY - timelineHalfHeight - timingPanelPadding;
    };

    updateTimingBlock();
    let panelBottom = Math.max(preferredPanelBottom, globalBlockTop + layerGap);

    if (maximumPanelTopWithStage - panelBottom < minimumPanelHeight) {
        showInstruction = false;
        updateTimingBlock();
        panelBottom = Math.max(preferredPanelBottom, globalBlockTop + layerGap);
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

    if (!showStage && showInstruction) {
        showInstruction = false;
        updateTimingBlock();
        panelBottom = Math.max(preferredPanelBottom, globalBlockTop + layerGap);
        availablePanelHeight = maximumPanelTopWithStage - panelBottom;
        panelHeight = Math.min(preferredPanelHeight, Math.max(minimumPanelHeight, availablePanelHeight));
        panelTop = panelBottom + panelHeight;
        panelY = panelBottom + panelHeight * 0.5;
        desiredStageBaseY = panelTop + (compact ? 49 : 70);
        stageBaseY = Math.min(
            desiredStageBaseY,
            judgementBottom - (compact ? 42 : 58)
        );
        showStage = availablePanelHeight >= minimumPanelHeight
            && stageBaseY >= panelTop + stagePanelClearance;
    }

    if (!showStage) {
        availablePanelHeight = maximumPanelTopWithoutStage - panelBottom;
        if (availablePanelHeight < minimumPanelHeight) {
            showProgressLabel = false;
            updateTimingBlock();
            panelBottom = Math.max(preferredPanelBottom, globalBlockTop + layerGap);
            availablePanelHeight = maximumPanelTopWithoutStage - panelBottom;
        }
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
        progressLabelHeight,
        instructionLabelY,
        instructionLabelHeight,
        timelineHalfHeight,
        textTimelineGap,
        timingPanelPadding,
        showTimelineBar: true,
        showProgressLabel,
        showInstruction,
        globalBlockTop,
        globalBlockBottom,
        panelY,
        panelHeight,
        panelTop,
        panelBottom,
        showStage,
        stageBaseY,
        dancerScale,
        safeTopApplied,
        safeBottomApplied,
        safeInsetsClamped,
        hudBottom: judgementBottom
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
