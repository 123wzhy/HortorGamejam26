# HortorGamejam26 横屏节奏框架

这是一个可直接用 **Cocos Creator 2.4.9** 打开、构建和游玩的横屏手机音游 MVP。玩法采用舞蹈节奏游戏常见的“两阶段输入”：先按顺序完成方向序列，再在目标节拍按下确认键，根据时差得到 `Perfect / Great / Good / Miss`。

当前版本不依赖 npm 第三方包、外部 CDN、图片或音频资源。界面由 `cc.Graphics`、`cc.Label` 和系统字体在运行时生成，因此仓库本身即可完成真实 Cocos Web 构建，而不是演示占位工程。

## 快速开始

环境：

- macOS 上安装 Cocos Creator `2.4.9`，默认路径为 `/Applications/Cocos/Creator/2.4.9/CocosCreator.app`。
- Node.js 14+ 与全局 `tsc` 用于纯逻辑测试；本项目不执行 `npm install`。
- `zip` 与 `unzip` 用于生成和检查 Builda H5 Bundle。
- 项目内 BuildaGame 工具链版本为 `0.4.36`。

在 Creator 中选择“打开其他项目”，打开本仓库根目录，运行起始场景 `assets/Scene/Main.fire` 即可预览。设计分辨率为 `1280 × 720`，Canvas 固定高度并适配不同横屏宽高比。

命令行闭环：

```bash
npm test
npm run build
npm run verify
```

- `npm test`：编译并运行不依赖 Cocos 全局的领域逻辑测试。
- `npm run build`：调用本机 Creator 2.4.9，以 `web-mobile` release 配置输出到 `build/web-mobile/`。
- `npm run verify`：重新构建、静态检查 head/SDK/source map、生成 `build/builda-web.zip`，再执行 `builda bundle-check`。

若 Creator 不在默认路径，可显式指定：

```bash
COCOS_CREATOR=/absolute/path/to/CocosCreator npm run build
```

## 操作

| 动作 | 键盘 | 触控 |
|---|---|---|
| 输入方向 | 方向键或 `W/A/S/D` | 底部四个方向按钮 |
| 确认节拍 | `Space` 或 `Enter` | 右下 `BEAT` |
| 重新开始 | `R` | 右上 `RESTART` |

方向输错会清空当前短句，允许立即重新输入；序列完成后，过早确认只提示等待而不消耗机会。在 `Good` 窗口内以未完成序列确认，或超过窗口仍未确认，都会记为 `Miss`。Demo 谱面包含 8 个确定性短句，完整一轮约 15 秒。

默认判定窗口（含边界）为：

- Perfect：`±45ms`
- Great：`±90ms`
- Good：`±150ms`
- Miss：超出 Good 窗口，或窗口内确认时序列不完整

## 架构

```text
assets/scripts/
  domain/Beatmap.ts             谱面、方向类型与 8 段 demo 数据
  timing/SongClock.ts           单调时钟、暂停/恢复、校准偏移
  gameplay/JudgeSystem.ts       可配置判定窗口
  gameplay/SequenceEngine.ts    序列、超时、分数、Combo、重开
  input/InputRouter.ts          键盘和触控动作归一化
  platform/BuildaAdapter.ts     ready、安全区、胶囊、宿主音频契约
  ui/GameBootstrap.ts           程序化 UI、视觉节拍、生命周期
```

`SongClock` 每次判定都从 `performance.now()`（不可用时才回退 `Date.now()`）推导歌曲时间，不用每帧 `dt` 累加。切后台会冻结歌曲时钟，回前台从原位置继续。`setCalibrationOffsetMs()` 提供统一校准偏移入口；正式校准流程、设备档案和存档尚待曲目接入时确定。

`SequenceEngine` 和 `JudgeSystem` 不引用 `cc`，测试直接编译同一份 TypeScript 实现，避免维护一套与游戏实现漂移的 JS 镜像。测试覆盖判定边界、视觉节拍与谱面拍点对齐、错误方向、早按/不完整确认、过期 Miss、重开、时钟校准/暂停和 Builda 音频 Result 映射。

## BuildaGame 接入

项目按 HTML5 引擎发布：

```bash
./.builda-agent/builda check
./.builda-agent/builda engine detect
./.builda-agent/builda sdk install
./.builda-agent/builda sdk check
./.builda-agent/builda sdk smoke
```

`engine detect` 应输出 `engine=h5`。较老 Node.js 没有全局 `btoa` 时，SDK 自带 smoke runner 会失败；请让 `PATH` 优先使用本机 Node.js 18+ 后重跑，不需要修改 SDK 文件。

本地宿主调试：

```bash
./.builda-agent/builda dev --web build/web-mobile --safearea 44,0,34,0
```

使用命令输出的 `dev-url` 打开测试外壳。可切换横屏、刘海安全区并观察右上平台胶囊覆盖。游戏启动时先调用 `Builda.runtime.ready()`，完成后才启动谱面时钟；普通浏览器没有 Builda host 时会安全降级。

`BuildaAdapter.viewportMetrics()` 每次按 CSS 视口与 Cocos 可见设计尺寸的比例换算 `safeArea()` 和 `capsuleMenuRect()`：分数、触控区避开安全区，重开按钮额外避开右上胶囊。背景仍铺满全屏。

`BuildaAdapter` 已预留 `playBGM / stopBGM / playSFX` 契约，只有 SDK Result 的 `ok` 为 `true` 时才报告调用成功。正式音频应通过 `Builda.audio.*` 和平台资源包接入。当前只使用视觉节拍，不伪造音乐资源；游戏内也没有音乐/音效开关，静音由 Builda 平台通用设置统一管理。

发布模板位于 `build-templates/web-mobile/`。它以 Creator 2.4.9 的真实 `web-mobile` 产物为基础，并在 `<head>` 最早依次加载：

```html
<script src="mobile-perf.js"></script>
<script src="builda-sdk.js"></script>
```

`mobile-perf.js` 只读取宿主传入的 `?dpr=N`：正数限制渲染 DPR，`0`、无参数或非法值保持设备原生 DPR。它不做机型判断。

正式 zip 只保留对根路径 `builda-sdk.js` 的引用，**不会包含 SDK JS 本体**；本地 `builda dev` 会从 `.builda-agent/sdk/web/` 提供 mock，正式宿主按 manifest SDK 契约注入。构建同时禁用 source map，且不会把源码、`library/`、`local/`、`temp/` 或 `build/` 纳入 Git。

### Creator 2.4.9 构建字段

仓库与 CLI 固定以下 release 设置：

| 目标口径 | Creator 2.4.9 实际字段 | 值 |
|---|---|---|
| `mainBundleIsRemote` | `mainIsRemote` | `false` |
| source maps | `sourceMaps` | `false` |
| debug | `debug` | `false` |
| MD5 文件名 | `md5Cache` | `false` |
| 方向 | `webOrientation` | `landscape` |

`mainIsRemote` 是 2.4.9 对后续版本 `mainBundleIsRemote` 语义的真实字段。禁用 MD5 可避免自定义根路径模板与哈希资源名发生错配；实际构建的 `_CCSettings.remoteBundles` 应为空。

`builda.publish.json` 由 `builda new-manifest` 生成后补全，保持自动检测的 `engine=h5`，分类为 `music`、方向为 `landscape`，兼容基线为 Chrome 80 / iOS 15。当前任务只构建和本地验证，不执行授权、上传、创建/更新草稿或公开发布。

## 已知边界

- Demo 使用视觉节拍；正式 BGM、SFX、曲目时长和音频时钟同步尚未接入。
- Demo 谱面是框架验收数据；正式谱面格式、编辑工具和内容校验流程尚待确定。
- `SongClock` 支持毫秒校准偏移，但玩家校准 UI、设备默认值与持久化策略尚未接入。
- 真机 Builda App 的宿主音频、真实安全区和生命周期仍需在待发布草稿中最终验收；本仓库不会在本任务中上传或发布。
