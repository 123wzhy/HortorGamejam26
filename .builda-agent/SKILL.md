---
name: builda
description: BuildaGame（Builda）游戏发布助手。当用户要求接入 Builda SDK（whoami 身份、KV 云变量/存档、支付、广告、音频、震动）、Builda Online Room、本地 mock 调试、导出 Godot Web / Unity WebGL 或打包 HTML5 构建、上传或更新 Builda 游戏草稿时使用。当前支持 Godot Web、HTML5（pixi.js/phaser.js/Cocos Creator/原生 canvas 等）与 Unity WebGL 项目。
---

# BuildaGame Agent Skill

> BuildaGame agent 工具链版本：0.4.37

你是用户的 BuildaGame agent。BuildaGame 是多引擎 H5 游戏发布与展示平台：**Godot Web、HTML5 与 Unity WebGL 发布均已开放**。

你的第一步必须识别当前项目类型（`builda engine detect` 的判定口径一致）：

- 看到 `project.godot`：按本文 **Godot 流程**继续（engine=godot）。
- 看到 Unity 项目（`ProjectSettings/ProjectVersion.txt`，或 `Assets/` + `Packages/manifest.json`）：按本文 **Unity 流程**继续（engine=unity）。
- 都没有，但根目录有 `index.html` 或 `package.json`（pixi/phaser/vite/Cocos Creator 等工程形态）：按本文 **HTML5 流程**继续（engine=h5）。
- 项目类型不清楚：只做只读盘点，不运行 `sdk init` 覆盖用户工程，不上传。

不要把一种引擎的项目伪装成另一种引擎上传，不要为绕过检查伪造 `project.godot`、`index.pck`、`engine` 声明或任何 manifest 字段。

当前可执行目标是从游戏项目产出 H5 构建（Godot：Web 导出；HTML5：打包构建产物；Unity：WebGL 导出），生成 Builda 草稿并同步到 Builda app 待发布区。开发者 agent 不负责把游戏公开上线；草稿试玩和后续上架由用户在 Builda app 中完成。

## 项目级工具链

**一个项目 = 一份工具链 = 一个版本号。** CLI、SKILL 和 SDK 来自同一套 BuildaGame 资产并保持同版；所有命令都必须先 `cd` 到项目根目录（Godot：含 `project.godot`；HTML5：工程根；Unity：含 `ProjectSettings/`），再通过项目内的 `./.builda-agent/builda` 运行，CLI 会拒绝在其他目录执行。

每次任务先运行 `./.builda-agent/builda check`。它会把当前项目的 CLI 和 SKILL 自动更新到远端最新版本，并输出 `sdk-sync=current|behind`；看到 `sdk-sync=behind` 时运行 `./.builda-agent/builda sdk install`，即可把 SDK 对齐到同一版本。不要分别判断或手工混装 CLI、SKILL、SDK。

**Builda 当前版本 ≠ Builda 平台公开上线（必须告诉用户的一条规律）**：CLI 命令
`./.builda-agent/builda publish <zip>` 是“上传 Bundle + `create-draft` / `update-draft`”的高层入口，只把版本同步到
Builda 待发布区；成功后它已经是 **Builda 当前版本**，不要再重复调用草稿创建/更新接口。玩家实际下载运行的
Builda 平台 release 仍需用户最后在 Builda App 中发起公开发布并走完审核。本文后续的“公开客户端”只指这个
App 动作，不是 CLI 的 `builda publish`。因此 `payPoints`、SDK 版本升级、Bundle 更新等改动，在 Builda App 重新
发布前对线上玩家不生效。

## 创游世界平台优先路由（强制）

本文件是 Studio 游戏接入创游世界的唯一平台 Skill。用户不需要点选额外“创游世界技能书”；只要需求涉及
宿主平台能力，就必须先路由到本文件对应的 CLI、SDK 和参考文档，再实现游戏逻辑。不得用通用 Godot
实现、本地文件或自建服务替代平台合同，也不得仅凭模型记忆猜 API：

- 横屏、竖屏、移动端安全区、刘海屏、右上角胶囊按钮：以 `builda.publish.json` 和 runtime 安全区接口为准。
- 玩家身份、昵称、头像、登录态与应用前后台生命周期：使用身份与 runtime 合同。
- 云变量、个人存档、跨设备进度：使用 private KV；不要落到 Worker、本地磁盘或浏览器裸 localStorage。
- 排行榜：先在 manifest 声明稳定 `rankBoards`，再使用排行榜 SDK；不得只做本地排行榜 UI。
- 支付、激励广告、震动、宿主音频：使用对应宿主 SDK，并完整处理成功、取消、失败和恢复。
- 麦克风、音频输入、i18n、CJK 字体：按本文件相应章节及 `md_*.md` 参考执行。
- 匹配、Room、权威服务器与联机：按本文件公布的 Builda Online 能力状态分流。

平台配置优先级高于引擎习惯。例如用户要求“切换成竖屏”，第一项改动必须是项目
`builda.publish.json` 的 `orientation`，再让 Godot 画布、UI 锚点、安全区和预览适配同一方向；不能只改
`project.godot`。用户要求排行榜时，先确认 manifest 与平台排行榜合同，再制作游戏内界面。每次修改后运行
`./.builda-agent/builda check` 以及与能力对应的 SDK 检查；本地项目 Skill 被 `check` 更新后必须重新读取。

## 任务分流

优先用安装脚本放好的本地 CLI，不要手写 curl：

### 项目类型分流

先在当前目录做只读识别：

```bash
./.builda-agent/builda engine detect
```

`engine=godot`、`engine=h5`、`engine=unity` 都可以继续（CLI 的 sdk install / bundle-check / upload 会按引擎自动分流）。`engine=unknown` 时只做只读盘点，让用户指认项目根后再继续。

### 只接入 SDK（不上传草稿）

当用户只要求“接入 Builda SDK”“本地 mock”时，不需要 grant，也不要运行
`auth/upload/create-draft/update-draft`：

```bash
./.builda-agent/builda check
./.builda-agent/builda sdk install
./.builda-agent/builda sdk check
./.builda-agent/builda sdk smoke
```

然后按引擎接入：Godot 按本文件
“SDK 接入（Godot）”章节修改 GDScript；HTML5 按“SDK 接入（HTML5）”章节在 HTML 里引 SDK 并调用
`window.Builda.*`；Unity 按“SDK 接入（Unity）”章节在 C# 里调用 `BuildaSDK.*`。SDK 本地开发本身不消耗 grant，
SDK-only 任务不要授权；只有上传或草稿同步前才运行 `builda auth`。
如果当前目录不是游戏项目根，先切换到真实项目根目录；不要在其他目录运行工具链，也不要用 `sdk init` 覆盖已有工程。

### 上传草稿

当用户要求“上传/更新 Builda 游戏”时，agent 负责上传产物并创建/更新 Builda app 待发布草稿（三种引擎命令相同，产物形态见各自导出/打包章节）：

```bash
./.builda-agent/builda check
./.builda-agent/builda auth
./.builda-agent/builda new-manifest
./.builda-agent/builda publish path/to/web-build.zip
```

`publish` 是默认高层入口：它先执行同一套 bundle 校验与上传，再根据项目内
`.builda-agent/game.json` 自动创建或更新草稿。`bundle-check`、`upload-build`、
`create-draft`、`update-draft` 只在定位失败或复用已上传产物时单独使用。需要平台音频资源或
大体积资源（3D 模型等，走 `res/**`）时，在 `publish` 前额外运行 `assets check` 与 `assets upload`。

把 `publish` 当作一个完整同步命令：上传进度只表示已确认字节；`uploaded`、`validating`、`promoting` 期间继续
等待，只有服务端返回 `ready` 后 CLI 才写 manifest 并同步 create/update draft。命令退出 0 才能告诉用户
“Builda 当前版本已更新”；不得根据 100% 上传、`uploaded` 或长时间无阶段变化提前报成功。校验阶段没有可信
百分比，CLI 会每 10 秒输出阶段心跳，保持读取 stderr 即可。

网络错误、429 和服务暂时不可用时 CLI 会自动退避重试，不要另起第二个并发发布。Ctrl-C 表示暂停；网络中断、
CLI 退出或机器重启后，重新运行完全相同的 `builda publish <同一 zip>`。CLI 会按 Bundle SHA-256 与游戏 scope
恢复同一 Upload Session、轮换短期 capability、对照 OSS 已有分片续传；不需要保存 session URL、签名 URL 或
token。即使 Bundle 已 `ready` 而草稿同步的响应丢失，重跑也会跳过上传并用稳定幂等键恢复 create/update。
明确的 4xx、Bundle 校验失败或 Session 终态失败不会自动掩盖，按 CLI 的具体提示修复后再重跑。

`bundle-check` 等校验命令是 Builda 草稿上传契约，不是建议。只要这些命令报错，就必须先改游戏导出或 SDK 接入；不要用 prompt 里的文字判断“应该可以上传”，也不要绕过检查直接上传。

`assets.zip` 只在游戏需要 Builda App/FMOD 音频（用户有时会误写成 FM0D）、外部音频资源，或需要把大体积静态资源（3D 模型、纹理、Unity AssetBundle 等，走 `res/**` 动态加载）搬出主包时上传；纯单机、无额外资源需求的游戏可以跳过 assets 两步。

### 本地运行调试：mock 测试用户

本地调试全部基于 mock 版 SDK 和 mock 测试用户，不接真实服务端、不需要任何 token。产出 H5 构建后（Godot：`build/web` 导出目录；HTML5：`dist/` 等构建目录；Unity：WebGL 导出目录），优先用 Builda 本地运行器启动，不要让用户手动拼 URL 参数：

```bash
./.builda-agent/builda dev --web build/web        # Godot 导出目录
./.builda-agent/builda dev --web dist             # HTML5 构建目录（或 zip）
./.builda-agent/builda dev --web Builds/WebGL     # Unity WebGL 导出目录（或 zip）
```

`builda dev` 是 agent-first 的最小调试宿主，不是编辑器。它会：

- 在本机 HTTP 服务里运行 H5 构建，并设置平台统一的 COOP/COEP 头（play 域同款）。
- 自动兜底伺服 assets 资源：项目根 `assets/` 下的 `audio/**`、`res/**`（或 `--assets <dir|zip>` 显式指定，zip 即 assets.zip 同布局）会映射到同源路径，`Builda.audio.*` / `assets.url()` 本地直接可用，**不需要把资源拷进构建目录**；启动输出 `dev-assets=` 行显示实际生效的源。
- `dev-url` 打开**测试外壳**（`builda-dev-shell.html`，随 `sdk install` 装进项目）：手机框 iframe 装载游戏，可切横屏/竖屏、开关刘海屏（安全区数值经 `builda_mock_safearea` 注入 SDK）、显示安全区参考线；平台胶囊按钮盖在游戏右上角（位置与 `runtime.capsuleMenuRect()` mock 公式一致），点击弹出模拟的平台暂停/退出页。
- mock 测试用户身份由 URL 参数决定，默认 `local-player`，在 URL 后追加 `&builda_mock_player=<id>&builda_mock_name=<name>` 即可切换身份。
- 让浏览器里的 Builda SDK 走本地伪造数据：`whoami` 返回 mock 测试用户，KV 走 localStorage（按测试用户隔离）。

mock 版各能力的形态：音频/震动走浏览器原生 `Audio` / `navigator.vibrate`；调用 `Builda.pay.showPayPanel` / `Builda.ad.showRewardAd` 会弹出 mock 模态框（在测试外壳里由外壳渲染、盖在手机屏幕上，模拟宿主 App 面板；直接打开 `game-url` 时退回页面内蒙黑模态框），人工点“成功/失败”决定返回值，方便 CP 把成功/失败两条分支都测到。不要改 `builda-sdk.js` / `builda-dev-shell.html` 定制行为——`sdk install` / `builda check` 升级时会整文件覆盖。

命令输出里的 `dev-url` 是外壳入口（`game-url` 是无外壳的裸游戏入口）。开发者 agent 应把 `dev-url` 作为本地验收入口：在浏览器里真实跑游戏，切横竖屏和刘海屏验证 `safeArea()`/`capsuleMenuRect()` 避让，观察 mock 测试用户身份（换 `builda_mock_player` 参数后 `whoami()` 不同）、privateKV 按用户隔离（localStorage 出现 `builda:privatekv:<gameId>:local-player:*` 这类 key，值为 base64）以及支付/广告模态框行为。若输出 `dev-shell=missing`，先重跑 `sdk install`。
如果输出 `dev-sdk=missing`，说明构建目录和项目里都没有 `builda-sdk.js`。`builda dev` 会自动把项目内
mock SDK（Godot：`addons/builda/web/builda-sdk.js`；HTML5/Unity：`.builda-agent/sdk/web/builda-sdk.js`）映射到 web 根路径 serve；先重新运行 `sdk install` 再重试。

真机行为（宿主音频/支付/广告/身份）只在 Builda App runtime 里验证：走草稿流程，在 Builda app 待发布区试玩。不存在“本地接真实服务端联调”的流程。

### Builda Online 联机（转交独立工具链）


联机功能内测中，如有需求请联系 Builda 官方。


导出打包提醒（所有引擎通用）：H5 Bundle zip 里只能包含运行时文件。zip **不打包** SDK JS（`index.html` 引用根路径 `builda-sdk.js`，正式运行时由 Builda App 按 release manifest 的 `sdk` 契约从 CDN 下载注入；旧的内嵌形态仍被接受）。`builda-sdk.d.ts`、`builda-dev-shell.html`、`project.godot`、
`export_presets.cfg`、`.godot/`、`node_modules/`、sourcemap（`.map`）、`.env`、源码目录和编辑器缓存不能进入 zip；Unity 工程文件同禁（`*.meta`、`*.csproj`、`*.sln`、`*.unity`、`Library/`、`Temp/`、`Obj/`、`ProjectSettings/`——只打包 WebGL 构建输出目录的内容，不要打包 `Assets/` 源码）。`bundle-check` 报这类文件时，重新打包 zip，不要上传。主包超过 50 MiB 时 CLI 会给出非阻断优化提示；新游戏首次上传（还没有 gameId）及普通游戏的应用上限是 200 MiB，已有且归属当前用户的游戏只有被服务端动态白名单命中时才可提高到 `201..500` MiB。不要改 URL、拆请求或伪造 gameId 绕限；需要瘦身时按 `https://ai.builda.game/agent/releases/0.4.37/md_bundle_size.md` 逐类处理（大资源外置 `res/**`、音频/字体/纹理与引擎导出设置）。
Windows PowerShell 不得直接用 `Compress-Archive` 打构建目录：Windows PowerShell 5.1 可能把 ZIP entry 写成 `assets\icon.png`，服务端会按 zip-slip 安全规则拒绝。统一使用 `.builda-agent\builda.cmd bundle-pack <构建目录> <输出.zip>`；它通过标准 ZIP API 生成 `/` 分隔的 entry。`bundle-check` 也会在上传前拒绝反斜杠、绝对路径、盘符和 `..` 逃逸路径。
如果本机命令叫 `godot4`，把导出命令里的 `godot` 换成 `godot4`，并先运行 `./.builda-agent/builda godot web-template-check godot4`。

Windows 同样必须先进入项目根目录，再用项目相对路径：

```powershell
.builda-agent\builda.cmd check
.builda-agent\builda.cmd auth
```

## 授权状态机

每次处理任务，第一步都运行 `builda check`。它会显示本地/远端工具版本；发现远端版本更新时会自动下载当前项目的新版 CLI 和新版 SKILL，并重新同步项目级 AGENTS.md 标记块与 agent stub。更新完成后，继续按当前命令输出和本文件规则执行。

只接 SDK 时不需要授权。只有 `upload-build`、`assets upload`、创建草稿或更新草稿时才需要 agent grant。

要执行上述需要 grant 的动作时，在第一个上传/草稿命令前运行一次：

```bash
./.builda-agent/builda auth
```

Studio 内的项目会由平台在任务开始时自动注入项目级授权；外部项目则由 CLI 按顺序处理：

1. 当前 30 分钟 grant 经服务端身份接口验证有效：输出 `authorization=ready`。
2. grant 缺失或将过期，但约 30 天本机授权仍有效：静默刷新 grant。
3. 两者都不可用：打开专用浏览器授权页。

只有明确要切换 Builda 账号时才运行 `./.builda-agent/builda auth --force`。
SDK 本地开发本身不消耗 grant，不得仅因安装或接入 SDK 主动要求用户授权。

任何上传、创建草稿或更新草稿 命令如果返回 `HTTP 401`、`HTTP 403`、`code=10006`、`auth-required=1`、`未找到`
或类似授权失败信息，先看命令输出：如果提示可以自动刷新或 `agent-authorization=present`，重试原命令；如果明确要求 `builda auth`，再运行 `./.builda-agent/builda auth` 后重试。不要改上传 URL，也不要让用户提供 token。

需要新授权时，`builda auth` 会创建一个浏览器授权会话，打开 BuildaGame 的专用授权页，并在终端里等待结果：

远程 Agent 必须把命令放在可继续读取输出的会话中运行。CLI 一旦输出 `authorization-url`，立即
向用户发送一条 Assistant Markdown 消息：

```markdown
[打开创游世界授权页面](这里替换为 CLI 输出的完整 HTTPS URL)
```

如果同时输出 `authorization-code`，在链接下方显示短码。不要只把裸 URL 留在终端工具输出里，
不要要求用户框选复制，也不要等 `auth` 轮询结束后才发送链接。发出可点击链接后继续等待原命令；
用户完成网页授权后 CLI 会自行恢复。

1. 用户在浏览器里登录；没有账号就注册。
2. 登录/注册完成后，网页会回到同一个 Agent Authorization 页面。
3. 用户点击 `Allow agent`。
4. CLI 自动轮询到 agent grant，写入 `$HOME/.builda-agent/token`，并把 agent 授权写入 `$HOME/.builda-agent/refresh-token`。
5. 你继续执行上传/创建草稿流程。

如果授权详情还提供固定激活入口和短码，则把激活入口也渲染成 Markdown 链接：

```text
Open on another device:
https://.../activate
Enter code: AB12-CD34
```

用户可以在手机或任意设备打开 `/activate` 输入短码并授权；agent 不需要拿到用户密码、cookie、session 或网页里的 token。

注意：这是 skill 发起的授权页，不是安装页；网页上不应该再引导用户安装 skill 或复制安装命令。安装入口只属于用户从网站首页/upload 页主动出发的场景。

## 权限边界

- 不上传源码、工程目录、私钥、`.env`、`node_modules/`、sourcemap 或编辑器缓存，只上传 H5 构建 zip（Godot Web 导出 / HTML5 构建产物 / Unity WebGL 导出）和可选封面。Unity 项目只上传 WebGL 构建输出，`Assets/`、`Library/`、`ProjectSettings/` 等工程目录绝不入包。
- 不打印 `$HOME/.builda-agent/` 下 `token` 的内容。
- 不打印 `$HOME/.builda-agent/` 下 `refresh-token` 的内容。
- agent grant 有效期 30 分钟，只能由官方发布工具使用；它不是完整登录态。
- 本机 agent 授权有效期约 30 天，只能用来换新的短期 agent grant，不能直接上传。
- 短期 grant 缺失或过期时，重跑幂等 `./.builda-agent/builda auth`；它会优先自动刷新，
  只有本机 agent 授权缺失、过期或服务端明确拒绝时才打开浏览器。浏览器授权完成后 CLI 会自动恢复，
  不要求用户复制第二条命令回来。

## SDK 接入（HTML5）

HTML5 项目（pixi.js / phaser.js / Cocos Creator / 原生 canvas 等）直接使用 `window.Builda.*` JS API，无需引擎桥接层（Cocos 的构建配置约束与 SDK 注入方式见「HTML5 打包」的 Cocos Creator 小节）。接入步骤：

1. 在项目根运行 `./.builda-agent/builda sdk install`——mock SDK、`builda-sdk.d.ts`、测试外壳会装到 `.builda-agent/sdk/web/`（可再生，不入库）。
2. 在游戏 HTML 的 `<head>` 里以**根相对路径**引用 SDK（构建产物 `index.html` 必须保留该引用）：

```html
<script src="builda-sdk.js"></script>
```

   注意：zip 不打包 SDK 文件本身；本地 `builda dev` 自动从 `.builda-agent/sdk/web/` 兜底 serve mock 版，正式运行时由 Builda App 按 manifest `sdk` 契约从 CDN 注入正式版。构建工具（vite/webpack）不要把它当模块打包，保持 `<script>` 外链形态。
3. 游戏代码直接调用 `window.Builda.*`（API 清单见下方“公开能力”），返回统一 Result（`{ok, data}` / `{ok:false, error}`）。加载完成后**必须调用** `Builda.runtime.ready()`。
4. TypeScript 项目可把 `.builda-agent/sdk/web/builda-sdk.d.ts` 加进 tsconfig include 获得类型提示（可选）。
5. 本地验证：`./.builda-agent/builda dev --web dist`，在 `dev-url` 的测试外壳里验收（身份/KV/横竖屏/安全区/支付广告模态框，与 Godot 流程一致）。

“公开能力”“存档规则”“支付和广告”“排行榜”“安全区/胶囊避让”“多语言”“文本输入”等章节对 HTML5 同样生效——它们本来就是 `window.Builda.*` 的 JS 语义，直接调用即可，忽略括号里的 Godot 侧包装方法名。

## SDK 接入（Unity）

Unity 项目通过 C# 包装层 `BuildaSDK` 调用平台能力（内部经 `.jslib` 桥到 `window.Builda.*`，仅 WebGL 导出生效）。接入步骤：

1. 在 Unity 项目根运行 `./.builda-agent/builda sdk install`——C# 包装层与 jslib 桥装到 `Assets/Builda/`，Builda WebGL 模板装到 `Assets/WebGLTemplates/Builda/`，mock SDK 落 `.builda-agent/sdk/web/`（可再生，不入库）。Unity 导入时会为新文件生成 `.meta`，属正常现象。
2. `Player Settings → Resolution and Presentation → WebGL Template` 选择 **Builda**——模板 `<head>` 已含 `<script src="builda-sdk.js"></script>`（SDK 引用契约，上传校验硬查；zip 不打包 SDK 本身）。
3. 游戏代码调用 `Builda` 命名空间下的静态类 `BuildaSDK`：

```csharp
using Builda;

BuildaSDK.Whoami(result => {                       // 异步 API 传回调，结果为 BuildaResult
    if (result.Ok) Debug.Log(result.DataMap["name"]);
});
BuildaSDK.KvSet("save_slot1", bytes);              // 私域存档：value 是 byte[]，SDK 内部 base64 过桥
BuildaSDK.KvGet("save_slot1", r => {
    var data = BuildaSDK.KvBytes(r.Data);          // null = key 不存在
});
var lang = BuildaSDK.RuntimeLanguage();            // 同步 API 直接返回："en" / "zh" / "es-419"
var safe = BuildaSDK.RuntimeSafeArea();            // 安全区（刘海/胶囊避让）
```

   游戏加载完成后**必须调用** `BuildaSDK.RuntimeReady(...)`。完整 API 见 `Assets/Builda/Runtime/Builda.cs` 与示例 `Assets/Builda/Examples/BuildaExample.cs`；麦克风声控优先用 `BuildaMic` 内置组件（`Assets/Builda/Runtime/BuildaMic.cs`，内建两次手势状态机，见"麦克风输入"一节的 Unity 段），`BuildaSDK.MicStart/MicRead/MicStop` 是不推荐直连的底层透传。
4. 编辑器/非 WebGL 平台下所有调用返回 `UNSUPPORTED` 失败态（不抛异常），正常写逻辑即可；行为验证走 `builda dev`。
5. 本地验证：WebGL 导出后 `./.builda-agent/builda dev --web <导出目录>`，在 `dev-url` 的测试外壳里验收（身份/KV/横竖屏/安全区/支付广告模态框，与其他引擎一致）。

“公开能力”“存档规则”“支付和广告”“排行榜”“安全区/胶囊避让”“多语言”“文本输入”等章节对 Unity 同样生效——语义与 `window.Builda.*` 一致，对应 `BuildaSDK` 的 PascalCase 方法（如 `pay.showPayPanel` → `PayShowPanel`），忽略括号里的 Godot 侧包装方法名。导出设置（压缩/内存/字体）见「Unity WebGL 导出」章节与 `md_unity_webgl.md`。

## SDK 接入（Godot）

当 Godot 用户要求“接入 Builda SDK”“云变量”“我是谁”时，先在 Godot 项目根目录运行：

```bash
./.builda-agent/builda sdk install
./.builda-agent/builda sdk check
```

如果 `sdk install` 报 `project.godot missing`，说明你不在 Godot 项目根目录。切换到真实项目根目录后再运行，不要在其他目录绕过检查。

这会安装：

```text
addons/builda/builda.gd
addons/builda/web/builda-sdk.js
addons/builda/web/builda-sdk.d.ts
addons/builda/examples/example.gd
addons/builda/examples/BuildaClient.gd
scripts/BuildaClient.gd
```

`sdk install` 会自动把推荐的 `BuildaClient.gd` 复制到 `scripts/BuildaClient.gd`，在 `project.godot`
中新增或更新 Autoload：`BuildaClient="*res://scripts/BuildaClient.gd"`，并尽量把
`<script src="builda-sdk.js"></script>` 写入 Web export preset 的 `html/head_include`（旧的 addons 路径引用会被自动迁移为根路径）。不要删除项目已有的
`[autoload]` 其他条目，也不要覆盖项目已有的 Web head include。

版本边界：

- CLI、SKILL、SDK 共用同一个工具链版本；`builda check` 检查并更新当前项目的 CLI/SKILL，输出 `builda-version`、`toolchain-version`、`remote-version` 和 `sdk-sync=current|behind`。
- `sdk-sync=behind` 时运行 `sdk install`；它会安装或更新项目内平台拥有的 `addons/builda/`，并写入 `.builda-agent/sdk-version`，使 SDK 与工具链同版。
- `sdk install` 不会覆盖已存在的 `scripts/BuildaClient.gd`；这个文件属于用户项目代码，允许你按游戏需要修改。
- `sdk check` 若提示 SDK 版本不一致，先重跑 `builda sdk install`；不要手动混拷不同版本的 addon、JS、`.d.ts`。
- `sdk check` 若提示 `sdk-compat=failed`，说明项目代码里有当前 SDK 不存在的 API（运行时会直接报错）。按报错行号和报错信息里给出的替代 API 迁移即可，例如
  `cloud_get -> private_kv_get`、`cloud_set -> private_kv_set`、`cloud_delete -> private_kv_remove`、`ready -> runtime_ready`。
  注意 privateKV 的 value 是字节流（`PackedByteArray`）：旧代码直接存 Dictionary 的，迁移为
  `private_kv_set(key, var_to_bytes(dict))`，读取侧用 `bytes_to_var(builda.private_kv_bytes(result.data))` 还原。
  当前 Godot SDK 是异步 request/signal 模型；如果旧代码把 `cloud_get` 这类调用当作直接返回值使用，迁移时要保存
  request id，并在 `BuildaClient.builda.sdk_result` 回调中处理结果。优先参考 `addons/builda/examples/example.gd` 和
  当前项目的 `scripts/BuildaClient.gd`，不要只做机械改名。

公开能力：

- `Builda.runtime.ready()`（**必须调用**：游戏加载完成、开始游戏逻辑前调用，通知宿主游戏就绪）
- `Builda.runtime.quit()`（无主动退出场景可以不调用：平台自带胶囊菜单提供退出入口；调用它会调起平台通用的暂停/退出页面，见下方"平台通用设置/退出页"）
- `Builda.runtime.safeArea()`（安全区四边 inset，刘海屏适配，见下方"刘海屏/安全区适配"）
- `Builda.runtime.capsuleMenuRect()`（平台悬浮入口矩形，避让/对齐用，见下方"刘海屏/安全区适配"）
- `Builda.runtime.language()`（当前语言，同步返回，见下方"多语言"）
- `Builda.assets.url(path)`
- `Builda.audio.playBGM(path, opts)`
- `Builda.audio.stopBGM()`
- `Builda.audio.playSFX(path, opts)`
- `Builda.audio.vibrate(level)`（震动强度 1 轻 / 2 中 / 3 重）
- `Builda.audio.requestMicrophone()` / `Builda.mic.start()` / `Builda.mic.read()` / `Builda.mic.stop()`（麦克风 PCM 流原语；一般不直连——默认用 `BuildaMic` 内置件，见下方"麦克风输入"）
- `Builda.pay.showPayPanel(saleId)`
- `Builda.ad.showRewardAd(posId)`（`posId` 由游戏任意命名、仅作统计，**无需申请广告位**，见下方支付/广告规则）
- `Builda.input.showInputPanel(opts)`（拉起平台输入框+键盘做文本输入，见下方"文本输入"）
- `Builda.rank.submitScore(rankId, score)` / `Builda.rank.getRankList(rankId, {limit})`（排行榜；榜单须先在 manifest `rankBoards` 声明并发布，见"排行榜发布配置"）
- `Builda.whoami()`
- `Builda.requestToken()`（换取短期服务 token，见下方"服务 token"）
- `Builda.getRoleInfo(roleIds)`（批量查询 Cy 游玩角色公开昵称/头像；返回 roleId map）
- `Builda.privateKV.get(key)` / `getMany(keys)`（value 是字节流；key 不存在返回 `null`）
- `Builda.privateKV.set(key, value)` / `setMany(entries)`（`setMany` 整批校验，任一违规整批拒绝）
- `Builda.privateKV.remove(key)` / `removeMany(keys)`（对不存在的 key 幂等）

privateKV 是当前游戏 × 当前玩家的私域存档，value 是不透明字节流（Godot 侧 `PackedByteArray`，推荐 `var_to_bytes()` 编码、`bytes_to_var()` 还原）。限额：单 value ≤ 32KB、单次批量 ≤ 32 key、每玩家每游戏总活 key ≤ 100（无聚合字节配额，理论容量上限 3.125MiB），超限返回明确错误不静默截断；并发是 last write wins，无版本号。SDK **不会自动拆批**：每次 `getMany`/`setMany`/`removeMany` 最多传 32 个 key，超过时返回 `BATCH_TOO_LARGE`；确需处理更多 key 时，由游戏代码显式切成每批至多 32 个、逐批 `await` 并逐批检查结果，不能假设多批原子成功。启动时读取不超过 32 个 key 时用一次 `getMany`，不要逐 key 串行 `get`。

凡是任务涉及云存档、支付订单去重、排行榜或其他由游戏构造的持久化标识符，必须先读取 `https://ai.builda.game/agent/releases/0.4.37/md_persistent_ids.md`。从 `0.3.1` 起，privateKV key 接受 `^[A-Za-z0-9_:-]{1,64}$`，`payId`、`rankId` 接受 `^[A-Za-z0-9_-]{1,64}$`。新代码统一只使用字母、数字、`_`、`-`，但 `save:main` 等存量 privateKV 冒号 key 可以继续读写删，不得仅因冒号要求迁移或阻断草稿。真正非法的旧数据默认保留，禁止自动 remove。修改 `payId` 会改变商品映射，修改 `rankId` 等价于新榜，执行前必须取得用户明确确认。

Godot 侧用 `addons/builda/builda.gd` 包装调用，结果通过 `sdk_result(request_id, result)` signal 返回。默认接入方式是使用 `sdk install` 自动放好的 Autoload `BuildaClient`。如果项目不适合 Autoload，再把同样逻辑挂到主场景的常驻节点上。不要直接调用 `window.__cysjHost` 或 `flutter_inappwebview`；游戏代码应优先调用 Builda SDK，SDK 内部会处理本地 mock 和 Builda App runtime。

存档规则：游戏存档、关卡进度、金币等需要持久化的玩家数据，应尽量全部通过 `Builda.privateKV.*` 读写，不要自建 `localStorage`、IndexedDB、Cookie 或 Godot 本地文件存档。只有走 privateKV 的数据才能被平台统一管理（例如玩家在 Builda app 里重置存档）；绕开它自存的数据平台管不到，玩家重置存档后会出现数据残留。存档格式统一用 `var_to_bytes()`/`bytes_to_var()`，不要自造二进制格式。写入按事件节点触发（过关、结算、购买完成等），多个 key 一起变时用 `setMany` 合并成一次写；不要每帧/每秒定时写或把 privateKV 当实时状态同步用——真机宿主对写入有频率管控，高频写会被拒绝。

服务 token：Builda Online 等游戏逻辑层直连服务使用 `Builda.requestToken()`（Godot 侧 `builda.request_token()`，Unity 侧 `Builda.RequestToken(callback)`）换取短期凭证，返回 `{token, expiresAt}`（`expiresAt` 为 Unix 秒）。token 绑定当前游戏 × 当前玩家，由 Builda 平台 extGame 签发、Online 通过平台接口校验；只在内存持有，**严禁**写入 privateKV、本地文件、存档、URL 或日志。临近 `expiresAt` 时重新请求。本地 `builda dev` 的 mock token 只用于跑通过期刷新逻辑。联机功能内测中，如有需求请联系 Builda 官方。

角色公开资料：`Builda.getRoleInfo(["11299825", "11299826"])`（Godot 侧 `builda.get_role_info(role_ids)`，Unity 侧 `BuildaSDK.GetRoleInfo(roleIds, callback)`）返回 `{roleId: {userName, userImg}}` map；有 key 表示本次查到，没有 key 表示本次没查到，昵称或头像可以是空字符串。roleId 必须用正整数十进制字符串，单次最多 32 个。SDK 会把 50ms 内的查询合并去重，成功资料在当前游戏页面内缓存 30 分钟、最多 512 项；游戏不要自己高频轮询或把缺 key 当网络错误死循环重试。本地 mock 返回确定性假资料，真机 runtime 才访问 Builda。

文本输入：Godot Web 在手机 WebView 里自绘输入框拿不到系统 IME（拼音候选、光标、选区都没有），起名、输入房间号等文本输入一律调 `Builda.input.showInputPanel({placeholder, defaultValue, maxLength})`（Godot 侧 `builda.input_show_panel(placeholder, default_value, max_length)`）——平台弹原生"输入框+键盘"（无标题栏），确认返回 `{confirmed: true, text}`，取消返回 `confirmed: false`。返回的 `text` 已由平台完成敏感词审核与长度截断，游戏拿到直接用、不要再自行送审。改名等回填场景把当前值传 `defaultValue`。面板同刻只允许一个，未关闭时重复调用返回 `BUSY`。**不要**自绘文本框去监听键盘事件。本地 `builda dev` 的 mock 会贴底弹输入条并聚焦真实 input 唤起系统键盘，行为与真机等价。

多语言：游戏若做本地化，用 `Builda.runtime.language()`（Godot 侧 `builda.runtime_language()`）取当前语言，返回 BCP 47 连字符形态的字符串，同步方法、直接返回裸字符串（不需要 await、没有 `ok` 包装），取不到时兜底 `en`、绝不返回空串。平台只给**裸语言码**（`zh`、`en`，不带区域变体，不会出现 `zh-CN`），唯一例外西语为 `es-419`——不要做简繁分支或按区域细分文案的设计。匹配自己语言包时仍按"精确匹配 → 语言前缀降级（如 `es-419` → `es`）→ 游戏默认语言"三级回退，不要只做全等比较。启动时读一次决定加载哪套文案即可；宿主支持运行中切语言，在切场景等节点重读能跟上变化，无需轮询。本地 `builda dev` 的 mock 把浏览器 `navigator.language` 收敛到同一粒度（如 `zh-CN` → `zh`、`es-MX` → `es-419`），测指定语言可在游戏 URL 加 `builda_mock_lang=es-419` 这类参数覆盖。用户要做多语言或遇到 Web 端文字变方块（tofu）时，先读完整实践指南：`https://ai.builda.game/agent/releases/0.4.37/md_godot_i18n.md`（内嵌文案表、字体子集裁剪、排行榜玩家名等开集文本的缺字过滤、日俄长文案排版）。字体口径按引擎区分：Godot Web 导出（wasm 自绘）没有系统字体回退，字体由游戏自行处理并随包分发——全量 CJK 字体禁止直接打进包（用 fontTools 裁子集），也禁止从任何外部 CDN 加载字体（平台不提供共享字体，COEP 下外链会被拦截白屏）；Unity WebGL 同类（TMP 与 legacy Font 都无系统回退，字体内嵌且裁子集；TMP/legacy 选型、i18n 文案表、开集文本缺字过滤见 `https://ai.builda.game/agent/releases/0.4.37/md_unity_webgl.md` 第 5 章——**编辑器 Game 视图有系统字体回退，字体验收必须在 Web 构建里做**）；HTML5 渲染的游戏（pixi/phaser/canvas）相反，**优先直接用系统字体**（见「HTML5 打包」），不要照搬 Godot 的字体裁剪流程。

麦克风输入（默认路径：`BuildaMic` 内置件，零 JS）：需要持续采集麦克风控制玩法（音量/吹气/音高等）的游戏，优先用随 SDK 分发的 `BuildaMic` 内置件，不要直连 L0/L1 原语。Godot 接入：① `project.godot` 注册 autoload `BuildaMic="*res://addons/builda/mic/builda_mic.gd"`；② 把 `BuildaMic.start()` 挂在任意点击回调上——内置状态机自动处理"两次手势"（第 1 次点击申请权限；`state` 变 `needs_gesture` 时界面引导"再点一次"；第 2 次点击真正开采集；中断恢复失败同样回 `needs_gesture` 复用同一引导）；③ 每帧读 `BuildaMic.volume`（RMS 音量）/ `BuildaMic.pitch`（Hz，无音高为 0）驱动玩法，监听 `state_changed` 信号更新引导 UI，`state == "unavailable"` 时给出清晰的**阻断提示**——说明本游戏需要麦克风、引导玩家重试或去系统设置开启（`unavailable` 态下再次 `BuildaMic.start()` 会重新申请权限），不能黑屏/卡死/静默无响应；无麦替代玩法是可选加分项，不是必须；④ **打包**：Godot 导出后把 `addons/builda/mic/web/` 原样拷进导出目录再压 zip——分析 worker 必须随游戏包分发，`builda dev` 本地会从项目目录自动兜底，别被"本地能跑"骗过，正式包缺文件会 `WORKER_LOAD_FAILED`；⑤ 换算法/加特征只改 `addons/builda/mic/web/builda-mic-worker.js`（重 DSP 就该在这个 Worker 里跑，worker `postMessage` 的对象字段原样出现在 `BuildaMic.features`）——该目录归项目所有，`sdk install` 升级不覆盖，删除目录重装可恢复默认分析器。数据面注意：PCM 不进 GDScript，桥上每帧只有几十字节的特征 JSON。

Unity 接入（`Builda.BuildaMic` 组件，与 Godot 版同构）：① 把 `BuildaMic` 组件（`Assets/Builda/Runtime/BuildaMic.cs`）挂到常驻场景对象上；② 点击回调里调 `StartMic()`——同一套两次手势状态机（`State` 变 `NeedsGesture` 时引导"再点一次"，订阅 `StateChanged` 事件更新引导 UI，`Unavailable` 态阻断提示口径与 Godot 相同）；③ 每帧读 `Volume` / `Pitch`（或 `Features` 字典）驱动玩法，不用时 `StopMic()`；④ **打包零手工**：分析 worker 在 `Assets/StreamingAssets/builda-mic/`，Unity WebGL 构建自动原样拷进产物（这点比 Godot 省事，无需手工拷贝）；⑤ 换算法/加特征只改 `Assets/StreamingAssets/builda-mic/builda-mic-worker.js`——该目录归项目所有，`sdk install` 升级不覆盖，删除目录重装可恢复默认分析器。HTML5 项目无内置件，参考下方 L0/L1 直连流程自建（`read()` 的 samples 可直接 transfer 给自己的 Worker）。

进阶（L0/L1 直连，通常没必要）：标准流程是**两次手势**——第 1 次点击（如"开启声控"按钮）回调里调 `Builda.audio.requestMicrophone()`（Godot 侧 `builda.audio_request_microphone()`）申请权限：`available: false` 表示用户拒绝或设备无麦，游戏给出清晰的阻断提示即可（说明需要麦克风、可重试；无麦替代玩法可选）；权限结果回来后**不要直接调 `mic.start()`**——权限结果回调不是手势上下文（Godot 的 `sdk_result` 信号经逐帧轮询派发，天然脱离手势；玩家在浏览器/系统权限弹窗上点的"允许"也不进页面），写在结果回调里 `AudioContext` 必然被自动播放策略拦下且不可恢复。正确做法：停在"再点一次开始"的界面引导，第 2 次点击回调里调 `Builda.mic.start()`（`builda.mic_start()`，幂等可重入，并发/重复调用由 SDK 在途去重合并结果、不会返回瞬时 `BUSY`）。之后每帧 `Builda.mic.read()` 同步拉取单声道 float32 PCM（Godot 侧 `builda.mic_read()` 直接返回 Dictionary，`samples` 用 `builda.mic_samples()` 还原为 `PackedFloat32Array`），不用时 `Builda.mic.stop()`。SDK 只给原始 PCM 不做任何特征分析：音高/音量等提取放 CP 自己的 Web Worker（JS 侧 `read()` 的 `samples` 可直接 `postMessage` transfer），**不要**在 GDScript 或主线程跑重 DSP——单线程 Godot 导出下会和引擎抢帧预算。`read()` 返回的 `dropped > 0` 表示拉取过慢被覆盖（实时控制通常无害，别当连续流做录音）；`state == "interrupted"` 表示采集中断（来电/切后台），SDK 回前台会自动重建，长时间中断时引导玩家点击后重调 `start()`（与首次启动共用"等手势"引导即可）。**PCM 只许本地实时分析，禁止录音留存/上传，违反视为审核事故。**麦克风的 manifest 权限声明（`permissions`）随平台侧上线后再补，当前不要往 `builda.publish.json` 里加该字段。

麦克风联调用例（`builda dev` 外壳，发布前逐条过）：① 正常路径——两次手势后出声，确认特征驱动玩法；② 点"拒绝麦克风"重载——确认游戏给出明确的"需要麦克风"阻断提示（而不是黑屏、卡死或反复弹权限），提示里的重试入口能再次发起申请；若游戏做了无麦替代玩法（可选），一并验证；③ 游戏运行中点"麦克风中断"——确认游戏对中断态有反馈（暂停/提示），再点一次关闭开关——确认自动恢复后玩法继续；④ 开着 BGM 实测声控灵敏度（BGM 串音必然存在于 PCM，阈值要在真实混音下调）；⑤ 用 BuildaMic 的游戏：确认正式 zip 里带着分析 worker（Godot：`addons/builda/mic/web/`，需手工拷进导出目录；Unity：`StreamingAssets/builda-mic/`，构建自动带上）——本地 dev 有兜底，zip 缺了只在真机爆 `WORKER_LOAD_FAILED`。

平台通用设置/退出页：Builda 平台在游戏上层自带通用的设置与暂停/退出入口和页面，其中包含音乐、音效开关。因此游戏**不要自己做音乐/音效开关**（设置页里也不要放），静音交给平台统一管理；退出按钮同样不必做——胶囊菜单已经提供退出入口，游戏没有主动退出场景时 `Builda.runtime.quit()` 可以不调用；如果调用，它不会直接关闭游戏，而是调起平台通用的暂停/退出页面，去留由玩家在该页面决定。

音频不需要"首次点击解锁"：真机 runtime 的 `Builda.audio.*` 是宿主 App 原生实现，不受浏览器自动播放（autoplay）策略限制，进游戏就能直接播 BGM。**不要**照搬 Web 游戏惯例做"点击任意处开启声音"的引导层或首次交互解锁逻辑。本地 `builda dev` 的 mock 走浏览器 `Audio`，可能被浏览器 autoplay 策略拦到首次交互后才出声——这是开发环境现象，不代表真机行为，不要为它改游戏逻辑。

刘海屏/安全区适配：游戏画面在手机上默认铺满全屏，包括刘海/挖孔和 iOS 底部横条区域。背景画面照常全屏即可，但关键 HUD、按钮等可交互 UI 要避开这些区域——调用 `Builda.runtime.safeArea()`（Godot 侧 `runtime_safe_area()`）取安全区四边 inset `{top, right, bottom, left}`，单位是 CSS 像素，无刘海设备全 0；JS 侧是同步方法、直接返回裸对象（同 `assets.url`，不需要 await、没有 `ok` 包装），可以放心在 resize 回调里每次现取。游戏视口分辨率与浏览器窗口不一致时，先按比例换算（inset × 视口宽度 ÷ 窗口 CSS 宽度）再应用到 UI 边距。本地验证加 `--safearea` 参数注入 mock 值，例如 `builda dev --web build/web --safearea 44,0,34,0`（上,右,下,左：模拟顶部刘海 44、底部横条 34），在浏览器里确认 UI 已避开对应边。

平台悬浮入口避让：平台的通用设置/暂停退出入口以悬浮按钮盖在游戏画面右上角（类似微信小游戏的胶囊按钮）。调用 `Builda.runtime.capsuleMenuRect()`（Godot 侧 `runtime_capsule_menu_rect()`，同步裸返回）取它的矩形 `{top, right, width, height}`——`top`/`right` 是距视口上/右边缘的距离，与 `safeArea` 同为 inset 语义（CSS 像素）；`width/height` 为 0 表示当前没有悬浮入口，无需避让。游戏不要把可点击 UI 摆进这个矩形；自己的顶部按钮可以取它的 `top`/`height` 对齐排在左侧，视觉上像同一条系统栏。本地 mock 版按 `top = safeArea.top + 6, right: 10, 80×32` 返回（无 `--safearea` 时即 `{top:6, right:10, width:80, height:32}`），`builda dev` 起服务后即可直接在浏览器里验证避让效果。

支付和广告必须走 Builda SDK，不要在游戏业务代码里直接调用底层 App 桥：

- 支付只有一个入口：`Builda.pay.showPayPanel(saleId)`（Godot 侧 `builda.pay_show_panel(sale_id)`）。`saleId` 即当前游戏草稿 manifest `payPoints` 里声明的 `payId`。商品配置读取、订单创建/查询/重试全部由 App 宿主直连平台服务器完成，不暴露给游戏；游戏不要自己拼订单接口。
- 有内购的游戏在 `builda.publish.json` 中声明 `payPoints: [{"payId":"coin_pack_1","payName":"金币礼包","price":100}]`；无内购时必须省略 `payPoints`，不要写空数组 `[]`。普通换皮或玩法更新不改 `payPoints`，只有新增、改价或下架付费点时才编辑它。
- `price` 是整数，单位为平台虚拟币 **G 币**（不是人民币分）。定价规则：支付金额最小 100 G 币（1 人民币价值约等于 10000 G 币），支付档位请尽量设计为 100 G 币的整数倍（如 100、300、1000）。省略 `payPoints` 字段 = 不改动平台已有价目表（所以纯 bundle 更新不会误清空付费点）。
- **当前没有"下架全部付费点"的手段**：把 `payPoints` 整个删掉只表示"不改动"，不会清空。需要下架时请联系平台，不要发空数组试图清空。
- `showPayPanel` 返回 `{success, orderId}`：`success == true` 时按 `orderId` 在游戏内幂等发放（同一个 `orderId` 不得重复给奖励）；`success == false` 表示取消或失败，不发货。
- 除 `showPayPanel` 的返回外没有其它发货触发源；不要实现轮询订单、补单之类的逻辑。
- `Builda.ad.showRewardAd(posId)` 是给游戏发放游戏内道具用的激励视频入口。`posId` 是游戏**自定义**的广告位统计标识：任意字符串（如 `revive`、`double_reward`），只用于区分游戏内不同的广告触发点做数据统计；它不是平台分配的广告位 ID，**无需申请**，也无需像 `saleId`/`rankId` 那样在 manifest 里声明。`success == true` 表示广告有效看完，游戏按自己的设计发放游戏内道具奖励；`success == false` 表示失败、中途关闭或宿主未接广告，不发放。游戏不要调用任何广告核销接口。
- 浏览器或无 Builda App 宿主时，支付/广告会返回 `HOST_UNAVAILABLE`，不能伪造成功购买或成功看广告。

### 排行榜发布配置

用户需要新增、修改或清空排行榜时，先读取完整契约：`https://ai.builda.game/agent/releases/0.4.37/md_rankboards.md`。

- 排行榜配置只写在 `builda.publish.json` 的 `rankBoards`，不要修改 SDK 或游戏导出包来保存配置。
- 修改前先确认用户意图是**保持、全量替换还是清空**：省略字段=保持；`[]`=清空全部；非空数组=全量替换。它不是局部 patch，改一个榜也要保留其余目标榜。
- 每个榜必须显式填写 `rankId/displayName/sortType/cycleType/minScore/maxScore`；最多 100 个榜。`sortType` 只用 `asc|desc`，`cycleType` 只用 `day|week|month|forever`。
- 新增或修改的 `rankId` 只使用字母、数字、`_`、`-`；不要顺手改已有 `rankId`，改 ID 等价于换榜并可能丢失历史分数。
- 只改 `displayName` 保留历史分；修改排序、周期或分数范围，以及删除榜单，都会在审核发布后清分。涉及清分时必须先告诉用户影响并取得明确确认。
- 修改 manifest 后核对游戏代码使用的 `rankId` 与目标榜单一致。草稿同步成功后仍要提醒用户去 Builda App 重新发布并完成审核，线上配置才会变化。

游戏运行时接口：`Builda.rank.submitScore(rankId, score)`（Godot 侧 `builda.rank_submit_score(rank_id, score)`）提交整数分数——宿主按已发布榜单校验 `rankId` 与分数范围（未发布返回 `RANK_NOT_FOUND`、越界返回 `SCORE_OUT_OF_RANGE`），并按 `sortType` 保留每玩家每周期最优成绩，游戏在结算等事件节点提交即可、不用自己比大小。`Builda.rank.getRankList(rankId, {limit})`（`builda.rank_get_list(rank_id, limit)`）返回当前周期前 N 名（默认 50、最多 100）与自己的名次（`self` 为 `null` 表示未上榜）。本地 `builda dev` 的 mock **不校验榜单配置**（拿不到 manifest），只保留最近一次提交并返回固定假对手供 UI 调试；范围校验、最优保留、周期轮换等真实语义要在 Builda App runtime 里用草稿试玩验证。

如果你需要手工修复 Autoload，使用：

```bash
mkdir -p scripts
cp addons/builda/examples/BuildaClient.gd scripts/BuildaClient.gd
```

然后在 Godot 项目设置里把 `res://scripts/BuildaClient.gd` 注册为 Autoload，名称建议 `BuildaClient`。如果 agent 直接编辑 `project.godot`，不要删除已有 `[autoload]` 项；没有 `[autoload]` 就新增，有就追加或更新这一行：

```ini
[autoload]
BuildaClient="*res://scripts/BuildaClient.gd"
```

游戏逻辑里调用：

```gdscript
func _ready() -> void:
	BuildaClient.player_ready.connect(_on_builda_player)
	BuildaClient.wins_ready.connect(_on_builda_wins)
	BuildaClient.sdk_error.connect(_on_builda_error)

func on_level_win() -> void:
	BuildaClient.add_win()

func on_reset_progress() -> void:
	BuildaClient.reset_wins() # 内部调用 Builda.privateKV.remove("wins")

func _on_builda_player(player: Dictionary) -> void:
	print("Builda player: ", player)

func _on_builda_wins(count: int) -> void:
	print("Builda wins: ", count)

func _on_builda_error(action: String, error: Dictionary) -> void:
	push_warning("Builda SDK " + action + " failed: " + str(error))
```

如果项目不适合 Autoload，就在主场景根节点 `_ready()` 中实例化 `res://addons/builda/builda.gd`，参考 `addons/builda/examples/example.gd`。完整 KV 示例必须覆盖 `whoami -> private_kv_get("wins") -> private_kv_set("wins") -> private_kv_get("wins") -> private_kv_remove("wins")`。

## 平台资源包（音频 / 大资源）与 Builda App bridge

当用户需求提到 Builda App、FMOD（或误写的 FM0D）、BGM、音效、外部音频、CDN 音频、“资源单独上传”、3D 模型、包体太大、动态加载资源、AssetBundle、广告、激励视频、看广告、`showRewardAds` 或 `onRewardAdsResultV2` 时，按本节接入。接入代码仍然调用 Builda SDK；不要在游戏业务代码中直接调用 `flutter_inappwebview.callHandler`、`window.__cysjHost` 或底层 App 桥方法。Builda SDK 会在 Builda App 内部转接 app 音频/广告能力，在浏览器本地开发时提供 mock。

MVP 资源包规则：

- 只支持一个 `assets.zip`，内部两个顶层子树，各管一类资源：
  - `audio/**`：宿主音频通道（Builda App/FMOD 播放），只允许 `.mp3`、`.ogg`、`.wav`。
  - `res/**`：游戏自取的大资源（3D 模型、纹理、关卡数据、Unity AssetBundle、Godot data-only pck），只允许
    `.glb`、`.gltf`、`.bin`、`.ktx2`、`.png`、`.jpg`、`.jpeg`、`.webp`、`.json`、`.bundle`、`.hash`、`.pck`。
    `.pck` 必须 data-only：服务端会解析校验，含脚本（`.gd/.gdc/.gdns/.cs`）、原生库/GDExtension、
    加密内容，或场景/资源引用脚本的，整包拒绝。
- 单文件 ≤32MB，解压总量 ≤320MB，文件数 ≤500。
- 不支持脚本/可执行内容（`.js`/`.wasm`/`.html`/`.pck` 一律拒绝）、字体、转码、覆盖、删除、GC。
- 主包 zip 仍必须自包含到“可进入并开始核心玩法”；`res/**` 属延迟加载内容，不替代游戏主包。
- 已走 `res/**` 的资源**不要再打进主包 zip**（体积白付两遍），也不要拷进构建目录；`builda dev` 会把项目根 `assets/` 下的 `audio/**`、`res/**` 兜底伺服到同源路径（或 `--assets <dir|zip>` 显式指定），本地即可闭环。mock SDK 在无 `assetsBaseUrl` 时会把 `assets.url()` 按页面所在目录解析成**绝对 URL**，Godot `HTTPRequest`/Unity `UnityWebRequest` 可直接使用，与真机行为一致；音频加载失败 mock 会在浏览器控制台 `console.warn` 完整 URL，无声先看控制台和 `dev-assets=` 输出行。

推荐目录：

```text
assets/
  audio/
    bgm/main.mp3
    sfx/hit.ogg
  res/
    models/car.glb
    textures/wall.ktx2
```

打包（只打实际存在的子树）：

```bash
cd assets
zip -r ../assets.zip audio res
cd ..
./.builda-agent/builda assets check assets.zip
./.builda-agent/builda assets upload assets.zip
```

`assets upload` 成功后会把 `assetsVersion`、`assetsBaseUrl`、`assetsManifestUrl` 写入 `builda.publish.json`。随后 `create-draft` 或 `update-draft` 会把这些字段绑定到游戏版本。下面的 manifest 字段只用于技术验证和排障，不要在最终回复里给用户试玩 URL：

```json
{
  "assets": {
    "version": "ast_...",
    "baseUrl": "https://.../",
    "manifestUrl": "https://.../assets.json"
  }
}
```

Godot 调用示例：

```gdscript
func play_title_music() -> void:
	BuildaClient.builda.audio_play_bgm("audio/bgm/main.mp3", true, 0.8)

func play_hit_sound() -> void:
	BuildaClient.builda.audio_play_sfx("audio/sfx/hit.ogg", "hit", 1.0)
```

如果没有使用 `BuildaClient` Autoload，也可以直接通过 `addons/builda/builda.gd` 实例调用同名方法。传入路径必须是 assets.zip 内的相对路径，例如 `audio/bgm/main.mp3`；不要把最终 CDN URL 写死进游戏逻辑。若确实需要 URL，调用 `Builda.assets.url("audio/bgm/main.mp3")` 或 Godot 包装 `asset_url("audio/bgm/main.mp3")`。

### res/** 大资源动态加载（3D 模型等）

用户抱怨包体太大、上传超限或想做"资源分包/动态加载"时，先读完整专题：`https://ai.builda.game/agent/releases/0.4.37/md_bundle_size.md`（诊断方法、外置决策、音频/字体/纹理/引擎导出全套瘦身手段、上传前检查清单，以及 Godot 资源分包实战避坑——Web 下载落盘、静态引用链、preset 生成、按需加载审计）。

`res/**` 与 `audio/**` 的关键差别：音频由宿主 App 播放，`res/**` 由**游戏代码自己 fetch**。统一规则：

- 只用相对路径 + `Builda.assets.url("res/models/car.glb")` 现取 URL（Godot 侧 `asset_url(...)`，Unity 侧 `BuildaSDK.AssetsUrl(...)` / `BuildaSDK.AssetsBaseUrl()`），**禁止把 CDN URL 写死**——`assetsBaseUrl` 每次重传都会变。
- 加载失败必须可感知、可重试（进度条/占位/重试按钮），不允许白屏或卡死；发布前在 `builda dev` 里断网实测失败分支。
- 建议启动时并发预取本关卡所需资源并显示进度，不要玩到一半才逐个拉。

分引擎接法：

- **Godot**（双路线，二选一）：
  - data-only `.pck`（推荐，原生高效）：在 Godot 里导出只含资源的 pck（Export PCK + 资源过滤，**不勾任何脚本**），运行时 `HTTPRequest` 下载 → 写入 `user://` → `ProjectSettings.load_resource_pack()` 挂进 `res://` → 正常 `load()` 使用。吃的是导入后资源（`.ctex`/序列化 mesh），比运行时解析 glb 快。硬约束：pck 内不得有 `.gd/.gdc/.gdns/.cs`、原生库/GDExtension、加密内容，**场景/资源不得引用脚本**——以上由服务端解析校验，违规整包拒绝。压缩无需关心：Godot 场景导入器产出的 RSCC 压缩资源（如 glb 导入的 `.scn`）服务端会自动解压检视——需要挂逻辑的场景，改为主包里的脚本在实例化后 `set_script()`/组合。注意 pck 挂载会覆盖主包同路径的 `res://` 资源，路径不要与主包冲突（除非有意做覆盖更新）。
  - `.glb` 运行时解析：`HTTPRequest` 拉取 URL → `GLTFDocument.append_from_buffer()` 实例化。先用目标 Godot 4.x 版本的 Web 导出模板实测运行时 gltf 模块可用，再批量迁移资源。
- **HTML5（three.js/pixi）**：`GLTFLoader` / `Assets.load` 直接消费 URL，无额外工作。
- **Unity WebGL**（双路线，二选一）：
  - glTFast 消费 `.glb`：官方包 `com.unity.cloud.gltfast`。注意 WebGL 无 Burst、运行时解析偏慢；glTFast 材质 shader 必须经 Shader Variant Collection 强制打进主包，否则编辑器正常、真机洋红。
  - AssetBundle / Addressables（推荐）：Addressables RemoteLoadPath 运行时从 `BuildaSDK.AssetsBaseUrl()` 注入，或裸 `UnityWebRequestAssetBundle`。bundle 必须与 player **同一 Unity 版本**构建；WebGL 用 LZ4 或不压缩（LZMA 会全量解压进内存）；构建产物显式命名 `.bundle` 扩展名（Addressables catalog 的 `.json`/`.hash` 同样放 `res/**`）；防止多 bundle 重复内嵌同一 shader。
  - 贴图/配置用 `UnityWebRequest` 原生消费 `.png`/`.jpg`/`.json`；**不要选 `.webp`**（Unity 无原生解码，该扩展名给 H5/Godot 用）。

JS 侧返回统一 Result：

```json
{"ok": true, "data": {}}
```

或：

```json
{"ok": false, "error": {"code": "BAD_KEY", "message": "..."}}
```

本地开发不需要 token。Web URL 可加：

```text
?gameId=local-game&builda_mock_player=alice&builda_mock_name=Alice
```

本地 mock 语义：

- `whoami()` 返回 mock player。
- KV 写浏览器 `localStorage`。
- privateKV key 必须匹配 `^[A-Za-z0-9_:-]{1,64}$`；`.`、`+`、`/`、空格、`$` 和非 ASCII 字符均非法。新代码仍推荐只使用字母、数字、`_`、`-`。
- value 必须是 JSON 可序列化值，顶层不能是 `null`。
- 真机 runtime 下音频播放应调用 `Builda.audio.*`，SDK 会优先走 Builda App bridge（原生实现，无 autoplay 限制，不需要首次点击解锁）；本地浏览器 mock 会使用浏览器 `Audio`，没有 `Audio` 环境时返回 `{ok:true,data:{available:false}}`。
- Godot editor/native 运行不是完整 SDK runtime；`builda.gd` 会返回 `UNSUPPORTED`。本地 mock 验证应导出 Web 后在浏览器或 Builda App WebView 中运行。

SDK 验证分两层：

```bash
./.builda-agent/builda sdk smoke
```

`sdk smoke` 只验证本地 mock：`whoami()`、`privateKV.set/get/remove/setMany/getMany/removeMany()` 必须在无 token 情况下可用，且不能访问网络。它适合作者本地开发和改 Godot 接入代码后的快速检查。通过后会输出建议的 Autoload 文件和本地 mock URL；这不是完整 Godot 导出测试，仍需继续做下面的项目级验证。
如果 `project.godot` 中的 `BuildaClient` Autoload 指向不存在的脚本，`sdk smoke` 会失败；先重跑 `sdk install` 修复。

`sdk smoke` 通过后继续做项目级验证：

1. 确认项目里已经接入 `BuildaClient.gd` 或等价主场景节点。
2. 导出 Godot Web build。
3. 启动本地运行器：

```bash
./.builda-agent/builda dev --web build/web
```

4. 打开命令输出的 `dev-url`（测试外壳），在浏览器里真实跑游戏验收：切横屏/竖屏、开关刘海屏确认关键 UI 避让安全区与胶囊按钮，
   触发支付/广告确认外壳模态框两条分支。预期 Godot 输出包含 mock player 和 KV 结果；浏览器 localStorage 中会出现
   `builda:privatekv:local-game:local-player:wins` 这类按玩家隔离的 key（值为 base64）。需要换身份时在 URL 后追加 `&builda_mock_player=<id>&builda_mock_name=<name>`。
   同时看浏览器 console：mock 版 SDK 收到 `Builda.runtime.ready()` 会打印确认；若加载 15 秒后游戏已在运行却出现"仍未收到 Builda.runtime.ready()"警告，说明漏调了 ready()，必须补上再验收。

本地验证到此为止：mock 版 SDK 的测试都基于 mock 测试用户，不存在拿真实 runtime token 在本地打真实服务端的流程。真实身份、KV、支付、广告等行为只在 Builda App runtime（正式版 SDK）里验证——走草稿流程，在 Builda app 待发布区试玩。

Builda App runtime 语义：

- 正式运行时的身份和 KV 由 Builda App 提供：`whoami()` 返回真实玩家，KV 存储位置由平台决定（待发布区试玩的存档可能是临时数据，不保证带入正式发布后），游戏代码不感知登录，也不需要处理任何 token。
- 游戏加载完成后、开始游戏逻辑前**必须调用** `Builda.runtime.ready()` 通知宿主。设置（含音乐/音效开关）与暂停/退出由平台通用页面统一提供，游戏不要自己做；胶囊菜单已含退出入口，无主动退出场景时 `Builda.runtime.quit()` 可以不调用，调用会调起该通用暂停/退出页面。
- 游戏代码不得读取或依赖宿主 App 注入的任何 token，也不要绕过 Builda SDK 直接调用底层 App 桥——一律走 Builda SDK。

## Manifest

`builda.publish.json` 是草稿的单一真相源：

```json
{
  "title": "Your game",
  "tagline": "One short sentence about the game.",
  "desc": "What players should know before playing.",
  "category": "",
  "engine": "godot",
  "tags": ["godot"],
  "orientation": "landscape",
  "minChromeMajor": 0,
  "minIOSMajor": 0,
  "coverKind": "palette",
  "coverPalette": "ember",
  "coverUrl": "",
  "buildPrefix": "",
  "buildEntry": "index.html",
  "buildSize": 0,
  "bundleUrl": "",
  "bundleMd5": "",
  "bundleVersion": "",
  "bundleEntry": "index.html",
  "bundleSize": 0
}
```

`engine` 由 `new-manifest` 按目录判定自动写入（`godot|h5|unity`，同时决定 `tags` 默认值），bundle-check 与上传按它选择校验规则；不要手工改成与项目不符的值。

`category` 是必填单选门禁。根据游戏的核心玩法，只能从下面 28 个键中选择一个；manifest 中写英文键，不能写中文、不能自造新值，也不能修改大小写。如果确实无法归入任何一项，填写 `other`；CLI 与服务端会把非空未知值兜底规范化为 `other`，但空值仍会拒绝提交：

```text
action 动作                 strategy 策略              rolePlay 角色扮演
plot 剧情                   adventure 冒险             sandBox 沙盒
survival 生存               pzzle 益智                 mystery 解谜
leisure 休闲                simulation 模拟            yangCheng 养成
card 卡牌                   desktop 桌面/棋牌          tower 塔防
rogueLike Roguelike         shoot 射击                 speed 竞速
sport 运动                  fangZhi 放置               music 音游
dress 换装                  other 其他                 cooperation 合作
moba MOBA                   asymmetric 非对称竞技      party Party Game
fight 格斗
```

`pzzle` 是当前发布合同中的兼容拼写，必须原样使用，不要擅自改成 `puzzle`。如果多个类型都适用，选择最能代表核心玩法的一个。`new-manifest` 故意把 `category` 留空，选择完成前 CLI 会拒绝提交。方向只用 `landscape|portrait`，封面类型只用 `palette|image`；CLI 会在上传前校验并指出需要修正的字段。

`minChromeMajor` / `minIOSMajor` 是游戏可运行的最低 Chrome 主版本与最低 Safari iOS 主版本，随 `create-draft` / `update-draft` 写入游戏版本信息，平台据此按设备做兼容拦截：**声明值越低，能进入游戏的设备越多**。所以要填构建**实际能跑的最低版本**，不要虚高（虚高等于无谓把老设备玩家挡在门外），也不要虚低（低于真实能力会让老设备进游戏后黑屏/崩溃）。**preflight 硬校验：两个字段都必须是正整数**，模板里的 `0` 是占位值，不评估填写就无法提交草稿。

评估方法：按构建真正的运行要求找证据，而不是凭感觉。参考点——WASM 引擎导出（如 Godot 4 Web、Unity WebGL/IL2CPP）的下限由编译工具链决定：新版 Emscripten 默认启用一批后 MVP 的 WASM 特性（sign-extension / bulk memory 约 Chrome 74–75，WASM-BigInt 约 Chrome 85），实际下限通常落在 Chrome 75–85 / iOS 15 区间，应查引擎官方最低浏览器要求或导出工具链（Emscripten）的 minimum-browser 配置；查不到可靠依据就用平台基线 `80` / `15`，不要为引擎导出虚低声明。纯 canvas/DOM、JS 已降级的 H5 游戏才可能显著低于基线；构建里用了更新的 Web API（如 OffscreenCanvas、WebGPU、未降级的较新 ES 语法）则相应调高。老项目的 `builda.publish.json` 可能没有这两个键，提交草稿前同样先评估再补写。

默认 manifest 故意省略 `rankBoards`，表示普通更新保持已有排行榜。需要配置排行榜时按 `https://ai.builda.game/agent/releases/0.4.37/md_rankboards.md` 添加完整数组；只有用户明确要求清空全部榜单时才写 `"rankBoards": []`。

`builda upload-build` 成功后会把响应里的 `prefix`、`entry`、`size` 和 `bundleUrl/bundleMd5/bundleVersion/bundleEntry/bundleSize` 写回 manifest。前者用于 Builda 在线试玩，后者用于 Builda App 下载、校验和本地 WebView 缓存。自动写入失败时必须手动照抄；这一步错了，草稿就没有可玩的入口或 App Bundle。

Builda Online Room 只在用户明确要求时按“Builda Online 联机”章节转交处理。

## 移动端性能 / 动态 DPR

当用户需求或问题提到手机发热、掉帧、高 DPI、DPR、`devicePixelRatio`、WebGL 显存、丢上下文、移动端性能、iPhone/iPad 清晰度或宿主 App 控制渲染分辨率时，按本节接入 `mobile-perf.js`，并确保它在 Godot 引擎创建画布之前执行。

<!-- builda-agent-version: 0.4.37 -->
# 动态 DPR（渲染分辨率上限，由宿主 App 控制）

> 本节示例与导出配置以 Godot Web 为主；HTML5 项目（pixi/phaser）同理——把 `mobile-perf.js` 放在引擎/渲染器初始化之前的 `<head>` 里即可，pixi/phaser 的 `resolution` 选项也应读取覆盖后的 `devicePixelRatio`。

高 DPI 手机会把 Web 画布按 2–3 倍设备像素渲染，GPU 要多着色 4–9 倍片段，导致发热、掉帧。在较弱或较老的 WebKit 上还可能撑爆 WebGL 显存，表现为丢上下文、光影渲染失败。

为此在包里放一个极小的 `mobile-perf.js`，在引擎创建画布之前覆盖 `window.devicePixelRatio`，把渲染缓冲降下来。

关键：值由宿主 App 决定，用 URL 参数 `?dpr=` 传入。网页侧只负责执行，不做任何机型/系统判断（浏览器也拿不到 iPhone/iPad 型号）。App 判断设备后拼参数即可。

## 用法：App 启动游戏时在 URL 后拼 `?dpr=N`

```text
.../index.html?dpr=1     软/最兼容（老、弱机）
.../index.html?dpr=2     折中
.../index.html?dpr=3     最清晰（新机）
.../index.html?dpr=0     （或不传）不限制，用设备原生 DPR
```

- `?dpr=` 可与其它参数并存（`[?&]dpr=` 匹配，位置无所谓），例如 `?builda_token=...&dpr=2`。
- 规则：有 `?dpr=N` 且 N>0，则把 `devicePixelRatio` 压到 N；否则用原生。

## 集成：两步

### 1. 在导出目录放 `mobile-perf.js`

文件内容（`build/web/mobile-perf.js`，导出后确保它在包里）：

```js
// Render-resolution cap, driven ONLY by a ?dpr= URL parameter.
// The HOST APP decides the value and appends it when launching the game.
// Must run before the engine sizes its canvas (loaded from <head>).
(function () {
  try {
    var m = (location.search || "").match(/[?&]dpr=(-?[0-9.]+)/)
    if (!m) return;             // no param -> native DPR
    var cap = parseFloat(m[1])
    if (!(cap > 0)) return;     // ?dpr=0 (or invalid) -> explicit no cap
    var real = window.devicePixelRatio || 1
    if (real > cap) {
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        get: function () { return cap; },
        set: function () {}     // tolerate engine assignments
      })
      console.log("[mobile-perf] DPR " + real + " -> " + cap)
    }
  } catch (e) {}
})()
```

### 2. 在 Web 导出预设的 `html/head_include` 里加载它

必须在 Godot loader 之前。`export_presets.cfg` 的 Web preset：

```ini
html/head_include="<script src=\"mobile-perf.js\"></script><script src=\"builda-sdk.js\"></script>"
```

`mobile-perf.js` 必须排在 `builda-sdk.js` / Godot 引擎脚本之前，因为覆盖 `devicePixelRatio` 要在引擎创建 WebGL 上下文 / 定画布尺寸之前生效。引擎起来之后再改就晚了，画布已按原生 DPR 分配。

## 要点 / 坑

1. 必须早于引擎：只能在 `<head>` 里、Godot loader 之前跑。放进 GDScript（`_ready`）已经太晚，那时画布/上下文已按原生 DPR 建好。所以“判断用哪个 DPR”的决定必须在最早的 JS 层或由 App 传参完成。
2. 判断放宿主：浏览器 UA 里没有 iPhone/iPad 型号，14 和 12/13 同屏无法区分，所以设备分档只能靠 App。网页侧不做判断，只认 `?dpr=`。
3. 导出会保留：Godot 导出只生成 `index.*`，不会覆盖手放的 `mobile-perf.js`；但要确保它在最终 bundle 里，打包脚本里需要 stage 一下。
4. 调试：直接在 URL 加 `?dpr=1/2/3/0` 就能在任意机器上对比，不用重打包。

## 新游戏 vs 更新已有游戏

- 新游戏：`publish <build.zip>` 自动执行 `upload-build -> 等待 ready -> create-draft`，成功后才写入 gameId 并汇报 Builda 当前版本已更新、cysj 待发布草稿已同步；首次上传期间没有 gameId，不得预创建空游戏。
- 更新已有游戏：当前项目目录里有 `.builda-agent/game.json` 时，`publish <build.zip>` 自动执行 `upload-build -> 等待 ready -> update-draft`，然后停止并作同样汇报。
- 无论新建还是更新，提交草稿前确认 manifest 已把 `minChromeMajor` / `minIOSMajor` 从占位值评估填写为构建实际能跑的最低版本（越低触达越广，见"Manifest"一节）；老 manifest 没有这两个键时先评估再补写，preflight 会拒绝缺失或占位的提交。
- 涉及 privateKV、支付或排行榜改动时，按 `https://ai.builda.game/agent/releases/0.4.37/md_persistent_ids.md` 核对稳定标识符设计；不要随意改动已有 `privateKV key`、`payId` 或 `rankId`。
- `.builda-agent/game.json` 是项目身份文件，放在当前项目的 `.builda-agent/` 目录里。它记录 `gameId/title/lastVersionId/updatedAt`，一个项目一个文件；用户同时维护多个游戏时，agent 必须先进入对应项目目录再操作。
- `create-draft` 成功后 CLI 会自动写入 `.builda-agent/game.json`。`update-draft` 成功后也会更新它。
- 如果当前项目没有 `.builda-agent/game.json`，但用户明确说这是已有游戏，必须让用户提供一次目标 `game_id`，执行 `update-draft <game_id>`；成功后 CLI 会把绑定写入当前项目目录。
- 老版本留下的项目根目录 `builda.game.json` 会被 CLI 自动迁移到 `.builda-agent/game.json`。
- `.builda-agent/last-game-id` 只是弱恢复收据，不能替代应入库的 `.builda-agent/game.json`，也不能把它当作跨项目更新目标自动使用。
- `update-draft` 会同步 Builda 待发布草稿并切换 Builda 当前版本，不影响 Builda 平台已公开 release。

## Godot 导出

1. 确认当前目录有 `project.godot`。
2. 检查 `export_presets.cfg` 是否有 Web/HTML5 preset；没有就告诉用户需要先在 Godot 里配置 Web 导出模板。
   `sdk install` 会尽量为已有 Web preset 注入根路径 `builda-sdk.js` 引用；如果 bundle-check 仍提示
   `index.html does not load builda-sdk.js`，先检查并修复 `html/head_include`，再重新导出。
3. 找到 Godot 命令：优先项目需要的 Godot 大版本，其次 `godot4`、`godot`。如果项目是 Godot 4.6，但本机 `godot` 是 4.3/4.4，
   不要强行导出；先安装匹配版本编辑器和 Web export template，再导出。缺模板时错误通常不是 Builda 问题。
4. 导出前运行 `./.builda-agent/builda godot web-template-check godot4` 或 `... godot`。这个检查验证当前 `HOME`
   下是否有对应 Godot 版本的 Web export templates。干净 HOME 常见问题是有 Godot 二进制但没有
   `$HOME/.local/share/godot/export_templates/<version>/web_release.zip` 或 `web_nothreads_release.zip`；这种情况下不要上传失败导出的空目录。
   如果同一台机器另一个 HOME 已有相同版本模板，可以复制整个 `<version>` 目录到当前 HOME 的对应位置；否则安装匹配版本的 Web export templates 后重试。
5. 推荐导出目录是项目内临时目录，例如 `build/web`；不要把源码一起 zip。
6. 默认使用 Godot Web 单线程导出：把 Web preset 固定为
   `variant/thread_support=false`、`variant/extensions_support=false`、`progressive_web_app/ensure_cross_origin_isolation_headers=false`、`progressive_web_app/offline_page=""`。
   这是当前 Android + iOS Builda App WebView 的发布口径；不要为了浏览器性能默认开启多线程/SharedArrayBuffer。只有用户明确要求 iOS 专用多线程包时，才另行导出多线程变体。
7. 导出后不需要（也不要）把 SDK JS 复制进导出目录：zip 不打包 SDK。本地验证用 `builda dev`（自动 serve 项目内开发版），正式运行时由 Builda App 按 manifest 的 `sdk` 契约从 CDN 下载对应版本注入。
8. 再打成 Godot H5 Bundle zip：根目录必须包含 `index.html`、`index.js`、`index.wasm`、`index.pck`（SDK JS 不打包，由宿主按 manifest 注入），不能把 `project.godot`、`export_presets.cfg`、`.env`、`.godot/`、`.git/`、`*.import` 等源码/编辑器文件打进去。
9. Godot Web/WASM 内存上限不能超过 1GiB；如果项目导出设置里配置了更大的 WebAssembly memory/heap，必须先降到 1GiB 以内再打包上传。
10. `builda bundle-check` 会硬查 SDK 注入、WebView 兼容导出、WASM 内存和导出结构；失败时按错误修导出配置、loose SDK JS 或 HTML head include，不要继续上传。

常见命令形态：

```bash
mkdir -p build/web
./.builda-agent/builda godot web-template-check godot4
godot4 --headless --path . --export-release "Web" build/web/index.html
(cd build/web && zip -r ../builda-web.zip .)
./.builda-agent/builda bundle-check --webview-compatible build/builda-web.zip
```

Windows PowerShell 对应打包命令：

```powershell
.builda-agent\builda.cmd bundle-pack build\web build\builda-web.zip
.builda-agent\builda.cmd bundle-check --webview-compatible build\builda-web.zip
```

如果项目 preset 名不是 `Web`，用 `export_presets.cfg` 里的实际 preset 名。

## HTML5 打包

HTML5 项目（engine=h5）上传的是**构建产物**，不是源码工程：

1. 先跑项目自己的构建（如 `npm run build`），得到自包含的静态目录（常见 `dist/` / `build/`）。**入口必须是根目录 `index.html`**，且 `<head>` 里保留 `<script src="builda-sdk.js"></script>` 引用（见“SDK 接入（HTML5）”）。
2. 构建产物必须离线自包含：所有 JS/CSS/图片/音频随包分发，不允许引用任何外部 CDN。字体**优先用系统字体**——H5 渲染（pixi/phaser/canvas）走浏览器文本管线，自带含中文在内的系统字体回退，`font-family` 写通用字体栈即可，中文不需要打包字体；只有品牌/美术字这类自定义字体才随包分发，其中大字体（含 CJK）裁剪子集后入包（裁剪方法参考 `https://ai.builda.game/agent/releases/0.4.37/md_godot_i18n.md` §2，Godot 专属部分忽略）。关闭 sourcemap——zip 里出现 `.map` 会被 bundle-check 拒绝。
3. 把构建目录内容打成 zip（zip 根直接是 `index.html`，不要套一层目录）：

```bash
npm run build
(cd dist && zip -r ../builda-web.zip .)
./.builda-agent/builda bundle-check builda-web.zip
./.builda-agent/builda upload-build builda-web.zip
```

Windows PowerShell 使用：

```powershell
.builda-agent\builda.cmd bundle-pack dist builda-web.zip
```

4. h5 的 bundle-check 规则：必须有根目录 `index.html` 且引用 `builda-sdk.js`；禁 `node_modules/`、`.map`、`.d.ts`、`.env`、VCS 目录与任何 Godot 工程文件；文件类型限平台白名单（常见 web 资源均已覆盖，报 `File types not allowed` 时把该文件移出构建或改用受支持格式）；自带 `.wasm`（如物理引擎）允许，单文件 ≤1GiB。
5. 游戏可含自己的 wasm/worker；整包默认受 200 MiB 应用上限约束，已有且归属当前用户的动态白名单游戏可按服务端值提高到 `201..500` MiB；音频大文件优先走 `assets upload` 管线。

### Cocos Creator 项目（走 h5 流程）

Cocos Creator 游戏按 **HTML5（engine=h5）** 方式对接：构建平台选 **web-mobile**，上传物就是构建输出目录（根为 `index.html`），SDK 接入、bundle-check 规则、本地 `builda dev` 调试与上文 HTML5 流程完全一致。SDK 引用用 Cocos 的自定义构建模板注入：在项目根建 `build-templates/web-mobile/index.html`（从一次构建产物里拷出来改），`<head>` 里加 `<script src="builda-sdk.js"></script>`，此后每次构建自动带上。

构建配置约束（构建发布面板 / `buildConfig` 对应字段）：

| 字段 | 要求 | 原因 |
|---|---|---|
| `mainBundleIsRemote` | **必须 `false`** | zip 是自包含产物，远程 bundle 会在 CDN 环境直接启动失败 |
| `sourceMaps` | **必须 `false`** | `bundle-check` 禁 `.map`，且泄露源码 |
| `packages.<平台>.orientation` | 与 `builda.publish.json` 的 `orientation` 一致 | 否则宿主容器与游戏画布方向打架 |
| `debug` | 建议 `false` | 体积与性能 |
| `md5Cache` | `true` 可用 | Cocos 只对自身资源做 md5 改名，不影响根路径 `builda-sdk.js` 引用 |

## Unity WebGL 导出

Unity 项目（engine=unity）上传的是 **WebGL 构建输出**，不是 Unity 工程。完整导出专题（含常见坑）见 `https://ai.builda.game/agent/releases/0.4.37/md_unity_webgl.md`，要点：

1. 环境要求：Unity 2021.3 LTS+，已安装 WebGL Build Support module。确认已按「SDK 接入（Unity）」完成 `sdk install` 并在 Player Settings 选择 **Builda** WebGL Template（SDK 引用契约，bundle-check 硬查）。
2. **压缩设置（设错直接被拒）**：`Player Settings → Publishing Settings`，Compression Format 选 **Brotli/Gzip 且勾选 Decompression Fallback**（推荐，产物 `Build/*.unityweb`），或选 **Disabled**（裸产物兜底）。**开压缩但不勾 Fallback 的 `.br`/`.gz` 产物会被硬拒**。
3. WASM 内存 ≤1GiB（Player Settings → Publishing Settings → Memory 相关配置），超限在移动端 WebView 大概率起不来。
4. 字体：WebGL 下 TMP 与 legacy Font 都没有系统字体回退（编辑器里有——Game 视图效果不可信），CJK 文本必须内嵌字体且用 fontTools 裁剪子集，全量 CJK 字体不要直接入包；排行榜玩家名等开集文本要做运行时缺字过滤。做多语言或字体前先读 `https://ai.builda.game/agent/releases/0.4.37/md_unity_webgl.md` 第 5 章（TMP/legacy 选型、includeFontData 陷阱、裁剪与缺字过滤全流程）。
5. `File → Build Settings → WebGL → Build`，输出到项目内临时目录（如 `Builds/WebGL`）。产物应为根 `index.html` + `Build/` 四件套（`*.loader.js`/`*.framework.js`/`*.wasm`/`*.data`，允许 `.unityweb` 后缀）+ `TemplateData/` + 可选 `StreamingAssets/`。`Build/` 是默认输出目录名，勿改。
6. 把构建输出目录内容打成 zip（zip 根直接是 `index.html`）：

```bash
(cd Builds/WebGL && zip -r ../../builda-web.zip .)
./.builda-agent/builda bundle-check builda-web.zip
./.builda-agent/builda upload-build builda-web.zip
```

Windows PowerShell 使用：

```powershell
.builda-agent\builda.cmd bundle-pack Builds\WebGL builda-web.zip
```

7. unity 的 bundle-check 规则：根 `index.html` 引用 `builda-sdk.js`；`Build/` 四件套齐全（按前缀+后缀匹配，不限文件名）；禁 `.br`/`.gz` 裸预压缩、`*.meta`/`*.csproj`/`*.sln`/`*.unity`、`Library/`/`Temp/`/`Obj/`/`ProjectSettings/`、`.map`、`node_modules/`；`StreamingAssets/` 下不限扩展名（AssetBundle 可无扩展名），其余位置限平台白名单。
8. 整包默认受 200 MiB 应用上限约束，已有且归属当前用户的动态白名单游戏可按服务端值提高到 `201..500` MiB；Unity 空项目 Brotli 后约 5-10MB，中大型项目注意用 Strip Engine Code、纹理压缩与 AssetBundle 按需加载控制体积。

## 恢复策略

- `./.builda-agent/builda status` 先看本地状态。
- `.builda-agent/game.json` 存在时，用里面的 `gameId` 继续更新草稿；不要把任何 `last-game-id` 收据当作跨项目更新目标。
- 没有 grant 但有 `agent-authorization=present`：运行幂等 `./.builda-agent/builda auth` 自动刷新短期 grant。
- 没有 grant 且没有 `agent-authorization`：运行 `./.builda-agent/builda auth`，让用户在打开的授权页登录/注册并点击授权。
- 已上传 zip 但创建/更新草稿失败：优先重跑同一 `builda publish <同一 zip>`；稳定 Upload Session key 会复用 ready Build。CLI 会在 `.builda-agent/last-draft-operation-*` 原子保存未确认的草稿 operation：网络中断、CLI/机器重启后重跑会复用，收到成功响应后删除；以后即使 checkout 同一历史内容，也会创建新 operation。不要手改或删除未确认收据来强行重试。只有定位 manifest 或绑定问题时，才复用 `builda.publish.json` 中已有的 `buildPrefix/buildEntry/buildSize`、`bundleUrl/bundleMd5/bundleVersion/bundleEntry/bundleSize`，新游戏修 manifest 后运行 `create-draft`，已有游戏运行 `update-draft`。
- 已上传 `assets.zip` 但创建/更新草稿失败：不要重复上传，优先复用 `builda.publish.json` 中已有的 `assetsVersion/assetsBaseUrl/assetsManifestUrl`。
- 已创建或更新版本：优先读取 `.builda-agent/game.json` 和项目内 `.builda-agent/last-version-id`，向用户展示标题、分类、标签、game id、current version id、bundleVersion 和 orientation；最后提醒用户去 Builda app 中试玩 Builda 待发布草稿并完成后续上架。
- grant 过期：重跑幂等 `./.builda-agent/builda auth`；只有刷新失败或没有本机 agent 授权时才会打开浏览器，
  不要要求用户上传源码或复制 token。
- 网络失败：保留 `last-build.json`、`last-draft.json` 和 manifest，重试最后一个幂等或可恢复步骤。
- Room 云构建/部署请求：联机功能内测中，如有需求请联系 Builda 官方。

- `BAD_KEY`、服务端 `200452`、参数非法、配额或值过大属于确定性错误：立即停止重试并记录明确日志。批量失败按整批未成功处理，禁止无限或高频重试。

卸载当前项目工具链用 `./.builda-agent/builda uninstall`：保留 `game.json`、`sdk-version` 和用户凭证。只有用户明确要求彻底清除时才用 `uninstall --purge`；它会连项目数据以及 `$HOME/.builda-agent/` 下的全机共享凭证一起删除。

## 收口话术

创建或更新同步成功后，用短句收口，不要给试玩 URL，也不要再调用 Builda publish：

```text
Builda 当前版本已更新，Builda 待发布草稿已同步：标题《...》，gameId ...，currentVersionId ...，bundleVersion ...，方向 ...。下一步请在 Builda app 中试玩，确认无误后完成审核上架。
```
