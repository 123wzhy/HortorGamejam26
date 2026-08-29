# HortorGamejam26 横屏节奏游戏

这是一个可直接用 **Cocos Creator 2.4.9** 打开、构建和游玩的横屏手机音游 MVP。当前版本包含三首真实 MP3 关卡：`凤舞九天`、`猪猪侠` 与 `Are You OK`。谱面按八个组合展示，但组合内每个方向键都有独立目标时刻；每次输入结算为 `Perfect / Good / Bad / Miss` 之一。

项目不依赖 npm 第三方包或外部 CDN。`assets/texture/` 固定收录 29 张运行时贴图；当前舞台角色来自独立 `dancer` 3D Bundle，使用 `IdleSway0.fbx` 自带的低面模型、33-joint 骨架与黄衣角色纹理，并提供 7 段动画。菜单使用稳定名 `IdleSway`，玩法输入等待使用 `IdleSway0`；每次实际开局从两套完整动作组中随机选择一套，未及格统一使用 `ResultPose3`。`assets/design/` 仅作布局与风格参考，不进入运行 Bundle。

## 快速开始

环境：

- macOS 上安装 Cocos Creator `2.4.9`，默认路径为 `/Applications/Cocos/Creator/2.4.9/CocosCreator.app`。
- Node.js 18+ 与全局 `tsc` 用于资源审计、纯逻辑测试和 Builda SDK smoke；本项目不执行 `npm install`。
- `zip`、`unzip` 与 `jq` 用于 Builda H5 Bundle 和外置音频包门禁。
- 项目内 BuildaGame 工具链与本地 mock SDK 版本为 `0.4.37`。

在 Creator 中打开仓库根目录，运行起始场景 `assets/Scene/Main.fire`。设计分辨率为 `1280 × 720`，Canvas 固定高度并适配不同横屏宽高比。

命令行闭环：

```bash
npm test
npm run build
npm run verify
```

- `npm test`：严格审计三份 MP3、舞者资源与 Creator sidecar，再编译并运行不依赖 Cocos 全局的领域逻辑测试。
- `npm run build`：调用 Creator 2.4.9，以 `web-mobile` release 配置输出到 `build/web-mobile/`。
- `npm run verify`：重新构建，检查 head/SDK/source map、29 张贴图、7 段舞者动画与 Bundle 预算，生成并检查 `build/builda-web.zip`；另生成只含三首目标 MP3 的 `build/builda-assets.zip` 并执行 `builda assets check`。H5 主 zip 不包含音频。

原始舞者 FBX 只放在 Creator 资源数据库之外的 `source-assets/dancer/`，不得放入 `assets/`。运行时只消费由这些 FBX 生成并检入的 glTF/JPEG/bin；模型、骨架、UV、材质和动作都保留原始 FBX 来源。`tools/rebuild-dancer-assets.sh` 会先把七份源文件复制到 `mktemp`，再调用 Creator 2.4.9 自带的 FBX2glTF；转换不使用 gltfpack，也不做网格减面。源文件哈希、原始模型/纹理 provenance、骨名/父级与 rest-space 重定向证据由 `tools/verify-dancer-assets.mjs` 锁定，细节见 `source-assets/dancer/README.md`。

若 Creator 不在默认路径，可显式指定：

```bash
COCOS_CREATOR=/absolute/path/to/CocosCreator npm run build
```

## 操作与选曲

| 动作 | 键盘 | 触控 |
|---|---|---|
| 输入方向 | 方向键或 `W/A/S/D` | 底部四个方向按钮 |
| 重新开始 | `R` | 右上“重新开始” |

启动后进入主界面。选曲卡恰好显示三行，整行可点击，当前选择以选中底板标识；左侧播放按钮循环试听当前 MP3，再点停止。选曲行纵向位置由纯布局函数计算：Cocos `FIXED_HEIGHT` 下布局坐标仍使用约 `1280×720` 的设计可见区，菜单是否紧凑则单独读取 CSS/物理 frame；frame 为 `960×540` 且顶部/底部安全区为 `44/34px` 时会隐藏非关键键位提示并保留 `184px` 卡片，frame 为 `1280×720` 时维持约 `252px` 常规卡片。两种布局的三行歌曲和底部状态文案均在卡片内且互不重叠。右侧 1–3 星由 `BeatmapDifficulty` 根据实际谱面的密度、BPM、方向变化和短间隔比例分析，不是设计稿示例值。

“帮助”展示判定规则；“排行榜”展示本设备前 5 条完整结算成绩及最近一次完整结算名次，并明确它不是平台排名；“设置”在 Builda 宿主内打开统一暂停/设置/退出页。玩法右上可重新开始或返回主页。

选歌与循环试听不会选择动作组。关卡音乐请求完成、真正建立新局时只抽取一次：动作组 A 为 `DanceCombo + ResultPose + ResultPose3`，总舞蹈时长 `26791.66603088379ms`；动作组 B 为 `DanceCombo2 + ResultPose2 + ResultPose3`，总舞蹈时长 `20458.33396911621ms`。本局八个舞段、会话时长和最终成功/失败动作始终读取同一个 profile；点击“重新开始”会建立新局并重新抽取一次。

`GameBootstrap.onLoad()` 会先同步创建可见、可点击的降级菜单并绑定输入，再并行等待 Builda 平台与 `texture` Bundle。平台 ready 后即可开始；若 `Builda.runtime.ready()` 超过 3 秒仍未返回，适配器会清理计时器、记录警告并进入浏览器兼容模式。美术异步失败不会阻塞核心玩法，稍后到达的贴图只更新现有 SpriteFrame，不重建按钮或重复绑定监听。

`GroupDanceFlow` 是不依赖 Cocos 的权威组间时钟；同文件中的 `SettlementFlow` 负责最终结果动作、成绩卡和自动返回。每组方向全部结算后，界面隐藏组合黑板、箭头和触控方向键并锁住输入与自动 Miss，但真实 BGM 和 `SongClock` 继续前进；本局选中的动作组总时长按八组严格切成连续区间。非末组舞段结束后切回 `IdleSway0` 并展示下一组；末组舞段结束后停止 BGM、按 60% 分数线确定成败，并完整播放本局 profile 对应的成功动作或共用失败动作。结果动作结束后显示独立成绩卡，列出得分、最高连击、及格线和结算数量，停留 5 秒后自动返回主菜单，也可点击“立即返回主菜单”。大帧间隔至多推进一个结算阶段，不能跳过成绩卡；舞者资源加载失败时仍按资源标定时长放行。宿主切后台会冻结结算流程和骨骼动画，回前台从原阶段恢复；重新开始或返回主页会清除旧舞段、结果和歌曲会话状态。

`DancerAnimationController` 独立异步预载 `dancer` Bundle，但不参与平台 ready 或关卡进入门控。加载成功并建立分层相机、且首个活动帧的 33 组蒙皮矩阵均为有限值后，才禁用 2D 降级绘制；Bundle、Prefab、动画、相机或首帧蒙皮失败时只记录警告并继续使用降级角色。

本地榜使用项目专属 key `hortor_gamejam26_local_leaderboard_v1`。记录先按分数、最高连击降序，再按较早完成时间和稳定顺序排序，只保留前 10 条。`localStorage` 缺失、拒绝访问、配额失败或数据损坏时退化为会话内存数据，不阻断开始、结算或重开。

## 三首关卡

三份谱面均有 8 个确定性组合，note ID 全局唯一且目标时间严格递增。BPM 与 offset 来自各音频前 120 秒的离线主拍分析；所有 note 都位于对应的整拍或半拍网格。首个可玩拍点约 7–8 秒，最后判定及最终舞段约在 55 秒完成。

| 歌曲 / 歌手 | BPM / offset | 音频时长 | note / 星级 | 首拍 / 最后判定 | 预计完成 A / B | 每局动作 |
|---|---:|---:|---:|---:|---:|---|
| 凤舞九天 / 凤舞九天 | `138.7 / 95.8ms` | `599.928s` | `32 / 2★` | `7.450s / 52.186s` | `55.535s / 54.744s` | `A / B 随机` |
| 猪猪侠 / 陈洁丽 | `140.88 / 352.9ms` | `218.462s` | `40 / 3★` | `7.593s / 52.066s` | `55.415s / 54.623s` | `A / B 随机` |
| Are You OK / 雷军 | `124.82 / 115.5ms` | `132.807s` | `27 / 1★` | `7.807s / 52.210s` | `55.559s / 54.768s` | `A / B 随机` |

组合之间的最小音频时钟空档分别约为 `5.191s / 5.324s / 4.807s`，均覆盖更长的动作组 A 单组舞段和两侧 `Bad` 判定余量，因此两套动作对三首歌曲都安全。`GroupDanceFlow` 在舞段中锁住输入与自动 Miss，但真实 BGM 和 `SongClock` 连续前进；舞段结束后下一组已经按原歌曲时间轴排好，不再像短循环占位曲那样暂停歌曲时钟。

玩法 HUD 在结果动作期间只显示短状态和演出倒计时，不再把完整结算句叠到顶部分数上；动作结束后的独立成绩卡显示成功/失败、实际得分、最高连击、及格线和结算数量。无论成败，只要完整走完最终舞段就恰好写入一次本地榜，中途回主页或切歌不会入榜。

每首进入玩法时都使用选曲页对应的同一份 MP3，并设置 `loop=false`。试听使用 `loop=true`。播放、停止、快速切歌、返回和重新开始都经过同一串行音频控制器：完整的 Builda 音频接口存在时只走宿主；SDK 脚本未载入或宿主音频接口不完整时，改用单实例浏览器 `Audio` BGM，并优先经 `Builda.assets.url()` 解析资源，否则按页面相对路径解析。关卡时钟尽量在 `playBGM()` Promise 完成的边界启动；音频不可用或拒绝时仍启动单调 fallback 时钟。重新开始会从头请求同一首 BGM；返回主页与最终结算会停止 BGM；过期的异步播放完成后会被再次停止，避免旧请求泄漏和双播。

宿主切后台会冻结流程、舞者和 `SongClock`；正常播放由宿主生命周期暂停/恢复。若后台发生在 pending start，恢复后会从头重建该局，避免用不确定的音频位置继续。快速返回或切歌会使旧请求失效，不会把界面带回已取消的关卡。

引擎始终只处理时间最早的未结算 note。过早输入只显示“请等待”，不消费 note；进入 `Bad` 窗口后按错方向会让当前 note 失败；超过最晚边界仍未输入则自动失败。一次自动 catch-up 或方向输入遇到组合边界即停止，不跨组结算。

四种判定与单键基础分：

- Perfect：`±50ms`，`1000` 分
- Good：`±100ms`，`700` 分
- Bad：`±180ms`，`350` 分
- Miss：晚于 `+180ms` 或窗口内按错方向，`0` 分

窗口边界包含在对应档位内。及格线为 `ceil(满分 × 60%)`：三首满分/及格分依次为 `32,000 / 19,200`、`40,000 / 24,000`、`27,000 / 16,200`。完整走完最终舞段后恰好写入一次本地榜；中途回主页或切歌不入榜。

## 架构

```text
assets/scripts/
  domain/Beatmap.ts             三首歌曲的 BPM、offset、8 组确定性谱面
  domain/BeatmapDifficulty.ts   从真实谱面压力分析 1–3 星难度
  domain/LocalLeaderboard.ts    本地榜排序、截断、持久化与会话降级
  domain/SongCatalog.ts         三曲稳定 ID、两套动作组、随机选择与局内会话
  timing/SongClock.ts           单调时钟、暂停/恢复/停止与校准偏移
  gameplay/GroupDanceFlow.ts    八组连续舞段、输入锁、结果动作与五秒结算时钟
  gameplay/JudgeSystem.ts       四档逐 note 判定窗口与固定分值
  gameplay/SequenceEngine.ts    最早 note、超时、组推进、得分与重开
  gameplay/TimingProgress.ts    全局/mini 判定条共享进度映射
  input/InputRouter.ts          键盘和触控动作归一化
  input/PressedKeyState.ts      按键去重与失焦复位
  platform/BuildaAdapter.ts     ready、安全区、胶囊与宿主音频契约
  ui/ArtAssetCatalog.ts         texture Bundle 与贴图清单
  ui/DancerAnimationController.ts  dancer Bundle、7 段动画与降级切换
  ui/RhythmLayout.ts            安全区与三行选曲布局纯逻辑
  ui/SongPreviewController.ts   串行 preview/gameplay BGM 与竞态收口
  ui/UiStartupState.ts          平台/美术异步状态与进入门控
  ui/GameBootstrap.ts           选曲、歌曲会话、结算与生命周期
```

`SequenceEngine`、`GroupDanceFlow`、`SettlementFlow`、`LocalLeaderboard`、`JudgeSystem`、`TimingProgress`、`RhythmLayout`、`BeatmapDifficulty`、`SongPreviewController` 和 `UiStartupState` 不引用 `cc`。测试直接编译同一份 TypeScript，实现覆盖三曲 catalog、随机值边界与非法值、两套动作组可达性、每歌 × 每动作组的谱面空档/会话/舞段/结果动作时长、五秒成绩卡与自动回主页、循环索引、连续歌曲时钟、选曲布局、试听/玩法 loop 差异以及快速切换和取消竞态。

## 资源与发布门禁

- `assets/design/` 是只读参考；不会被场景、脚本或发布 Bundle 引用。
- `assets/texture/` 是已确认运行资源，配置为 `texture` Asset Bundle；29 张贴图由 `ArtAssetCatalog` 和构建门禁共同校验。
- `assets/spine/runtime/` 是 `dancer` Bundle；使用 2048 JPEG、9,856 个三角面与 33 个 joint。发布构建不重复收录 `assets/spine/import/` 的导入 buffer，也不包含 FBX、FBM、PSD、设计稿或 TypeScript 源码。
- `tools/verify-song-audio.mjs` 锁定三份 MP3 的文件名、字节数、SHA-256、ID3 标题/歌手、MPEG1 Layer III、44.1kHz、stereo、128kbps、帧数、时长及 Cocos `.meta`。每个文件必须小于 32 MiB。
- `tools/verify-builda.sh` 明确只把 `feng-wu-jiu-tian.mp3`、`zhu-zhu-xia.mp3` 与 `are-you-ok.mp3` 放入外置 assets zip；主 zip 对 `.mp3/.ogg/.wav` 保持零容忍。

背景按比例 cover；Logo、按钮、任务面板和选歌面板等比缩放、不拉伸；交互层同时避让安全区与 Builda 右上胶囊。纵向空间不足时优先隐藏次要提示和非关键舞台，保留开始按钮、判定区和触控热区；异常 inset 会钳制到最后一个无重叠位置并显示“安全区受限”。

`SongClock` 每次判定都从 `performance.now()`（不可用时才回退 `Date.now()`）推导歌曲时间，不用每帧 `dt` 累加。组间舞段保持歌曲时钟连续，最终舞段结束后才暂停并停止 BGM；Creator 生命周期事件、`visibilitychange` 和 `pagehide/pageshow` 会共同冻结歌曲时钟、舞者与结算倒计时，回前台从原阶段继续。窗口失焦时还会清空按键去重状态。`setCalibrationOffsetMs()` 提供统一校准偏移入口；正式校准流程、设备档案和存档尚待曲目接入时确定。

## BuildaGame 接入

项目按 HTML5 引擎发布：

```bash
./.builda-agent/builda check
./.builda-agent/builda engine detect
./.builda-agent/builda sdk install
./.builda-agent/builda sdk check
./.builda-agent/builda sdk smoke
```

`engine detect` 应输出 `engine=h5`。本地宿主调试：

```bash
./.builda-agent/builda dev --web build/web-mobile --safearea 44,0,34,0
```

`BuildaAdapter.viewportMetrics()` 按 CSS 视口与 Cocos 可见设计尺寸的比例换算 `safeArea()` 和 `capsuleMenuRect()`。完整宿主存在时，`playBGM / stopBGM / playSFX` 只有在 SDK Result 的 `ok` 为 `true` 时才报告成功，且不会与浏览器后备通道双播；普通浏览器或不完整宿主使用原生 `Audio` 兜底 BGM，保持试听/玩法的循环和音量差异，`playSFX` 仍只走宿主接口。

发布模板在 `build-templates/web-mobile/`，会在 `<head>` 最早加载 `mobile-perf.js` 和 `builda-sdk.js`。正式 zip 只保留根路径 SDK 引用，不包含 SDK JS 本体；本地 `builda dev` 从 `.builda-agent/sdk/web/` 提供 mock。Creator release 构建固定 `mainIsRemote=false`、`sourceMaps=false`、`debug=false`、`md5Cache=false` 与 `webOrientation=landscape`。

`builda.publish.json` 保持 `engine=h5`、分类 `music`、方向 `landscape`，兼容基线为 Chrome 80 / iOS 15。仓库任务只构建和本地验证，不执行授权、上传、创建/更新草稿或公开发布。当前排行榜仅在本地，不调用 `Builda.rank`。

## 已知边界

- BPM/offset 是对每首音频前 120 秒的离线主拍估计。宿主 BGM API 不提供播放位置，长时漂移、解码启动延迟与设备输出延迟无法由运行时反查；当前谱面约 55 秒结束并预留组间空档，但仍需真机试听验收。
- `SongClock.setCalibrationOffsetMs()` 已提供统一校准入口，玩家校准 UI、设备默认值和持久化策略尚未接入。
- 无 Builda 音频接口时的浏览器 `Audio` 后备仍受浏览器用户手势和 autoplay 策略约束；播放拒绝会释放实例并在选曲页显示不可用，不增加与真机宿主语义冲突的“声音解锁”遮罩。
- 音乐已接入关卡，判定 SFX 尚未接入；静音继续由 Builda 平台统一设置管理。
- 排行榜按浏览器/设备隔离，不跨设备或账号同步；清理站点数据会清空记录。
- 真机 Builda App 的宿主音频、真实安全区和生命周期仍需在待发布草稿中最终验收；本仓库不会在本任务中上传或发布。
