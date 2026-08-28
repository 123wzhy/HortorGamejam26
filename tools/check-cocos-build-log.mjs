import fs from "fs";

const logPath = process.argv[2];

if (!logPath) {
    console.error("error: usage: check-cocos-build-log.mjs /path/to/cocos-build.log");
    process.exit(2);
}

const log = fs.readFileSync(logPath, "utf8");
const imageSidecar = "(?:[.]fbm[\\\\/]+Image_0[.]png|Image_0[.]png)";
const missingSidecarPatterns = [
    new RegExp("Input file is missing[^\\r\\n]*" + imageSidecar, "i"),
    new RegExp(imageSidecar + "[^\\r\\n]*(?:missing|not found|ENOENT)", "i")
];

if (missingSidecarPatterns.some((pattern) => pattern.test(log))) {
    console.error("error: Cocos build log contains a missing FBX texture sidecar");
    process.exit(1);
}

console.log("cocos-source-sidecars=ok");
