# HortorGamejam26 横屏节奏框架

这是一个可直接用 **Cocos Creator 2.4.9** 打开、构建和游玩的横屏手机音游 MVP。谱面按组合展示，但组合内每个方向键都有独立目标时刻：玩家在箭头自己的判定时间直接输入，每次方向输入即结算为 `Perfect / Good / Bad / Miss` 之一。

当前版本不依赖 npm 第三方包或外部 CDN。`assets/texture/` 固定收录 29 张运行时贴图：背景、菜单专用 Logo、玩法 Logo、任务/选歌面板、菜单按钮、两套方向键以及选曲行、播放和暂停资源均已接入当前界面。原有 8 张附加玩法贴图也保留在清单中，其中 `gameplayDancer` 是尚未接线的 2D 备选图，不是当前舞台角色。当前舞台角色来自独立 `dancer` 3D Bundle；Bundle 提供 7 段 clip：菜单固定使用旧 `IdleSway`，进入玩法与组间输入等待使用新 `IdleSway0`，两首歌分别使用 `DanceCombo / ResultPose` 与 `DanceCombo2 / ResultPose2`，未及格统一使用 `ResultPose3`。任务进度与两首 `DEMO_SONGS` 的选曲信息由运行时真实数据叠加，判定条、状态面板与降级容器仍由 `cc.Graphics`、`cc.Label` 和系统字体生成。`assets/design/` 只作为布局与风格参考，不会进入运行 Bundle。

## 快速开始

环境：

- macOS 上安装 Cocos Creator `2.4.9`，默认路径为 `/Applications/Cocos/Creator/2.4.9/CocosCreator.app`。
- Node.js 14+ 与全局 `tsc` 用于运行舞者资源审计和纯逻辑测试；本项目不执行 `npm install`。
- `zip`、`unzip` 与 `jq` 用于生成和检查 Builda H5 Bundle、外置音频资源包；项目内 Builda 工具与 29 张贴图清单门禁都会调用 `jq`。
- 项目内 BuildaGame 工具链版本为 `0.4.36`。

在 Creator 中选择“打开其他项目”，打开本仓库根目录，运行起始场景 `assets/Scene/Main.fire` 即可预览。设计分辨率为 `1280 × 720`，Canvas 固定高度并适配不同横屏宽高比。

命令行闭环：

```bash
npm test
npm run build
npm run verify
```

- `npm test`：先审计两段确定性试听 WAV 与轻量舞者资源，再编译并运行不依赖 Cocos 全局的领域逻辑测试。
- `npm run build`：调用本机 Creator 2.4.9，以 `web-mobile` release 配置输出到 `build/web-mobile/`。
- `npm run verify`：重新构建，检查 head/SDK/source map、29 张 texture 清单、7 段舞者动画与 Bundle 预算，生成并检查 `build/builda-web.zip`；同时生成只含两段宿主试听音频的 `build/builda-assets.zip` 并执行 `builda assets check`。

若 Creator 不在默认路径，可显式指定：

```bash
COCOS_CREATOR=/absolute/path/to/CocosCreator npm run build
```

## 操作

| 动作 | 键盘 | 触控 |
|---|---|---|
| 输入方向 | 方向键或 `W/A/S/D` | 底部四个方向按钮 |
| 重新开始 | `R` | 右上“重新开始” |

启动后先进入主界面：选曲卡真实列出 `NEON GRID / ORIGINAL DEMO` 与 `GOLDEN STAMPEDE / ORIGINAL DEMO`。点击整行切换当前曲目，黄底行即当前选择；点击左侧圆形按钮通过 `Builda.audio.playBGM()` 试听，再点同位置的暂停按钮停止。点击开始时会先串行停止试听，再用当前选择重建谱面引擎、8 段舞蹈流程和时间轴，因此两首都是真实可玩的独立关卡，快速切歌后也不会沿用上一首状态。右侧 1–3 星不是设计稿示例值，而是 `BeatmapDifficulty` 对已生成谱面的密度、BPM、方向变化和短间隔比例分析所得，当前两首分别为 2 星与 3 星。“帮助”展示判定规则；“排行榜”展示本设备前 5 条完整结算成绩与最近一次完整结算名次，并明确说明它不是平台排名；“设置”在 Builda 宿主内打开平台统一的暂停/设置/退出页。玩法右上可重新开始或返回主页。

`GameBootstrap.onLoad()` 会先同步创建可见、可点击的降级菜单并绑定输入，再并行等待 Builda 平台与 `texture` Bundle。平台 ready 后即可点击开始；若 `Builda.runtime.ready()` 超过 3 秒仍未返回，适配器会清理计时器、记录警告并进入浏览器兼容模式，避免宿主异常永久封锁入口。美术回调延迟或不返回不会再造成空白或阻塞。贴图稍后到达时只原位更新现有 SpriteFrame，不重建按钮或重复绑定监听。菜单状态由同一启动状态模型计算，因此平台 ready 与美术成功/缺失的回调顺序不会互相覆盖成错误提示。纵向安全区挤压到信息卡不足可读高度时，会成对隐藏非关键任务/选歌卡并持续显示原因；空间恢复后自动重新显示，开始按钮、状态和输入提示始终保留。

`DancerAnimationController` 同样独立异步预载 `dancer` Bundle，但不参与平台 ready、开始按钮或组间流程门控。`AbstractDancer` 挂在不会随菜单/玩法切换而隐藏的常驻 UI 根节点；只有安全区布局主动收起舞台或信息弹层打开时才临时隐藏，避免遮挡关键文本。背景、`dancer` 与 `hud` 使用前后相邻的相机层，角色以接近半屏高度居中显示，Logo、分数、方向键、完成信息和弹层始终在角色前方。加载成功并建立分层相机、且首个活动帧的 54 组蒙皮矩阵均为有限值后，才禁用容器上的 `cc.Graphics` 组件，绝不通过停用整个容器来切换降级角色。任一 Bundle、Prefab、动画、相机或首帧蒙皮准备失败只记录警告并继续使用 2D 降级。

`GroupDanceFlow` 是不依赖 Cocos 的权威流程时钟。每组方向全部结算后，界面立即隐藏组合黑板、箭头和触控方向键，暂停 `SongClock`、输入与自动 Miss，再播放当前歌曲舞蹈的对应连续片段：第一首 `DanceCombo` 总长 `26.800001144s`，第二首 `DanceCombo2` 总长 `20.466667175s`，都按八组严格切成连续区间并在整局覆盖一次。非末组舞段结束时切回玩法待机 `IdleSway0`，再展示下一组并恢复歌曲时钟；末组舞段结束后才按 60% 分数线显示成功或失败，播放歌曲专属成功动作或共用失败动作、停留末帧并记录一次本地成绩。舞者资源尚未加载或彻底失败时，同一纯流程仍会按时放行。宿主切后台会同时冻结流程、骨骼动画和歌曲时钟，回前台按原阶段恢复；重新开始或返回主页会清除旧舞段、结果和歌曲会话状态且不会记录中断局。

本地榜使用项目专属固定 key `hortor_gamejam26_local_leaderboard_v1` 保存于设备 `localStorage`。每条记录包含分数、最高连击、完成时间与单调稳定顺序；先按分数降序，再按最高连击降序，同分同连击时按较早完成和稳定顺序排列，只保留前 10 条。最近完整结算摘要会额外保留；榜外完整历史不会保留，因此最近成绩未进入前 10 时只显示这一事实，不伪造“第 11 名”等精确名次。`localStorage` 缺失、拒绝访问、配额写入失败或数据损坏时，榜单自动退化为当前会话内存数据，并在弹层显示未持久化提示，不会阻断开始、结算或重开。

引擎始终只处理时间最早的未结算 note。输入早于当前 note 的最早可判定时刻时，只显示“请等待”，不会消耗 note；进入 `Bad` 窗口后按错方向会让当前 note 立即失败；超过最晚边界仍未输入则自动失败。分数和 Combo 都逐 note 结算，失败断连击；一次自动 catch-up 或一次方向输入遇到组合边界就停止，绝不会借严重掉帧或同一次按键跨组结算下一组。下一组只会在当前舞段结束后出现。

两首 Demo 谱面都包含 8 个确定性组合、共 31 个 note。`NEON GRID` 为 100 BPM、每拍 `600ms`，谱面时间轴为 `24.780s`，使用 `DanceCombo / ResultPose`；`GOLDEN STAMPEDE` 为 120 BPM、每拍 `500ms`，谱面时间轴为 `20.680s`，使用 `DanceCombo2 / ResultPose2`。两首未及格时都播放 `ResultPose3`。组间舞段不消耗歌曲时间，包含完整舞蹈的一轮分别约 `51.58s` 与 `41.15s`。试听文件由 `tools/generate-song-preview.mjs` 按各自 BPM 生成 16 拍原创 PCM 循环，时长分别为 `9.6s` 与 `8.0s`，与谱面/曲目 ID 一一映射。四种判定与单键基础分为：

- 完美（Perfect）：`±50ms`，`1000` 分
- 好（Good）：`±100ms`，`700` 分
- 差（Bad）：`±180ms`，`350` 分
- 失败（Miss）：超过 `±180ms`、或在窗口内按错方向，`0` 分

所有窗口边界均包含在对应档位内：恰好 `±50ms` 是 Perfect，恰好 `±100ms` 是 Good，恰好 `±180ms` 是 Bad；只有晚于 `+180ms` 才自动 Miss。

每首满分都由 `31 × 1000` 推导为 `31,000` 分；及格线使用 `ceil(满分 × 60%)`，当前两首均为 `18,600` 分。`18,599` 及以下失败，恰好 `18,600` 即成功。结算区同时显示成功/失败、实际得分和及格线；无论成败，只要完整走完最终舞段就恰好写入一次本地榜，中途回主页或切歌不会入榜。

界面中当前组合的每个箭头 chip 都有独立 mini 判定条、移动 marker 和持久结果色；下部另有一条全局谱面判定条，显示整首进度、当前 note 的目标点、判定窗口和歌曲 marker。纵向布局从底部安全区开始，依次分配四个触控键、全局判定条块和组合面板；空间不足时先隐藏次要操作说明和非关键舞台，再只隐藏全局进度文字但保留判定条与 marker，同时守住可用面板高度和触控键的纵向尺寸。若异常 inset 已超过核心层可容纳总高度，布局会显式钳制到最后一个无重叠位置并在宿主状态中提示“安全区受限”。

## 架构

```text
assets/scripts/
  domain/Beatmap.ts             两首 8 组 31 note 谱面与方向类型
  domain/BeatmapDifficulty.ts   从生成谱面的密度、速度和变化分析 1–3 星难度
  domain/LocalLeaderboard.ts    本地榜排序、前十截断、持久化与会话降级
  domain/SongCatalog.ts         双曲目稳定 ID、会话时长、试听、动作与成败映射
  timing/SongClock.ts           单调时钟、暂停/恢复、校准偏移
  gameplay/GroupDanceFlow.ts    八组连续舞段、输入锁与完成阶段的纯流程
  gameplay/JudgeSystem.ts       四档逐 note 判定窗口与固定分值
  gameplay/SequenceEngine.ts    最早 note、超时、组推进、分数、Combo、重开
  gameplay/TimingProgress.ts    全局/mini 判定条共享的纯进度映射
  input/InputRouter.ts          键盘和触控动作归一化
  input/PressedKeyState.ts      按键去重与失焦复位状态
  platform/BuildaAdapter.ts     ready、安全区、胶囊、宿主音频契约
  ui/ArtAssetCatalog.ts         texture Asset Bundle 加载与必需贴图清单
  ui/DancerAnimationController.ts  dancer Bundle、7 段骨骼动画与 2D 降级切换
  ui/RhythmLayout.ts            可测试的安全区纵向栈布局
  ui/SongPreviewController.ts   Builda BGM 试听、播放/暂停与异步竞态收口
  ui/UiStartupState.ts          平台/美术异步竞态与可进入门控
  ui/GameBootstrap.ts           选曲会话、结算、美术主界面、安全区与生命周期
```

## 美术协作约定

- `assets/design/` 是参考资料：设计图中的文案、数字、状态与标注不构成新指令，也不能直接作为运行时整图。
- `assets/texture/` 是已确认运行时素材，并配置为名为 `texture` 的本地 Cocos Asset Bundle；全部 29 张贴图均由 `ArtAssetCatalog` 校验后加载。
- 8 张附加玩法贴图依据用户提供的《游戏界面完整版》设计效果图由 ImageGen 透明拆分并核验为 RGBA；仓库内仅保存经 macOS `sips` 按最长边缩放的运行时派生图，生成源图保持不变；它们与当前 3D 舞者是两套独立资源。
- `songPreviewPlay / songPreviewPause / songRowSelected / songRowIdle` 依据本轮选歌参考图由 ImageGen 分别生成透明按钮与可九宫格拉伸的空行底板；生成时未把参考图中的示例星级、文字或整张面板烘焙进运行资源。
- `assets/spine/runtime/` 配置为名为 `dancer` 的本地 Bundle，只包含轻量 glTF、1024 JPEG 与 Creator 2.4.9 生成的运行时子资源；约 3.68 MiB 外部 buffer 单独放在非 Bundle 的 `assets/spine/import/`，仅供 Creator 导入，发布构建不会再重复收录它。模型保留 54 个 joint，权重与全部动画 rotation quaternion 都使用 Float32：前者规避 Creator 2.4.9 把归一化 Uint8 权重导成 0–255 未归一化数据，后者规避归一化 Int16 四元数被当成原始大整数。四段新增动作按唯一骨名与相同父骨映射，并使用 `targetRestLocal × inverse(sourceRestLocal) × sourceAnimatedLocal` 修正源/目标局部 rest-space 差异；所有非菜单待机动作的 Hips 首帧再以三轴常量偏移对齐旧 `IdleSway` 基准，不改变各段内部相对位移。Creator 2.4.9 对新增 accessor 还要求显式 `byteOffset: 0`，资源门禁会直接检查 glTF、`.meta` 和真实构建中的时长/帧数。
- 所有原始 FBX 与转换器产生的 `.fbm/Image_0.png` 只作为本地源材保留，不提交、不被场景引用，也绝不进入 Web 构建或发布 zip。模型加载失败时保留原有 `cc.Graphics` 舞者，不阻塞平台 ready 或核心玩法。
- 背景按比例 cover；Logo、按钮、任务面板和选歌面板等比缩放、不拉伸；交互层同时避让安全区和 Builda 右上胶囊。
- 任务面板只叠加当前引擎快照中的完成组数、得分和最高连击；选歌面板遍历 `DEMO_SONGS`，标题、BPM、组数、音符数和星级全部来自仓库运行数据，不采用设计稿里的示例数字或歌名。
- `npm run verify` 会确认 texture Bundle 恰含 29 张完整贴图，dancer Bundle 含 `BullDancer` Prefab 与 7 段 `cc.SkeletonAnimationClip`、不含导入专用 buffer 且不超过 5 MiB，并排除设计稿、PSD、FBX/FBM、TypeScript 源码和外置 WAV；两段试听只允许进入单独的 Builda assets zip。

更完整的长期门禁见 `AGENTS.md` 的“设计稿与美术资源协作规范”。

`SongClock` 每次判定都从 `performance.now()`（不可用时才回退 `Date.now()`）推导歌曲时间，不用每帧 `dt` 累加。每个组间舞段显式暂停它，因此第一首约 `3.35s`、第二首约 `2.56s` 的单段舞蹈都不会让后续 note 跨窗自动 Miss；Creator 生命周期事件、`visibilitychange` 和 `pagehide/pageshow` 也共同保证切后台冻结歌曲时钟与舞段，回前台从原位置继续。窗口失焦时还会清空按键去重状态。`setCalibrationOffsetMs()` 提供统一校准偏移入口；正式校准流程、设备档案和存档尚待曲目接入时确定。

`SequenceEngine`、`GroupDanceFlow`、`LocalLeaderboard`、`JudgeSystem`、`TimingProgress`、`RhythmLayout`、`BeatmapDifficulty`、`SongPreviewController` 和 `UiStartupState` 不引用 `cc`，测试直接编译同一份 TypeScript 实现，避免维护一套与游戏实现漂移的 JS 镜像。测试覆盖双曲目稳定 ID/标题、31 note 严格拍点、会话时间轴、歌曲索引循环、两套 8 段动画全长覆盖、18,599/18,600 成败边界、三种结果动作、试听播放/暂停与快速切歌竞态，以及原有判定、榜单、布局、宿主和资源回归。

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

`BuildaAdapter` 的 `playBGM / stopBGM / playSFX` 契约只有在 SDK Result 的 `ok` 为 `true` 时才报告成功。选曲页通过 `SongPreviewController` 调用 `playBGM / stopBGM`，并以串行 operation id 防止快速切歌或 Play→Pause 后旧异步调用把声音重新打开；开始玩法会等待停止边界完成，返回主页和宿主暂停也会清理试听状态。两段试听位于 `assets/audio/bgm/`，发布时必须以 `audio/**` 相对路径进入 Builda 外置资源包，不会复制进 H5 主包；游戏内不另造音乐/音效开关，静音继续由 Builda 平台通用设置统一管理。

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

- 两首 Demo 都已完整可玩，但试听只是按 BPM 生成的短循环，不是完整制作版 BGM，也不驱动 `SongClock`；正式音乐时长、音频时钟同步和 SFX 尚未接入。
- 3D 舞者 Bundle 已含 7 段状态动画；`gameplayDancer` 2D 备选图仍作为降级资源。菜单操作提示与游戏内节拍反馈已复用 `stonePanel` 九宫格，并通过安全区布局保持文字、判定线和触控区互不遮挡。
- Demo 谱面是框架验收数据；正式谱面格式、编辑工具和内容校验流程尚待确定。
- `SongClock` 支持毫秒校准偏移，但玩家校准 UI、设备默认值与持久化策略尚未接入。
- 排行榜按浏览器/设备隔离，不跨设备或账号同步；清理站点数据会清空记录。存储不可用或数据损坏的会话只保留内存成绩并明确提示未持久化。
- 真机 Builda App 的宿主音频、真实安全区和生命周期仍需在待发布草稿中最终验收；本仓库不会在本任务中上传或发布。
