export type ArtAssetName =
    "BackGround"
    | "logo"
    | "menuLogo"
    | "todayTaskPanel"
    | "songSelectPanel"
    | "startBtn"
    | "settingBtn"
    | "rankBtn"
    | "helpBtn"
    | "leftArrow"
    | "downArrow"
    | "upArrow"
    | "rightArrow"
    | "leftArrow2"
    | "downArrow2"
    | "upArrow2"
    | "rightArrow2"
    | "gameplayDancer"
    | "discoBall"
    | "danceBtnA"
    | "pauseBtn"
    | "stonePanel"
    | "perfectBadge"
    | "starFilled"
    | "starEmpty";

export const REQUIRED_ART_ASSETS: ArtAssetName[] = [
    "BackGround",
    "logo",
    "menuLogo",
    "todayTaskPanel",
    "songSelectPanel",
    "startBtn",
    "settingBtn",
    "rankBtn",
    "helpBtn",
    "leftArrow",
    "downArrow",
    "upArrow",
    "rightArrow",
    "leftArrow2",
    "downArrow2",
    "upArrow2",
    "rightArrow2",
    "gameplayDancer",
    "discoBall",
    "danceBtnA",
    "pauseBtn",
    "stonePanel",
    "perfectBadge",
    "starFilled",
    "starEmpty"
];

function normalizedName(name: string): string {
    return (name || "").replace(/\.(png|jpe?g)$/i, "").toLowerCase();
}

/** Loads the user-approved runtime art bundle. Design composites never enter this catalog. */
export class ArtAssetCatalog {
    private readonly frames: { [key: string]: cc.SpriteFrame } = {};

    public load(): Promise<ArtAssetName[]> {
        return new Promise((resolve) => {
            cc.assetManager.loadBundle("texture", (bundleError: Error, bundle: cc.AssetManager.Bundle) => {
                if (bundleError || !bundle) {
                    console.error("[ArtAssetCatalog] texture bundle failed to load", bundleError);
                    resolve(REQUIRED_ART_ASSETS.slice());
                    return;
                }
                bundle.loadDir("", cc.SpriteFrame, (assetError: Error, assets: cc.SpriteFrame[]) => {
                    if (assetError) {
                        console.error("[ArtAssetCatalog] texture sprite frames failed to load", assetError);
                        resolve(REQUIRED_ART_ASSETS.slice());
                        return;
                    }
                    (assets || []).forEach((frame) => {
                        this.frames[normalizedName(frame.name)] = frame;
                    });
                    const missing = REQUIRED_ART_ASSETS.filter((name) => !this.get(name));
                    if (missing.length > 0) {
                        console.error("[ArtAssetCatalog] required art assets are missing", missing.join(", "));
                    } else {
                        console.info("[ArtAssetCatalog] loaded " + REQUIRED_ART_ASSETS.length + " runtime sprite frames");
                    }
                    resolve(missing);
                });
            });
        });
    }

    public get(name: ArtAssetName): cc.SpriteFrame | null {
        return this.frames[normalizedName(name)] || null;
    }
}
