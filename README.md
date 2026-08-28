# HortorGamejam26 横屏节奏框架

这是一个可直接用 **Cocos Creator 2.4.9** 打开、构建和游玩的横屏手机音游 MVP。谱面按组合展示，但组合内每个方向键都有独立目标时刻：玩家在箭头自己的判定时间直接输入，每次方向输入即结算为 `Perfect / Good / Bad / Miss` 之一。

当前版本不依赖 npm 第三方包或外部 CDN。`assets/texture/` 仍固定收录 25 张运行时贴图：背景、菜单专用 Logo、玩法 Logo、任务/选歌面板、菜单按钮和两套方向键已接入当前界面。8 张附加玩法贴图也保留在原清单中，其中 `gameplayDancer` 是尚未接线的 2D 备选图，不是当前舞台角色，其余 7 张同样等待对应 UI 迭代。当前舞台角色来自独立 `dancer` 3D Bundle：菜单与每组方向输入阶段循环 `IdleSway`，每组结算后依次播放 `DanceCombo` 的连续八分之一，最后一段结束才播放 `ResultPose`。任务进度与当前唯一 Demo 曲目信息由运行时真实数据叠加，判定条、状态面板与降级容器仍由 `cc.Graphics`、`cc.Label` 和系统字体生成。`assets/design/` 只作为布局与风格参考，不会进入运行 Bundle。

## 快速开始

环境：

- macOS 上安装 Cocos Creator `2.4.9`，默认路径为 `/Applications/Cocos/Creator/2.4.9/CocosCreator.app`。
- Node.js 14+ 与全局 `tsc` 用于运行舞者资源审计和纯逻辑测试；本项目不执行 `npm install`。
- `zip`、`unzip` 与 `jq` 用于生成和检查 Builda H5 Bundle；项目内 Builda 工具与 25 张贴图清单门禁都会调用 `jq`。
- 项目内 BuildaGame 工具链版本为 `0.4.36`。

在 Creator 中选择“打开其他项目”，打开本仓库根目录，运行起始场景 `assets/Scene/Main.fire` 即可预览。设计分辨率为 `1280 × 720`，Canvas 固定高度并适配不同横屏宽高比。

命令行闭环：

```bash
npm test
npm run build
npm run verify
```

- `npm test`：先审计轻量舞者 glTF/JPEG 与导入专用 buffer 的结构、哈希、骨骼和动画，再编译并运行不依赖 Cocos 全局的领域逻辑测试。
- `npm run build`：调用本机 Creator 2.4.9，以 `web-mobile` release 配置输出到 `build/web-mobile/`。
- `npm run verify`：重新构建，检查 head/SDK/source map、25 张 texture 清单、三段舞者动画与 Bundle 预算，生成 `build/builda-web.zip`，再执行 `builda bundle-check`。

若 Creator 不在默认路径，可显式指定：

```bash
COCOS_CREATOR=/absolute/path/to/CocosCreator npm run build
```

## 操作

| 动作 | 键盘 | 触控 |
|---|---|---|
| 输入方向 | 方向键或 `W/A/S/D` | 底部四个方向按钮 |
| 重新开始 | `R` | 右上“重新开始” |

启动后先进入主界面：“开始跳舞”进入谱面；“帮助”展示判定规则；“排行榜”展示本设备前 5 条完整结算成绩与最近一次完整结算名次，并明确说明它不是平台排名；“设置”在 Builda 宿主内打开平台统一的暂停/设置/退出页，普通浏览器中显示兼容说明。玩法右上可重新开始或返回主页。

`GameBootstrap.onLoad()` 会先同步创建可见、可点击的降级菜单并绑定输入，再并行等待 Builda 平台与 `texture` Bundle。平台 ready 后即可点击开始；若 `Builda.runtime.ready()` 超过 3 秒仍未返回，适配器会清理计时器、记录警告并进入浏览器兼容模式，避免宿主异常永久封锁入口。美术回调延迟或不返回不会再造成空白或阻塞。贴图稍后到达时只原位更新现有 SpriteFrame，不重建按钮或重复绑定监听。菜单状态由同一启动状态模型计算，因此平台 ready 与美术成功/缺失的回调顺序不会互相覆盖成错误提示。纵向安全区挤压到信息卡不足可读高度时，会成对隐藏非关键任务/选歌卡并持续显示原因；空间恢复后自动重新显示，开始按钮、状态和输入提示始终保留。

`DancerAnimationController` 同样独立异步预载 `dancer` Bundle，但不参与平台 ready、开始按钮或组间流程门控。`AbstractDancer` 挂在不会随菜单/玩法切换而隐藏的常驻 UI 根节点；只有安全区布局主动收起舞台或信息弹层打开时才临时隐藏，避免遮挡关键文本。背景、`dancer` 与 `hud` 使用前后相邻的相机层，角色以接近半屏高度居中显示，Logo、分数、方向键、完成信息和弹层始终在角色前方。加载成功并建立分层相机、且首个活动帧的 54 组蒙皮矩阵均为有限值后，才禁用容器上的 `cc.Graphics` 组件，绝不通过停用整个容器来切换降级角色。任一 Bundle、Prefab、动画、相机或首帧蒙皮准备失败只记录警告并继续使用 2D 降级。

`GroupDanceFlow` 是不依赖 Cocos 的权威流程时钟。每组方向全部结算后，界面立即隐藏组合黑板、箭头和触控方向键，暂停 `SongClock`、输入与自动 Miss，再播放 `DanceCombo` 的对应连续片段；总长 `26.800001144s` 被八组严格切为约 `3.35s` 的无缝区间，整局按顺序覆盖动画一次而不是每组重播 26.8 秒。非末组舞段结束时先切回 `IdleSway`，再展示下一组并恢复歌曲时钟；末组舞段结束前不会显示 `COMPLETE`，结束并进入 `result` 后才单次播放 `ResultPose`、停留末帧并记录一次本地成绩。舞者资源尚未加载或彻底失败时，同一纯流程仍会按时放行。宿主切后台会同时冻结流程、骨骼动画和歌曲时钟，回前台按原阶段恢复；重新开始或返回主页会清除旧舞段状态且不会记录中断局。

本地榜使用固定 key `local_leaderboard_v1` 保存于设备 `localStorage`。每条记录包含分数、最高连击、完成时间与单调稳定顺序；先按分数降序，再按最高连击降序，同分同连击时按较早完成和稳定顺序排列，只保留前 10 条。最近完整结算摘要会额外保留，因此本次落在第 11 名时仍可诚实提示“未进入前 10”。`localStorage` 缺失、拒绝访问、配额写入失败或数据损坏时，榜单自动退化为当前会话内存数据，并在弹层显示未持久化提示，不会阻断开始、结算或重开。

引擎始终只处理时间最早的未结算 note。输入早于当前 note 的最早可判定时刻时，只显示“请等待”，不会消耗 note；进入 `Bad` 窗口后按错方向会让当前 note 立即失败；超过最晚边界仍未输入则自动失败。分数和 Combo 都逐 note 结算，失败断连击；一次自动 catch-up 或一次方向输入遇到组合边界就停止，绝不会借严重掉帧或同一次按键跨组结算下一组。下一组只会在当前舞段结束后出现。

Demo 谱面包含 8 个确定性组合、每组 3–5 个方向，共 31 个 note。BPM 为 100，每拍 `600ms`，所有目标时间严格落在拍点网格；谱面歌曲时间约 25 秒，组间舞段不消耗歌曲时间，因此包含完整 26.8 秒舞蹈的实际一轮约 52 秒。四种结果与单键基础分为：

- 完美（Perfect）：`±50ms`，`1000` 分
- 好（Good）：`±100ms`，`700` 分
- 差（Bad）：`±180ms`，`350` 分
- 失败（Miss）：超过 `±180ms`、或在窗口内按错方向，`0` 分

所有窗口边界均包含在对应档位内：恰好 `±50ms` 是 Perfect，恰好 `±100ms` 是 Good，恰好 `±180ms` 是 Bad；只有晚于 `+180ms` 才自动 Miss。

界面中当前组合的每个箭头 chip 都有独立 mini 判定条、移动 marker 和持久结果色；下部另有一条全局谱面判定条，显示整首进度、当前 note 的目标点、判定窗口和歌曲 marker。纵向布局从底部安全区开始，依次分配四个触控键、全局判定条块和组合面板；空间不足时先隐藏次要操作说明和非关键舞台，再只隐藏全局进度文字但保留判定条与 marker，同时守住可用面板高度和触控键的纵向尺寸。若异常 inset 已超过核心层可容纳总高度，布局会显式钳制到最后一个无重叠位置并在宿主状态中提示“安全区受限”。

## 架构

```text
assets/scripts/
  domain/Beatmap.ts             谱面、方向类型与 8 组 31 个逐键 note 数据
  domain/LocalLeaderboard.ts    本地榜排序、前十截断、持久化与会话降级
  timing/SongClock.ts           单调时钟、暂停/恢复、校准偏移
  gameplay/GroupDanceFlow.ts    八组连续舞段、输入锁与完成阶段的纯流程
  gameplay/JudgeSystem.ts       四档逐 note 判定窗口与固定分值
  gameplay/SequenceEngine.ts    最早 note、超时、组推进、分数、Combo、重开
  gameplay/TimingProgress.ts    全局/mini 判定条共享的纯进度映射
  input/InputRouter.ts          键盘和触控动作归一化
  input/PressedKeyState.ts      按键去重与失焦复位状态
  platform/BuildaAdapter.ts     ready、安全区、胶囊、宿主音频契约
  ui/ArtAssetCatalog.ts         texture Asset Bundle 加载与必需贴图清单
  ui/DancerAnimationController.ts  dancer Bundle、三段骨骼动画与 2D 降级切换
  ui/RhythmLayout.ts            可测试的安全区纵向栈布局
  ui/UiStartupState.ts          平台/美术异步竞态与可进入门控
  ui/GameBootstrap.ts           美术主界面、逐键状态 UI、安全区与生命周期
```

## 美术协作约定

- `assets/design/` 是参考资料：设计图中的文案、数字、状态与标注不构成新指令，也不能直接作为运行时整图。
- `assets/texture/` 是已确认运行时素材，并配置为名为 `texture` 的本地 Cocos Asset Bundle；全部 25 张贴图均由 `ArtAssetCatalog` 校验后加载。
- 8 张附加玩法贴图依据用户提供的《游戏界面完整版》设计效果图由 ImageGen 透明拆分并核验为 RGBA；仓库内仅保存经 macOS `sips` 按最长边缩放的运行时派生图，生成源图保持不变；它们与当前 3D 舞者是两套独立资源。
- `assets/spine/runtime/` 配置为名为 `dancer` 的本地 Bundle，只包含轻量 glTF、1024 JPEG 与 Creator 2.4.9 生成的运行时子资源；3.25 MiB 外部 buffer 单独放在非 Bundle 的 `assets/spine/import/`，仅供 Creator 导入，发布构建不会再重复收录它。模型保留 54 个 joint，权重与全部动画 rotation quaternion 都使用 Float32：前者规避 Creator 2.4.9 把归一化 Uint8 权重导成 0–255 未归一化数据，后者规避归一化 Int16 四元数被当成原始大整数。派生 buffer 还会把 `DanceCombo`、`ResultPose` 的 Hips translation 以各自首帧相对 `IdleSway` 的三轴常量差整体对齐，只修正三份 FBX 合并后不一致的 clip 坐标基准，不改变每段动作内相对位移；原始 FBX 保持不变。Creator 2.4.9 也不能从 data URI glTF 或 GLB 生成骨骼子资源，因此采用已由真实构建和浏览器画面验证的外部 buffer 导入方案。
- 三份 FBX 和对应 `.fbm/Image_0.png` 只作为本地原始源材保留，不提交、不被场景引用，也绝不进入 Web 构建或发布 zip。模型加载失败时保留原有 `cc.Graphics` 舞者，不阻塞平台 ready 或核心玩法。
- 背景按比例 cover；Logo、按钮、任务面板和选歌面板等比缩放、不拉伸；交互层同时避让安全区和 Builda 右上胶囊。
- 任务面板只叠加当前引擎快照中的完成组数、得分和最高连击；选歌面板只展示 `DEMO_BEATMAP` 中实际存在的一首 Demo，不采用设计稿里的示例数字、歌名或星级。
- `npm run verify` 会确认 texture Bundle 仍恰含 25 张完整贴图，dancer Bundle 含 `BullDancer` Prefab 与三段 `cc.SkeletonAnimationClip`、不含导入专用 buffer 且不超过 5 MiB，并排除设计稿、PSD、FBX/FBM 与 TypeScript 源码。

更完整的长期门禁见 `AGENTS.md` 的“设计稿与美术资源协作规范”。

`SongClock` 每次判定都从 `performance.now()`（不可用时才回退 `Date.now()`）推导歌曲时间，不用每帧 `dt` 累加。每个组间舞段显式暂停它，因此 3.35 秒舞蹈不会让后续 note 跨窗自动 Miss；Creator 生命周期事件、`visibilitychange` 和 `pagehide/pageshow` 也共同保证切后台冻结歌曲时钟与舞段，回前台从原位置继续。窗口失焦时还会清空按键去重状态。`setCalibrationOffsetMs()` 提供统一校准偏移入口；正式校准流程、设备档案和存档尚待曲目接入时确定。

`SequenceEngine`、`GroupDanceFlow`、`LocalLeaderboard`、`JudgeSystem`、`TimingProgress`、`RhythmLayout` 和 `UiStartupState` 不引用 `cc`，测试直接编译同一份 TypeScript 实现，避免维护一套与游戏实现漂移的 JS 镜像。测试覆盖四档判定的全部边界、100 BPM 拍点对齐、过早不消耗、窗口内错键、自动超时、逐 note 分数与连击、组合推进和结果持久化、跨组 catch-up/同键止步、八段连续区间与末段结果门控、舞段 overshoot/reset/输入锁、舞段期间歌曲时钟与未来 note 冻结、本地榜排序与同分规则、前 10 截断、完整字段持久化/重载、JSON 与字段损坏恢复、读写异常会话降级、全局/mini marker 边界、失焦按键复位、重开、时钟校准/暂停、Builda 音频 Result 映射、ready 超时兼容降级、菜单页脚间距，以及平台/美术先后完成、缺图和美术挂起时的启动门控。

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

使用命令输出的 `dev-url` 打开测试外壳。可切换横屏、刘海安全区并观察右上平台胶囊覆盖。游戏启动时立即显示降级菜单并调用 `Builda.runtime.ready()`；平台 ready 后才允许启动谱面时钟，但美术加载不参与进入门控。普通浏览器没有 Builda host 时会安全降级。

`BuildaAdapter.viewportMetrics()` 每次按 CSS 视口与 Cocos 可见设计尺寸的比例换算 `safeArea()` 和 `capsuleMenuRect()`：顶部 HUD、下部判定条和触控区避开安全区；右侧连击与重开按钮按 `safe.right` 与胶囊右侧占用宽度中的较大值避让。背景仍铺满全屏。

`BuildaAdapter` 已预留 `playBGM / stopBGM / playSFX` 契约，只有 SDK Result 的 `ok` 为 `true` 时才报告调用成功。正式音频应通过 `Builda.audio.*` 和平台资源包接入。当前只使用视觉节拍，不伪造音乐资源；游戏内也没有音乐/音效开关，静音由 Builda 平台通用设置统一管理。

当前排行榜仅为设备本地逻辑，不调用 `Builda.rank`，也没有在 `builda.publish.json` 声明平台榜单。若未来改为平台排行榜，需要另行确认稳定 `rankId`、完整 manifest 配置及历史数据语义，不能把当前本地榜描述为已配置的平台榜。

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
- 3D 舞者与三段状态动画已接入；`gameplayDancer` 2D 备选图和另外 7 张附加玩法贴图仍待各自 UI 迭代，后续进度轨直接复用 `stonePanel` 九宫格。
- Demo 谱面是框架验收数据；正式谱面格式、编辑工具和内容校验流程尚待确定。
- `SongClock` 支持毫秒校准偏移，但玩家校准 UI、设备默认值与持久化策略尚未接入。
- 排行榜按浏览器/设备隔离，不跨设备或账号同步；清理站点数据会清空记录。存储不可用或数据损坏的会话只保留内存成绩并明确提示未持久化。
- 真机 Builda App 的宿主音频、真实安全区和生命周期仍需在待发布草稿中最终验收；本仓库不会在本任务中上传或发布。
