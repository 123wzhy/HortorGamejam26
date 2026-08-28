$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (!$PSVersionTable -or $PSVersionTable.PSEdition -ne "Desktop" -or $PSVersionTable.PSVersion -lt [version]"5.1") {
  [Console]::Error.WriteLine("BUILDA_UNSUPPORTED_POWERSHELL: Run .builda-agent\builda.cmd")
  exit 2
}
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12

# Shared by the Windows installer and CLI self-update. Keep Windows PowerShell 5.1 syntax.
function Read-Utf8Text {
  param([string]$Path)
  return [System.IO.File]::ReadAllText([System.IO.Path]::GetFullPath($Path), [System.Text.Encoding]::UTF8)
}

function Write-Utf8Text {
  param([string]$Path, [AllowEmptyString()][string]$Content)
  $Encoding = New-Object System.Text.UTF8Encoding($false)
  $FullPath = [System.IO.Path]::GetFullPath($Path)
  $Parent = [System.IO.Path]::GetDirectoryName($FullPath)
  if ($Parent) { [System.IO.Directory]::CreateDirectory($Parent) | Out-Null }
  [System.IO.File]::WriteAllText($FullPath, $Content, $Encoding)
}

function Write-WindowsPowerShellScript {
  param([string]$Path, [AllowEmptyString()][string]$Content)
  $Encoding = New-Object System.Text.UTF8Encoding($true)
  $FullPath = [System.IO.Path]::GetFullPath($Path)
  $Parent = [System.IO.Path]::GetDirectoryName($FullPath)
  if ($Parent) { [System.IO.Directory]::CreateDirectory($Parent) | Out-Null }
  [System.IO.File]::WriteAllText($FullPath, $Content, $Encoding)
}

function Get-BuildaFileSha256 {
  param([string]$Path)
  $FullPath = [System.IO.Path]::GetFullPath($Path)
  $Stream = $null
  $Hasher = $null
  try {
    $Stream = [System.IO.File]::Open(
      $FullPath,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      [System.IO.FileShare]::Read
    )
    $Hasher = [System.Security.Cryptography.SHA256]::Create()
    [byte[]]$Digest = $Hasher.ComputeHash($Stream)
    return -join ($Digest | ForEach-Object { $_.ToString("x2") })
  } finally {
    if ($Hasher -is [System.IDisposable]) { $Hasher.Dispose() }
    if ($Stream -is [System.IDisposable]) { $Stream.Dispose() }
  }
}

function Get-BuildaExceptionChain {
  param([object]$Failure)
  [object[]]$Items = @()
  $Current = if ($Failure -is [System.Management.Automation.ErrorRecord]) { $Failure.Exception } else { $Failure }
  while ($null -ne $Current -and $Items -notcontains $Current) {
    $Items += $Current
    $Current = $Current.InnerException
  }
  return $Items
}

function Test-BuildaSchannelNoCredentials {
  param([object]$Failure)
  foreach ($Exception in @(Get-BuildaExceptionChain $Failure)) {
    $Message = [string]$Exception.Message
    $HexHResult = ""
    try { $HexHResult = "{0:X8}" -f ([uint32]$Exception.HResult) } catch { $HexHResult = "" }
    if ($HexHResult -eq "8009030E" -or
        $Message -match '(?i)SEC_E_NO_CREDENTIALS|0x8009030e|No credentials are available in the security package' -or
        $Message -like '*安全包中没有可用的凭证*') {
      return $true
    }
  }
  return $false
}

function Get-BuildaDownloadFailureSummary {
  param([object]$Failure, [string]$Transport)
  $Exception = @(Get-BuildaExceptionChain $Failure) | Select-Object -Last 1
  $Type = if ($Exception) { $Exception.GetType().FullName } else { "unknown" }
  $HexHResult = "unknown"
  if ($Exception) {
    try { $HexHResult = "0x{0:X8}" -f ([uint32]$Exception.HResult) } catch { $HexHResult = "unknown" }
  }
  return "transport=$Transport hresult=$HexHResult exception=$Type"
}

function Invoke-BuildaNodeRawDownload {
  param([string]$Uri, [string]$Destination)
  $Node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
  if (!$Node) { $Node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue }
  if (!$Node) {
    throw "BUILDA_WINDOWS_TLS_UNAVAILABLE: code=SEC_E_NO_CREDENTIALS transport=schannel recovery=install Node.js or run outside the restricted environment"
  }

  $FullDestination = [System.IO.Path]::GetFullPath($Destination)
  $Part = "$FullDestination.node-part-$PID"
  $PreviousUri = $env:BUILDA_DOWNLOAD_URI
  $PreviousDestination = $env:BUILDA_DOWNLOAD_DESTINATION
  $PreviousPart = $env:BUILDA_DOWNLOAD_PART
  $env:BUILDA_DOWNLOAD_URI = $Uri
  $env:BUILDA_DOWNLOAD_DESTINATION = $FullDestination
  $env:BUILDA_DOWNLOAD_PART = $Part
  $NodeScript = @'
const fs = require('fs');
const http = require('http');
const https = require('https');
const source = process.env.BUILDA_DOWNLOAD_URI;
const destination = process.env.BUILDA_DOWNLOAD_DESTINATION;
const part = process.env.BUILDA_DOWNLOAD_PART;
function fail(error) {
  try { fs.unlinkSync(part); } catch (_) {}
  process.stderr.write('node download failed: ' + (error && error.message ? error.message : String(error)) + '\n');
  process.exit(1);
}
function download(url, redirects) {
  if (redirects > 5) return fail(new Error('too many redirects'));
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
  if (!transport) return fail(new Error('unsupported protocol'));
  const request = transport.get(parsed, { timeout: 30000 }, response => {
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
      response.resume();
      return download(new URL(response.headers.location, parsed).toString(), redirects + 1);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      return fail(new Error('HTTP ' + response.statusCode));
    }
    const output = fs.createWriteStream(part, { flags: 'w' });
    output.on('error', fail);
    response.on('error', fail);
    output.on('finish', () => output.close(() => {
      try { fs.unlinkSync(destination); } catch (error) { if (error.code !== 'ENOENT') return fail(error); }
      try { fs.renameSync(part, destination); } catch (error) { return fail(error); }
    }));
    response.pipe(output);
  });
  request.on('timeout', () => request.destroy(new Error('timeout')));
  request.on('error', fail);
}
download(source, 0);
'@
  try {
    Remove-Item -Force -LiteralPath $Part -ErrorAction SilentlyContinue
    & $Node.Source -e $NodeScript
    $ExitCode = $LASTEXITCODE
    if ($ExitCode -ne 0 -or !(Test-Path -LiteralPath $FullDestination)) {
      throw "BUILDA_DOWNLOAD_FAILED: transport=node-openssl exit=$ExitCode"
    }
    $script:BuildaLastDownloadTransport = "node-openssl"
  } finally {
    Remove-Item -Force -LiteralPath $Part -ErrorAction SilentlyContinue
    if ($null -eq $PreviousUri) { Remove-Item Env:BUILDA_DOWNLOAD_URI -ErrorAction SilentlyContinue } else { $env:BUILDA_DOWNLOAD_URI = $PreviousUri }
    if ($null -eq $PreviousDestination) { Remove-Item Env:BUILDA_DOWNLOAD_DESTINATION -ErrorAction SilentlyContinue } else { $env:BUILDA_DOWNLOAD_DESTINATION = $PreviousDestination }
    if ($null -eq $PreviousPart) { Remove-Item Env:BUILDA_DOWNLOAD_PART -ErrorAction SilentlyContinue } else { $env:BUILDA_DOWNLOAD_PART = $PreviousPart }
  }
}

function Invoke-BuildaRawDownload {
  param([string]$Uri, [string]$Destination)
  $PreviousProgressPreference = $ProgressPreference
  $ProgressPreference = "SilentlyContinue"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination
    $script:BuildaLastDownloadTransport = "powershell-webrequest"
  } catch {
    if (!(Test-BuildaSchannelNoCredentials $_)) {
      $Summary = Get-BuildaDownloadFailureSummary $_ "powershell-webrequest"
      throw "BUILDA_DOWNLOAD_FAILED: $Summary"
    }
    [Console]::Error.WriteLine("download-warning=schannel-no-credentials retry-transport=node-openssl")
    Invoke-BuildaNodeRawDownload -Uri $Uri -Destination $Destination
  } finally {
    $ProgressPreference = $PreviousProgressPreference
  }
}

function Get-BuildaRemoteUtf8Text {
  param([string]$Uri)
  $Temporary = [System.IO.Path]::GetTempFileName()
  try {
    Invoke-BuildaRawDownload -Uri $Uri -Destination $Temporary
    return Read-Utf8Text $Temporary
  } finally {
    Remove-Item -Force -LiteralPath $Temporary -ErrorAction SilentlyContinue
  }
}

function Get-BuildaRemoteJson {
  param([string]$Uri)
  return (Get-BuildaRemoteUtf8Text -Uri $Uri | ConvertFrom-Json)
}

function Test-WindowsPowerShellScriptBom {
  param([string]$Path)
  [byte[]]$Prefix = [System.IO.File]::ReadAllBytes($Path)
  return $Prefix.Length -ge 3 -and $Prefix[0] -eq 0xef -and $Prefix[1] -eq 0xbb -and $Prefix[2] -eq 0xbf
}

function Install-BuildaWindowsToolchain {
  param(
    [string]$Root,
    [string]$ReleaseBase,
    [string]$ExpectedVersion,
    [scriptblock]$ReplaceAction = $null,
    [scriptblock]$RestoreAction = $null
  )

  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetFullPath($Root)) | Out-Null
  $TransactionRoot = Join-Path $Root (".windows-install-" + [System.Guid]::NewGuid().ToString("N"))
  $StageRoot = Join-Path $TransactionRoot "stage"
  $BackupRoot = Join-Path $TransactionRoot "backup"
  New-Item -ItemType Directory -Force -Path $StageRoot, $BackupRoot | Out-Null
  $Files = @(
    @{ Remote = "builda"; Local = "builda"; Script = $false },
    @{ Remote = "builda.ps1"; Local = "builda.ps1"; Script = $true },
    @{ Remote = "builda.cmd"; Local = "builda.cmd"; Script = $false },
    @{ Remote = "builda-skill.md"; Local = "SKILL.md"; Script = $false }
  )
  $Replaced = New-Object System.Collections.Generic.List[object]
  $TransactionCommitted = $false
  $RollbackComplete = $false

  try {
    $ManifestPath = Join-Path $TransactionRoot "manifest.json"
    Invoke-BuildaRawDownload "$ReleaseBase/manifest.json" $ManifestPath
    $Manifest = Read-Utf8Text $ManifestPath | ConvertFrom-Json
    if ([string]$Manifest.version -ne $ExpectedVersion) {
      throw "release manifest version mismatch: expected $ExpectedVersion, got $($Manifest.version)"
    }
    foreach ($File in $Files) {
      $RemoteName = [string]$File.Remote
      $MetadataProperty = $Manifest.artifacts.PSObject.Properties[$RemoteName]
      if (!$MetadataProperty -or !$MetadataProperty.Value.sha256) {
        throw "release manifest is missing SHA-256 for $RemoteName"
      }
      $StagePath = Join-Path $StageRoot ([string]$File.Local)
      Invoke-BuildaRawDownload "$ReleaseBase/$RemoteName" $StagePath
      $ActualSha = Get-BuildaFileSha256 $StagePath
      $ExpectedSha = ([string]$MetadataProperty.Value.sha256).ToLowerInvariant()
      if ($ActualSha -ne $ExpectedSha) { throw "SHA-256 mismatch for $RemoteName" }
      if ($File.Script -and !(Test-WindowsPowerShellScriptBom $StagePath)) {
        throw "$RemoteName is missing the Windows PowerShell UTF-8 BOM"
      }
    }

    $CliText = Read-Utf8Text (Join-Path $StageRoot "builda.ps1")
    if ($CliText -notmatch ('\$Version\s*=\s*"' + [regex]::Escape($ExpectedVersion) + '"')) {
      throw "builda.ps1 version does not match $ExpectedVersion"
    }
    $SkillText = Read-Utf8Text (Join-Path $StageRoot "SKILL.md")
    if ($SkillText -notlike "*BuildaGame agent 工具链版本：$ExpectedVersion*") {
      throw "SKILL.md version does not match $ExpectedVersion"
    }
    $CmdText = Read-Utf8Text (Join-Path $StageRoot "builda.cmd")
    if ($CmdText -notlike '*%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe*' -or $CmdText -notlike '*"%~dp0builda.ps1" %**') {
      throw "builda.cmd does not pin Windows PowerShell 5.1 or preserve arguments"
    }
    $UnixText = Read-Utf8Text (Join-Path $StageRoot "builda")
    if (!$UnixText.StartsWith("#!/usr/bin/env bash")) { throw "builda Unix launcher is invalid" }

    Write-Utf8Text (Join-Path $StageRoot "VERSION") "$ExpectedVersion$([Environment]::NewLine)"
    $InstallFiles = @($Files) + @(@{ Local = "VERSION" })
    foreach ($File in $InstallFiles) {
      $LocalName = [string]$File.Local
      $StagePath = Join-Path $StageRoot $LocalName
      $Destination = Join-Path $Root $LocalName
      $BackupPath = Join-Path $BackupRoot $LocalName
      $Existed = Test-Path -LiteralPath $Destination
      if ($ReplaceAction) {
        & $ReplaceAction $StagePath $Destination $BackupPath $Existed
      } else {
        if ($Existed) {
          [System.IO.File]::Replace([System.IO.Path]::GetFullPath($StagePath), [System.IO.Path]::GetFullPath($Destination), [System.IO.Path]::GetFullPath($BackupPath), $true)
        } else {
          [System.IO.File]::Move([System.IO.Path]::GetFullPath($StagePath), [System.IO.Path]::GetFullPath($Destination))
        }
      }
      $Replaced.Add(@{ Path = $Destination; Backup = $BackupPath; Existed = $Existed })
    }
    $TransactionCommitted = $true
  } catch {
    $OriginalFailure = $_.Exception.Message
    $RollbackFailures = New-Object System.Collections.Generic.List[string]
    for ($Index = $Replaced.Count - 1; $Index -ge 0; $Index--) {
      $Entry = $Replaced[$Index]
      try {
        if ($RestoreAction) {
          & $RestoreAction $Entry.Path $Entry.Backup $Entry.Existed
        } else {
          if ($Entry.Existed -and (Test-Path -LiteralPath $Entry.Backup)) {
            if (Test-Path -LiteralPath $Entry.Path) { Remove-Item -Force -LiteralPath $Entry.Path }
            Move-Item -Force -LiteralPath $Entry.Backup -Destination $Entry.Path
          } elseif (!$Entry.Existed -and (Test-Path -LiteralPath $Entry.Path)) {
            Remove-Item -Force -LiteralPath $Entry.Path
          }
        }
      } catch {
        $RollbackFailures.Add("$($Entry.Path): $($_.Exception.Message)")
      }
    }
    if ($RollbackFailures.Count -gt 0) {
      [Console]::Error.WriteLine("BUILDA_INSTALL_ROLLBACK_FAILED: transaction preserved at $TransactionRoot")
      throw "BUILDA_INSTALL_ROLLBACK_FAILED: original=$OriginalFailure rollback=$([string]::Join('; ', $RollbackFailures)) transaction=$TransactionRoot"
    }
    $RollbackComplete = $true
    throw
  } finally {
    if (($TransactionCommitted -or $RollbackComplete) -and (Test-Path -LiteralPath $TransactionRoot)) {
      try {
        Remove-Item -Recurse -Force -LiteralPath $TransactionRoot
      } catch {
        [Console]::Error.WriteLine("BUILDA_INSTALL_CLEANUP_WARNING: transaction cleanup failed; remove manually: $TransactionRoot")
      }
    }
  }
}


$SelfDir = Split-Path -Parent ([System.IO.Path]::GetFullPath($PSCommandPath))
# 旧命名 .builda-godot-agent（多引擎化前）由 Invoke-LegacyProjectDirMigrate / Invoke-LegacyAuthMigrate 自动迁移
$UserAuthDir = Join-Path $HOME ".builda-agent"
$AuthDir = if ($env:BUILDA_AUTH_DIR) { [System.IO.Path]::GetFullPath($env:BUILDA_AUTH_DIR) } else { $UserAuthDir }
$LegacyAuthDir = Join-Path $HOME ".builda-godot-agent"
$ProjectStateDir = if ($env:BUILDA_PROJECT_STATE_DIR) { $env:BUILDA_PROJECT_STATE_DIR } else { ".builda-agent" }
$LegacyProjectStateDir = ".builda-godot-agent"
$Root = $ProjectStateDir
$EnvPath = Join-Path $Root "publish.env"
$TokenPath = Join-Path $AuthDir "token"
$RefreshPath = Join-Path $AuthDir "refresh-token"
$Manifest = if ($env:BUILDA_MANIFEST) { $env:BUILDA_MANIFEST } else { "builda.publish.json" }
$ProjectFile = if ($env:BUILDA_PROJECT_FILE) { $env:BUILDA_PROJECT_FILE } else { Join-Path $ProjectStateDir "game.json" }
$LegacyProjectFile = if ($env:BUILDA_LEGACY_PROJECT_FILE) { $env:BUILDA_LEGACY_PROJECT_FILE } else { "builda.game.json" }
$Version = "0.4.37"
$RuntimeVersionFile = Join-Path $Root "VERSION"
$SdkVersionFile = Join-Path $ProjectStateDir "sdk-version"
$DefaultBase = "https://builda-godot-api.poni.fun"
if ($DefaultBase -like "{{*") {
  $DefaultBase = ""
}
$Base = $DefaultBase
$DefaultAgentBase = "https://ai.builda.game"
if ($DefaultAgentBase -like "{{*") {
  $DefaultAgentBase = $Base
}
$AgentBase = $DefaultAgentBase
$DefaultSiteBase = "https://builda.game"
if ($DefaultSiteBase -like "{{*") {
  $DefaultSiteBase = "https://builda.game"
}
$SiteOrigin = ""
$EarlyAccessUrl = ""
$PairCode = ""
$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:Utf8Strict = [System.Text.UTF8Encoding]::new($false, $true)

function Read-Utf8Text {
  param([string]$Path)
  return [System.IO.File]::ReadAllText([System.IO.Path]::GetFullPath($Path), $script:Utf8Strict)
}

function Read-Utf8Lines {
  param([string]$Path)
  return [System.IO.File]::ReadAllLines([System.IO.Path]::GetFullPath($Path), $script:Utf8Strict)
}

function Write-Utf8TextNoBom {
  param([string]$Path, [AllowEmptyString()][string]$Content)
  $FullPath = [System.IO.Path]::GetFullPath($Path)
  $Parent = [System.IO.Path]::GetDirectoryName($FullPath)
  if ($Parent) { [System.IO.Directory]::CreateDirectory($Parent) | Out-Null }
  [System.IO.File]::WriteAllText($FullPath, $Content, $script:Utf8NoBom)
}

function Append-Utf8TextNoBom {
  param([string]$Path, [AllowEmptyString()][string]$Content)
  $FullPath = [System.IO.Path]::GetFullPath($Path)
  $Parent = [System.IO.Path]::GetDirectoryName($FullPath)
  if ($Parent) { [System.IO.Directory]::CreateDirectory($Parent) | Out-Null }
  [System.IO.File]::AppendAllText($FullPath, $Content, $script:Utf8NoBom)
}

function Write-Utf8LinesNoBom {
  param([string]$Path, [System.Collections.IEnumerable]$Lines)
  [string[]]$Values = @($Lines | ForEach-Object { [string]$_ })
  $Content = [string]::Join([Environment]::NewLine, $Values)
  if ($Values.Count -gt 0) { $Content += [Environment]::NewLine }
  Write-Utf8TextNoBom $Path $Content
}

if (Test-Path $EnvPath) {
  Read-Utf8Lines $EnvPath | ForEach-Object {
    if ($_ -match "^BUILDA_BASE=(.*)$") { $script:Base = $Matches[1].Trim() }
    if ($_ -match "^BUILDA_AGENT_BASE=(.*)$") { $script:AgentBase = $Matches[1].Trim() }
    if ($_ -match "^BUILDA_SITE_ORIGIN=(.*)$") { $script:SiteOrigin = $Matches[1].Trim() }
    if ($_ -match "^BUILDA_PAIR_CODE=(.*)$") { $script:PairCode = $Matches[1].Trim() }
  }
}
if ($env:BUILDA_STUDIO_API_BASE) {
  # Studio Worker 显式注入集群内 API；外部用户继续使用项目 publish.env 的公网地址。
  $Base = $env:BUILDA_STUDIO_API_BASE.Trim()
}
$EffectiveSiteBase = if ($SiteOrigin) { $SiteOrigin } else { $DefaultSiteBase }
$EarlyAccessUrl = if ($env:BUILDA_EARLY_ACCESS_URL) { $env:BUILDA_EARLY_ACCESS_URL } else { "$EffectiveSiteBase/early-access" }

function Show-Usage {
  Write-Host "builda auth [code|--force]      Ensure agent authorization; --force switches account."
  Write-Host "builda auth status              Show the selected credential store without changing authorization."
  Write-Host "builda auth logout              Remove credentials from the selected store only."
  Write-Host "builda whoami                   Show the account used for publishing."
  Write-Host "builda check                    Check local BuildaGame agent environment."
  Write-Host "builda update                   Update this local CLI and installed agent skill."
  Write-Host "builda uninstall [--purge]      Remove project toolchain/registrations; --purge also removes project data and credentials."
  Write-Host "builda engine detect [dir]      Detect project engine; Godot, HTML5 and Unity draft upload are available."
  Write-Host "builda new-manifest             Write builda.publish.json template if missing."
  Write-Host "builda dev --web <dir|zip>      Run a local H5 build (Godot Web / pixi / phaser / Unity WebGL ...) with the Builda mock SDK."
  Write-Host "                               --assets <dir|zip> serves audio/**, res/** as a same-origin fallback (auto-detects ./assets)."
  Write-Host "builda bundle-pack <dir> <zip>  Create a portable H5 Bundle zip with '/' entry paths."
  Write-Host "builda bundle-check <zip>       Check that an H5 Bundle zip is uploadable (per-engine rules)."
  Write-Host "builda sdk init                 Create a minimal Godot project skeleton for SDK testing."
  Write-Host "builda sdk install              Install the Builda SDK (Godot: addons/builda; HTML5: .builda-agent/sdk/web; Unity: Assets/Builda)."
  Write-Host "builda sdk check                Check installed Builda SDK files in this project."
  Write-Host "builda sdk smoke                Run local mock SDK smoke test when Node.js exists."
  Write-Host "builda upload-build <zip>       Upload H5 Bundle zip; update manifest."
  Write-Host "builda upload-status <session>  Query a resumable build upload using the current grant."
  Write-Host "builda upload-cancel <session>  Cancel an owned resumable build upload."
  Write-Host "builda publish [zip] [manifest]  Upload an optional build and sync this project's draft."
  Write-Host "builda assets check <zip>       Check assets.zip: audio/** (.mp3|ogg|wav) + res/** (.glb|gltf|bin|ktx2|png|jpg|jpeg|webp|json|bundle|hash|pck; pck must be data-only)."
  Write-Host "builda assets upload <zip>      Upload audio/res assets; update manifest."
  Write-Host "builda create-draft [manifest]  Sync a new Builda pending draft and update the Builda current version."
  Write-Host "builda update-draft [game_id] [manifest]"
  Write-Host "                               Sync a Builda pending draft and update the Builda current version."
  Write-Host "builda status                   Show saved receipts."
  Write-Host "builda sync-project             Re-write project-level agent registrations (.gitignore/stubs/AGENTS.md)."
  Write-Host "builda version                  Show local CLI version."
  Write-Host ""
  Write-Host "Project-scoped toolchain: this CLI lives in <project>/.builda-agent/ and must run"
  Write-Host 'from that project''s root. Credentials default to per-user $HOME/.builda-agent/;'
  Write-Host 'set BUILDA_AUTH_DIR explicitly when an isolated, gitignored credential store is required.'
}

function Need-Token {
  if (Grant-NeedsRefresh) {
    try { Refresh-Grant | Out-Null } catch {}
  }
  if (!(Test-Path $TokenPath)) {
    throw "No agent grant. Run: builda auth"
  }
}

function Get-Token {
  (Read-Utf8Text $TokenPath).Trim()
}

function Get-CmdUrl {
  param([string]$Path)
  # Game_* commands are mandarin cmd-over-HTTP routes mounted at /game/*.
  # Agent REST helpers such as upload/auth live under /api/v1/*.
  "$Base/$Path"
}

function Get-ActingIdentity {
  Need-Token
  $Headers = @{ Authorization = "Bearer $(Get-Token)" }
  $Response = Invoke-BuildaAuthenticatedRequest -Method "GET" -Uri "$Base/api/v1/agent/whoami" -Headers $Headers
  if ([string]::IsNullOrWhiteSpace([string]$Response.Body)) { throw "whoami returned an empty response" }
  return ([string]$Response.Body | ConvertFrom-Json)
}

function Write-ActingIdentity {
  $Identity = Get-ActingIdentity
  Write-Host "api-base=$Base"
  Write-Host "acting-as-role-id=$($Identity.roleId)"
  Write-Host "acting-as-user-id=$($Identity.userId)"
  Write-Host "acting-as-username=$($Identity.username)"
  if ($Identity.accountSystem) { Write-Host "acting-as-account-system=$($Identity.accountSystem)" }
}

function Write-PublishPreflight {
  param([string]$Action, [string]$Target)
  Write-ActingIdentity
  Write-Host "action=$Action"
  Write-Host "target-game=$Target"
}

# Get-EngineValue 静默判定引擎（小写，与后端/协议口径一致）：godot 优先；
# unity = ProjectSettings/ProjectVersion.txt 或 Assets/+Packages/manifest.json；
# HTML5 = 根目录有 index.html 或 package.json。
function Get-EngineValue {
  param([string]$Dir = ".")
  if (Test-Path (Join-Path $Dir "project.godot")) { return "godot" }
  if ((Test-Path (Join-Path $Dir "ProjectSettings/ProjectVersion.txt")) -or ((Test-Path (Join-Path $Dir "Assets")) -and (Test-Path (Join-Path $Dir "Packages/manifest.json")))) { return "unity" }
  if ((Test-Path (Join-Path $Dir "index.html")) -or (Test-Path (Join-Path $Dir "package.json"))) { return "h5" }
  return "unknown"
}

# Get-ManifestEngine 引擎单一来源：manifest engine 字段优先，缺失按目录判定，非法兜底 godot
function Get-ManifestEngine {
  param([string]$File = $Manifest)
  $V = ""
  if (Test-Path $File) {
    try {
      $Data = Read-Utf8Text $File | ConvertFrom-Json
      if ($Data.engine) { $V = [string]$Data.engine }
    } catch {}
  }
  if (!$V) { $V = Get-EngineValue "." }
  if ($V -notin @("godot", "h5", "unity")) { $V = "godot" }
  return $V
}

function Invoke-EngineDetect {
  param([string]$Dir = ".")
  if (!(Test-Path $Dir -PathType Container)) {
    Write-Host "engine-detect=failed"
    throw "directory not found: $Dir"
  }
  $Engine = Get-EngineValue $Dir
  Write-Host "engine=$Engine"
  switch ($Engine) {
    { $_ -in @("godot", "h5", "unity") } {
      Write-Host "engine-upload-support=available"
      return
    }
    default {
      Write-Host "engine-upload-support=unknown"
      Write-Error "Project engine could not be detected. Do not upload until the user points you at a Godot, HTML5 or Unity project root."
      exit 1
    }
  }
}

function Show-AuthFailureHint {
  Write-Error "auth-required=1"
  if (Test-Path $RefreshPath) {
    Write-Error "Agent grant is missing or expired. Retry the failed command; saved agent authorization refreshes it automatically when still valid."
  } else {
    Write-Error "Agent grant is missing or expired. Run: builda auth"
  }
}

function Get-StubBody {
  @(
    "本项目已安装项目级 BuildaGame 工具链（发布 Godot Web / HTML5 / Unity WebGL 游戏到 Builda）。工具、说明书、SDK 全部随项目走，同一版本号："
    ""
    '1. 完整说明书（先读）：项目根的 `.builda-agent/SKILL.md`'
    '2. 每次任务开始先跑：`./.builda-agent/builda check`（自动对齐工具链版本，并提示 SDK 是否需要同步）'
    ""
    "若上述文件缺失（例如刚 clone 本仓库），在项目根目录重装："
    ""
    '```bash'
    "curl -fsSL $AgentBase/agent/install.sh | bash"
    '```'
    ''
    'Windows（下载为文件，禁止 `iwr | iex`）：'
    ''
    '```powershell'
    ('$p = Join-Path $env:TEMP "builda-install.ps1"; iwr ' + $AgentBase + '/agent/install.ps1 -UseBasicParsing -OutFile $p; & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $p; Remove-Item -Force $p -ErrorAction SilentlyContinue')
    '```'
  ) -join "`n"
}

function Write-StateGitignore {
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  $Content = @'
# BuildaGame 自动管理：仅敏感或可再生运行态不入库。
# builda/builda.ps1/builda.cmd、SKILL.md、VERSION、game.json 与 sdk-version 入库。
AGENT_INSTALL.md
publish.env
md_*.md
last-*
sdk/
tools/
token
refresh-token
'@
  Write-Utf8TextNoBom (Join-Path $Root ".gitignore") $Content
}

$AgentsBlockBegin = "<!-- BEGIN builda (auto-managed) -->"
$AgentsBlockEnd = "<!-- END builda -->"
# 多引擎化前的旧标记块（builda-godot）：写新块前先清掉，避免双块并存
$LegacyAgentsBlockBegin = "<!-- BEGIN builda-godot (auto-managed) -->"
$LegacyAgentsBlockEnd = "<!-- END builda-godot -->"

function Remove-AgentsMdBlockByMarkers {
  param([string]$Begin, [string]$End)
  $Path = "AGENTS.md"
  if (!(Test-Path $Path)) { return $false }
  $Content = Read-Utf8Text $Path
  if ($Content -notlike "*$Begin*") { return $false }
  $Pattern = "(?ms)^$([regex]::Escape($Begin))\r?\n.*?^$([regex]::Escape($End))\r?\n?"
  $Content = [regex]::Replace($Content, $Pattern, "")
  Write-Utf8TextNoBom $Path $Content
  return $true
}

function Write-AgentsMdBlock {
  $Path = "AGENTS.md"
  Remove-AgentsMdBlockByMarkers $LegacyAgentsBlockBegin $LegacyAgentsBlockEnd | Out-Null
  if ((Test-Path $Path) -and ((Read-Utf8Text $Path) -like "*$AgentsBlockBegin*")) { return }
  $Prefix = if ((Test-Path $Path) -and (Get-Item $Path).Length -gt 0) { "`n" } else { "" }
  $Block = "$AgentsBlockBegin`n## BuildaGame 发布工具（项目级）`n`n$(Get-StubBody)`n$AgentsBlockEnd`n"
  Append-Utf8TextNoBom $Path "$Prefix$Block"
}

function Remove-AgentsMdBlock {
  if (Remove-AgentsMdBlockByMarkers $LegacyAgentsBlockBegin $LegacyAgentsBlockEnd) { Write-Host "removed=AGENTS.md builda-godot block" }
  if (Remove-AgentsMdBlockByMarkers $AgentsBlockBegin $AgentsBlockEnd) { Write-Host "removed=AGENTS.md builda block" }
}

function Write-AgentInstallMd {
  $Content = @"
# BuildaGame Agent Installed (project-scoped)

Runtime (all inside this project):

- CLI: ./.builda-agent/builda
- Skill: ./.builda-agent/SKILL.md
- Env: ./.builda-agent/publish.env
- Installed version: $Version (CLI/skill/SDK share this single version)

Credentials stay per-user in `$HOME/.builda-agent/ (token / refresh-token only).

Next for SDK-only tasks:

    ./.builda-agent/builda check
    ./.builda-agent/builda auth
    ./.builda-agent/builda sdk install
    ./.builda-agent/builda sdk check
    ./.builda-agent/builda sdk smoke

Next for upload-draft tasks:

    ./.builda-agent/builda check
    ./.builda-agent/builda auth

Game identity lives in ./.builda-agent/game.json (committed with the project).
"@
  Write-Utf8TextNoBom (Join-Path $Root "AGENT_INSTALL.md") $Content
}

function Remove-LegacyProjectStubs {
  # 多引擎化前的旧 stub 名（builda-godot）：每次同步注册时顺手清理，避免双注册
  foreach ($Path in @(".claude/skills/builda-godot", ".cursor/rules/builda-godot.mdc", ".clinerules/builda-godot.md", ".roo/rules/builda-godot.md", ".windsurf/rules/builda-godot.md")) {
    if (Test-Path $Path) { Remove-Item -Recurse -Force $Path -ErrorAction SilentlyContinue }
  }
}

function Sync-ProjectRegistrations {
  $Registrations = New-Object System.Collections.Generic.List[string]
  Write-StateGitignore
  Write-AgentInstallMd
  Remove-LegacyProjectStubs
  Write-AgentsMdBlock
  $Registrations.Add("AGENTS.md: builda block")

  $ClaudeHome = Join-Path $HOME ".claude"
  if ((Test-Path $ClaudeHome) -or (Test-Path ".claude")) {
    $ClaudeSkillRoot = ".claude/skills/builda"
    New-Item -ItemType Directory -Force -Path $ClaudeSkillRoot | Out-Null
    Write-Utf8TextNoBom (Join-Path $ClaudeSkillRoot "SKILL.md") "---`nname: builda`ndescription: BuildaGame（Builda）游戏发布工具链：接入 Builda SDK、本地 mock 调试、导出 Godot Web / Unity WebGL 或打包 HTML5 构建、上传/更新游戏草稿。`n---`n`n$(Get-StubBody)`n"
    $Registrations.Add("Claude Code: .claude/skills/builda/SKILL.md")
  }

  $CursorHome = Join-Path $HOME ".cursor"
  if ((Test-Path $CursorHome) -or (Test-Path ".cursor")) {
    $CursorRuleRoot = ".cursor/rules"
    New-Item -ItemType Directory -Force -Path $CursorRuleRoot | Out-Null
    $CursorRulePath = Join-Path $CursorRuleRoot "builda.mdc"
    Write-Utf8TextNoBom $CursorRulePath "---`ndescription: BuildaGame skill`nalwaysApply: false`n---`n`n$(Get-StubBody)`n"
    $Registrations.Add("Cursor: .cursor/rules/builda.mdc")
  }

  $ClineGlobalRoot = Join-Path $HOME "Documents\Cline\Rules"
  if ((Test-Path ".clinerules") -or (Test-Path $ClineGlobalRoot)) {
    New-Item -ItemType Directory -Force -Path ".clinerules" | Out-Null
    Write-Utf8TextNoBom ".clinerules/builda.md" "$(Get-StubBody)`n"
    $Registrations.Add("Cline: .clinerules/builda.md")
  }

  if ((Test-Path ".roo") -or (Test-Path ".roo/rules")) {
    $RooRulesRoot = ".roo/rules"
    New-Item -ItemType Directory -Force -Path $RooRulesRoot | Out-Null
    $RooRulePath = Join-Path $RooRulesRoot "builda.md"
    Write-Utf8TextNoBom $RooRulePath "$(Get-StubBody)`n"
    $Registrations.Add("Roo Code: .roo/rules/builda.md")
  }

  if ((Test-Path ".windsurf") -or (Test-Path ".windsurf/rules")) {
    $WindsurfRulesRoot = ".windsurf/rules"
    New-Item -ItemType Directory -Force -Path $WindsurfRulesRoot | Out-Null
    $WindsurfRulePath = Join-Path $WindsurfRulesRoot "builda.md"
    Write-Utf8TextNoBom $WindsurfRulePath "---`ndescription: BuildaGame skill`nalwaysApply: false`n---`n`n$(Get-StubBody)`n"
    $Registrations.Add("Windsurf: .windsurf/rules/builda.md")
  }

  foreach ($Registration in $Registrations) { Write-Host "- $Registration" }
}

function Remove-IfExists {
  param([string]$Path)
  if (Test-Path $Path) {
    Remove-Item -Recurse -Force $Path
    Write-Host "removed=$Path"
  }
}

function Remove-LegacyGlobalRegistrations {
  $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
  Remove-IfExists (Join-Path $CodexHome "skills/builda-godot")
  Remove-IfExists (Join-Path $HOME ".claude/skills/builda-godot")
  Remove-IfExists (Join-Path $HOME ".cursor/rules/builda-godot.mdc")
  Remove-IfExists (Join-Path $HOME "Documents/Cline/Rules/builda-godot.md")
}

function Invoke-LegacyHomeMigrate {
  param([string[]]$OriginalArgs)
  $TargetRoot = Join-Path (Get-Location).Path $ProjectStateDir
  [Console]::Error.WriteLine('layout-migration=required (toolchain moved from $HOME to per-project)')
  if (((Get-Location).Path -eq [System.IO.Path]::GetFullPath($HOME)) -or ([System.IO.Path]::GetFullPath($TargetRoot) -eq $SelfDir)) {
    [Console]::Error.WriteLine("BuildaGame 工具链已改为项目级：请先 cd 到游戏项目根目录，再重跑原命令，")
    [Console]::Error.WriteLine('迁移会自动完成（凭证仍留在 $HOME 的凭证目录）。')
    exit 1
  }
  New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
  foreach ($Name in @("builda.ps1", "SKILL.md", "VERSION", "publish.env")) {
    $Source = Join-Path $SelfDir $Name
    if (Test-Path $Source) { Copy-Item -Force $Source (Join-Path $TargetRoot $Name) }
  }
  Sync-ProjectRegistrations *> $null
  foreach ($Name in @("builda", "builda.ps1", "builda.cmd", "SKILL.md", "VERSION", "AGENT_INSTALL.md", "publish.env", "md_cysj_app.md", "md_cjk_font.md", "md_mobile_perf.md", "last-build.json", "last-assets.json", "last-draft.json", "last-game-id", "last-draft-id", "last-version-id")) {
    $Path = Join-Path $SelfDir $Name
    if (Test-Path $Path) { Remove-Item -Force -Recurse $Path }
  }
  Remove-LegacyGlobalRegistrations
  [Console]::Error.WriteLine("layout-migration=done target=$TargetRoot (credentials kept in $AuthDir)")
  & (Join-Path $TargetRoot "builda.ps1") @OriginalArgs
  exit $LASTEXITCODE
}

function Invoke-LegacyProjectDirMigrate {
  # 本体躺在旧命名的项目目录 .builda-godot-agent/：搬进 .builda-agent/、重写 stub、删旧目录、接力原命令
  param([string[]]$OriginalArgs)
  $TargetRoot = Join-Path (Get-Location).Path $ProjectStateDir
  [Console]::Error.WriteLine("layout-migration=required (toolchain dir renamed $LegacyProjectStateDir -> $ProjectStateDir)")
  $Expected = Join-Path (Get-Location).Path $LegacyProjectStateDir
  $Resolved = if (Test-Path $Expected) { (Resolve-Path $Expected).Path } else { "" }
  if ($Resolved -ne $SelfDir) {
    [Console]::Error.WriteLine("run-from=project-root-required")
    [Console]::Error.WriteLine("本 CLI 是项目级工具，必须在它所属的项目根目录运行迁移：")
    [Console]::Error.WriteLine("  cd $(Split-Path -Parent $SelfDir) && ./$LegacyProjectStateDir/builda.ps1 <command>")
    exit 1
  }
  New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
  foreach ($Name in @("builda", "builda.ps1", "builda.cmd", "SKILL.md", "VERSION", "publish.env", "game.json", "sdk-version",
                      "last-build.json", "last-assets.json", "last-draft.json", "last-game-id", "last-draft-id", "last-version-id",
                      "md_cysj_app.md", "md_cjk_font.md", "md_mobile_perf.md", "md_rankboards.md")) {
    $Source = Join-Path $SelfDir $Name
    if (Test-Path $Source) { Copy-Item -Force $Source (Join-Path $TargetRoot $Name) }
  }
  $SdkDir = Join-Path $SelfDir "sdk"
  if (Test-Path $SdkDir) { Copy-Item -Recurse -Force $SdkDir (Join-Path $TargetRoot "sdk") }
  Sync-ProjectRegistrations *> $null
  Remove-Item -Recurse -Force $SelfDir
  [Console]::Error.WriteLine("layout-migration=done target=$TargetRoot")
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $TargetRoot "builda.ps1") @OriginalArgs
  exit $LASTEXITCODE
}

function Invoke-LegacyAuthMigrate {
  # 凭证目录改名迁移：复制不删除——旧 CLI 仍读旧目录；uninstall --purge 两代一起清
  if ($env:BUILDA_AUTH_DIR) { return }
  if (Test-Path $TokenPath) { return }
  $LegacyToken = Join-Path $LegacyAuthDir "token"
  if (!(Test-Path $LegacyToken)) { return }
  New-Item -ItemType Directory -Force -Path $AuthDir | Out-Null
  Copy-Item -Force $LegacyToken $TokenPath
  $LegacyRefresh = Join-Path $LegacyAuthDir "refresh-token"
  if ((Test-Path $LegacyRefresh) -and !(Test-Path $RefreshPath)) { Copy-Item -Force $LegacyRefresh $RefreshPath }
  [Console]::Error.WriteLine("auth-migration=copied credentials $LegacyAuthDir -> $AuthDir (legacy kept for old CLIs)")
}

function Require-ProjectContext {
  param([string[]]$OriginalArgs)
  if (!$env:BUILDA_AUTH_DIR -and (($SelfDir -eq [System.IO.Path]::GetFullPath($UserAuthDir)) -or ($SelfDir -eq [System.IO.Path]::GetFullPath($LegacyAuthDir)))) { Invoke-LegacyHomeMigrate $OriginalArgs }
  if (((Split-Path -Leaf $SelfDir) -eq $LegacyProjectStateDir) -and ($ProjectStateDir -ne $LegacyProjectStateDir)) {
    Invoke-LegacyProjectDirMigrate $OriginalArgs
  }
  $Expected = Join-Path (Get-Location).Path $ProjectStateDir
  $Resolved = if (Test-Path $Expected) { (Resolve-Path $Expected).Path } else { "" }
  if ($Resolved -ne $SelfDir) {
    [Console]::Error.WriteLine("run-from=project-root-required")
    [Console]::Error.WriteLine("本 CLI 是项目级工具，必须在它所属的项目根目录运行：")
    [Console]::Error.WriteLine("  cd $(Split-Path -Parent $SelfDir) && ./$ProjectStateDir/builda.ps1 <command>")
    exit 1
  }
}

function Invoke-Uninstall {
  param([string[]]$Options)
  $Purge = $false
  if ($Options.Count -gt 0) {
    if ($Options[0] -eq "--purge") {
      $Purge = $true
    } elseif ($Options[0] -eq "-h" -or $Options[0] -eq "--help" -or $Options[0] -eq "help") {
      Write-Host "Usage: builda uninstall [--purge]"
      Write-Host "Default removes the project toolchain and agent registrations, keeps game.json/sdk-version"
      Write-Host 'and the per-user credentials in $HOME/.builda-agent/.'
      Write-Host "--purge also removes the whole $Root directory AND per-user credentials"
      Write-Host "(credentials are shared by every project on this machine)."
      return
    } else {
      throw "unknown uninstall option: $($Options[0])"
    }
  }

  Remove-IfExists ".claude/skills/builda"
  Remove-IfExists ".cursor/rules/builda.mdc"
  Remove-IfExists ".clinerules/builda.md"
  Remove-IfExists ".roo/rules/builda.md"
  Remove-IfExists ".windsurf/rules/builda.md"
  Remove-IfExists ".claude/skills/builda-godot"
  Remove-IfExists ".cursor/rules/builda-godot.mdc"
  Remove-IfExists ".clinerules/builda-godot.md"
  Remove-IfExists ".roo/rules/builda-godot.md"
  Remove-IfExists ".windsurf/rules/builda-godot.md"
  Remove-AgentsMdBlock
  Remove-LegacyGlobalRegistrations

  if ($Purge) {
    Remove-IfExists $TokenPath
    Remove-IfExists $RefreshPath
    Remove-IfExists $Root
    Remove-IfExists $LegacyProjectStateDir
    Remove-IfExists (Join-Path $LegacyAuthDir "token")
    Remove-IfExists (Join-Path $LegacyAuthDir "refresh-token")
    Write-Host "uninstall=ok"
    Write-Host "uninstall-mode=purge (credentials removed for ALL projects on this machine)"
    return
  }

  Remove-IfExists (Join-Path $Root "SKILL.md")
  Remove-IfExists (Join-Path $Root "md_cysj_app.md")
  Remove-IfExists (Join-Path $Root "md_cjk_font.md")
  Remove-IfExists (Join-Path $Root "md_mobile_perf.md")
  Remove-IfExists (Join-Path $Root "builda")
  Remove-IfExists (Join-Path $Root "builda.ps1")
  Remove-IfExists (Join-Path $Root "builda.cmd")
  Remove-IfExists (Join-Path $Root "VERSION")
  Remove-IfExists (Join-Path $Root "AGENT_INSTALL.md")
  Remove-IfExists (Join-Path $Root "publish.env")
  foreach ($Name in @("last-build.json", "last-assets.json", "last-draft.json", "last-game-id", "last-draft-id", "last-version-id")) { Remove-IfExists (Join-Path $Root $Name) }
  Write-Host "uninstall=ok"
  Write-Host "uninstall-mode=keep-project-data (game.json/sdk-version and credentials kept)"
  if (Test-Path $TokenPath) { Write-Host "grant=kept" }
  if (Test-Path $RefreshPath) { Write-Host "agent-authorization=kept" }
}

function Update-BuildaTool {
  param([string]$NewVersion = $Version)
  $ReleaseBase = "$AgentBase/agent/releases/$NewVersion"
  try {
    Install-BuildaWindowsToolchain -Root $Root -ReleaseBase $ReleaseBase -ExpectedVersion $NewVersion
  } catch {
    Write-Host "self-update=failed"
    throw
  }
  Write-Host "self-update=updated"
  $PreviousDisableAutoUpdate = $env:BUILDA_DISABLE_AUTO_UPDATE
  $env:BUILDA_DISABLE_AUTO_UPDATE = "1"
  try {
    & (Join-Path $Root "builda.cmd") sync-project
    if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("self-update-warning=tool updated but project registration sync failed; rerun .builda-agent\builda.cmd sync-project") }
  } finally {
    if ($null -eq $PreviousDisableAutoUpdate) {
      Remove-Item Env:BUILDA_DISABLE_AUTO_UPDATE -ErrorAction SilentlyContinue
    } else {
      $env:BUILDA_DISABLE_AUTO_UPDATE = $PreviousDisableAutoUpdate
    }
  }
}

function Test-BuildaToolchainCurrent {
  param([string]$ExpectedVersion)
  foreach ($Name in @("builda", "builda.ps1", "builda.cmd", "SKILL.md", "VERSION")) {
    if (!(Test-Path (Join-Path $Root $Name))) { return $false }
  }
  if (!(Test-WindowsPowerShellScriptBom (Join-Path $Root "builda.ps1"))) { return $false }
  if ((Read-Utf8Text (Join-Path $Root "VERSION")).Trim() -ne $ExpectedVersion) { return $false }
  if ((Read-Utf8Text (Join-Path $Root "SKILL.md")) -notlike "*BuildaGame agent 工具链版本：$ExpectedVersion*") { return $false }
  $CmdText = Read-Utf8Text (Join-Path $Root "builda.cmd")
  return $CmdText -like '*%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe*' -and $CmdText -like '*"%~dp0builda.ps1" %**'
}

function Check-SelfUpdate {
  Write-Host "builda-version=$Version"
  Write-Host "toolchain-version=$Version"
  $EffectiveVersion = $Version
  $RemoteFailure = ""
  try { $Remote = Get-BuildaRemoteJson -Uri "$AgentBase/agent/version" } catch { $Remote = $null; $RemoteFailure = $_.Exception.Message }
  $RemoteVersion = if ($Remote) { [string]$Remote.version } else { "" }
  if (!$RemoteVersion) {
    Write-Host "remote-version=unknown"
    Write-Host "self-update=skipped"
    [Console]::Error.WriteLine("self-update-warning=remote unavailable; existing toolchain kept; $RemoteFailure")
  } elseif ($RemoteVersion -ne $Version -or !(Test-BuildaToolchainCurrent $RemoteVersion)) {
    Write-Host "remote-version=$RemoteVersion"
    try {
      Update-BuildaTool -NewVersion $RemoteVersion
      $EffectiveVersion = $RemoteVersion
    } catch {
      [Console]::Error.WriteLine("self-update-warning=update validation failed; existing toolchain restored")
    }
  } else {
    Write-Host "remote-version=$RemoteVersion"
    Write-Host "self-update=current"
  }
  if (Test-Path (Join-Path $Root "SKILL.md")) { Write-Host "skill=installed" } else { Write-Host "skill=missing (run: builda update)" }
  if (Test-Path $SdkVersionFile) {
    $SdkVersion = (Read-Utf8Lines $SdkVersionFile | Select-Object -First 1).Trim()
    Write-Host "sdk-version=$SdkVersion"
    if ($SdkVersion -eq $EffectiveVersion) {
      Write-Host "sdk-sync=current"
    } else {
      Write-Host "sdk-sync=behind (SDK 与工具链同一版本号，对齐: builda sdk install)"
    }
  } elseif ((Test-Path "addons/builda") -or (Test-Path (Join-Path $ProjectStateDir "sdk/web"))) {
    Write-Host "sdk-version=unknown (missing $SdkVersionFile; run: builda sdk install)"
  } else {
    Write-Host "sdk=not-installed (仅上传任务可忽略；接 SDK 用: builda sdk install)"
  }
}

function Maybe-SelfUpdate {
  param([string[]]$OriginalArgs)
  $First = if ($OriginalArgs.Count -gt 0) { $OriginalArgs[0] } else { "" }
  if ($First -in @("", "-h", "--help", "help", "check", "update", "uninstall", "version", "--version", "-v")) { return }
  if ($env:BUILDA_DISABLE_AUTO_UPDATE -eq "1") { return }
  $UpdateAttempted = $false
  try {
    $Remote = Get-BuildaRemoteJson -Uri "$AgentBase/agent/version"
    $RemoteVersion = $Remote.version
    if ($RemoteVersion -and ($RemoteVersion -ne $Version -or !(Test-BuildaToolchainCurrent $RemoteVersion))) {
      $UpdateAttempted = $true
      [Console]::Error.WriteLine("self-update-required=1")
      Update-BuildaTool -NewVersion $RemoteVersion
      [Console]::Error.WriteLine("builda-agent-skill-updated=1")
      [Console]::Error.WriteLine("action=rerun-current-command-with-updated-cli-and-reread-skill")
      & (Join-Path $Root "builda.cmd") @OriginalArgs
      exit $LASTEXITCODE
    }
  } catch {
    if ($UpdateAttempted) {
      [Console]::Error.WriteLine("self-update-warning=update failed; existing toolchain restored")
    } else {
      [Console]::Error.WriteLine("self-update=skipped warning=remote unavailable; existing toolchain kept")
    }
  }
}

function Get-ProjectGameId {
  Migrate-LegacyProjectFile
  if (!(Test-Path $ProjectFile)) { return "" }
  try {
    $Data = Read-Utf8Text $ProjectFile | ConvertFrom-Json
    if ($Data.gameId) { return [string]$Data.gameId }
  } catch {
    return ""
  }
  return ""
}

function Migrate-LegacyProjectFile {
  if (!(Test-Path $ProjectFile) -and (Test-Path $LegacyProjectFile)) {
    $Parent = Split-Path -Parent $ProjectFile
    if ($Parent) {
      New-Item -ItemType Directory -Force -Path $Parent | Out-Null
    }
    Copy-Item -Force $LegacyProjectFile $ProjectFile
  }
}

function Get-ManifestTitle {
  param([string]$Path)
  if (!(Test-Path $Path)) { return "" }
  try {
    $Data = Read-Utf8Text $Path | ConvertFrom-Json
    if ($Data.title) { return [string]$Data.title }
  } catch {
    return ""
  }
  return ""
}

function Write-ProjectGame {
  param([string]$GameId, [string]$Title = "", [string]$VersionId = "")
  if (!$GameId) { return }
  $Parent = Split-Path -Parent $ProjectFile
  if ($Parent) {
    New-Item -ItemType Directory -Force -Path $Parent | Out-Null
  }
  $Data = @{
    provider = "builda-h5"
    gameId = $GameId
    title = $Title
    lastVersionId = $VersionId
    updatedAt = [int64](([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()))
  }
  $Content = $Data | ConvertTo-Json -Depth 8
  Write-Utf8TextNoBom $ProjectFile $Content
  Write-Host "project-binding=$ProjectFile"
}

function Write-DefaultManifest {
  if (Test-Path $Manifest) {
    Write-Host "$Manifest already exists"
    return
  }
  # engine 按目录判定写入 manifest；unknown 兜底 godot（与后端"空=godot"口径一致）
  $DetectedEngine = Get-EngineValue "."
  if ($DetectedEngine -notin @("godot", "h5", "unity")) { $DetectedEngine = "godot" }
  $Data = @{
    title = "Your game"
    tagline = "One short sentence about the game."
    desc = "What players should know before playing."
    category = ""
    engine = $DetectedEngine
    tags = @($DetectedEngine)
    orientation = "landscape"
    minChromeMajor = 0
    minIOSMajor = 0
    coverKind = "palette"
    coverPalette = "ember"
    coverUrl = ""
    buildPrefix = ""
    buildEntry = "index.html"
    buildSize = 0
    bundleUrl = ""
    bundleMd5 = ""
    bundleVersion = ""
    bundleEntry = "index.html"
    bundleSize = 0
    assetsVersion = ""
    assetsBaseUrl = ""
    assetsManifestUrl = ""
  }
  Write-Utf8TextNoBom $Manifest ($Data | ConvertTo-Json -Depth 8)
  Write-Host 'For in-app purchases, add payPoints only when needed, for example:'
  Write-Host '  "payPoints": [{"payId":"coin_pack_1","payName":"Coins Pack","price":100}]'
  Write-Host 'Omit payPoints entirely for games without purchases; do not write an empty array.'
  Write-Host 'For leaderboards, omit rankBoards to keep existing boards; use [] only to clear all boards.'
  Write-Host '  "rankBoards": [{"rankId":"high_score","displayName":"High Score","sortType":"desc","cycleType":"forever","minScore":0,"maxScore":9999999999}]'
  Write-Host 'category is required: choose exactly one of the 28 values documented in .builda-agent/SKILL.md; do not invent a value or change its case.'
  Write-Host 'minChromeMajor/minIOSMajor gate which devices may play: fill the LOWEST browser majors the build actually runs on (lower = more players; the 0 placeholders are rejected until you assess and fill them).'
  Write-Host 'Judge by what the build really requires: WASM engine exports (e.g. Godot 4 Web, Unity WebGL) inherit their floor from the compiler toolchain (post-MVP WASM features land around Chrome 75-85 / iOS 15) - check the engine or Emscripten minimum-browser docs, and fall back to the platform baseline 80/15 when you cannot verify lower; plain canvas/DOM H5 with down-leveled JS can go much lower. Do not inflate the values, and do not claim majors the build cannot actually run on.'
  Write-Host "Wrote $Manifest"
}

function Assert-ManifestPayPoints {
  param([string]$File)
  if (!(Test-Path $File)) { return }
  try {
    $Data = Read-Utf8Text $File | ConvertFrom-Json
  } catch {
    throw "manifest json invalid: $File"
  }
  $Names = @($Data.PSObject.Properties.Name)
  if ($Names -notcontains "payPoints") { return }
  $Points = @($Data.payPoints)
  if ($null -eq $Data.payPoints -or $Points.Count -eq 0) {
    throw "payPoints must be omitted for games without in-app purchases; do not send an empty array."
  }
  $Seen = @{}
  for ($I = 0; $I -lt $Points.Count; $I++) {
    $Point = $Points[$I]
    if ($null -eq $Point) { throw "payPoints[$I] must be an object with payId/payName/price." }
    if ($Point.payId -isnot [string]) { throw "payPoints[$I].payId must be a string matching [A-Za-z0-9_-] with 1-64 bytes." }
    $PayId = $Point.payId
    $PayName = [string]$Point.payName
    if ([string]::IsNullOrWhiteSpace($PayId)) { throw "payPoints[$I].payId is required." }
    if ($PayId -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw "payPoints[$I].payId must match [A-Za-z0-9_-] and be 1-64 bytes." }
    if ($Seen.ContainsKey($PayId)) { throw "payPoints payId duplicated: $PayId" }
    $Seen[$PayId] = $true
    if ([string]::IsNullOrWhiteSpace($PayName)) { throw "payPoints[$I].payName is required." }
    if ($null -eq $Point.price -or $Point.price -isnot [int]) { throw "payPoints[$I].price must be an integer G-coin amount." }
    if ($Point.price -lt 100) { throw "payPoints[$I].price must be at least 100 G-coins." }
  }
}

function Assert-ManifestMetadata {
  param([string]$File)
  if (!(Test-Path $File)) { throw "manifest not found: $File" }
  try {
    $Data = Read-Utf8Text $File | ConvertFrom-Json
    $Contract = '{"categories":["action","strategy","rolePlay","plot","adventure","sandBox","survival","pzzle","mystery","leisure","simulation","yangCheng","card","desktop","tower","rogueLike","shoot","speed","sport","fangZhi","music","dress","other","cooperation","moba","asymmetric","party","fight"],"coverKinds":["palette","image"],"engines":["godot","h5","unity"],"limits":{"descriptionBytes":600,"taglineBytes":90,"tags":5,"titleBytes":48},"orientations":["landscape","portrait"]}' | ConvertFrom-Json
  } catch {
    throw "manifest json invalid: $File"
  }
  if ($null -eq $Data -or $Data -isnot [pscustomobject]) { throw "builda.publish.json must contain a JSON object." }
  $Limits = $Contract.limits
  foreach ($Field in @(
    @("title", $Limits.titleBytes, $true),
    @("tagline", $Limits.taglineBytes, $false),
    @("desc", $Limits.descriptionBytes, $false)
  )) {
    $Name, $MaxBytes, $Required = $Field
    $Value = $Data.$Name
    if ($Value -isnot [string]) { throw "$Name must be a string." }
    if ($Required -and !$Value) { throw "$Name is required." }
    if ([Text.Encoding]::UTF8.GetByteCount($Value) -gt $MaxBytes) { throw "$Name must be at most $MaxBytes UTF-8 bytes." }
  }
  foreach ($Field in @(
    @("category", "categories"),
    @("orientation", "orientations"),
    @("coverKind", "coverKinds")
  )) {
    $Name, $ContractName = $Field
    $Value = $Data.$Name
    $Allowed = @($Contract.$ContractName)
    if ($Value -isnot [string] -or $Allowed -notcontains $Value) {
      throw "$Name must be one of: $($Allowed -join ', '); got '$Value'."
    }
  }
  if ($null -ne $Data.engine -and ($Data.engine -isnot [string] -or ($Data.engine -and @($Contract.engines) -notcontains $Data.engine))) {
    throw "engine must be one of: $(@($Contract.engines) -join ', '); got '$($Data.engine)'."
  }
  $Tags = @($Data.tags)
  if ($null -ne $Data.tags -and $Data.tags -isnot [array]) { throw "tags must be an array of strings." }
  foreach ($Tag in $Tags) { if ($Tag -isnot [string]) { throw "tags must be an array of strings." } }
  if ($Tags.Count -gt $Limits.tags) { throw "tags supports at most $($Limits.tags) entries." }
}

function Normalize-ManifestCategory {
  param([string]$File)
  if (!(Test-Path $File)) { throw "manifest not found: $File" }
  try {
    $Data = Read-Utf8Text $File | ConvertFrom-Json
    $Contract = '{"categories":["action","strategy","rolePlay","plot","adventure","sandBox","survival","pzzle","mystery","leisure","simulation","yangCheng","card","desktop","tower","rogueLike","shoot","speed","sport","fangZhi","music","dress","other","cooperation","moba","asymmetric","party","fight"],"coverKinds":["palette","image"],"engines":["godot","h5","unity"],"limits":{"descriptionBytes":600,"taglineBytes":90,"tags":5,"titleBytes":48},"orientations":["landscape","portrait"]}' | ConvertFrom-Json
  } catch {
    throw "manifest json invalid: $File"
  }
  $Category = $Data.category
  if ($Category -isnot [string] -or !$Category) { return }
  if (@($Contract.categories) -contains $Category) { return }
  $Data.category = "other"
  Write-Utf8TextNoBom $File ($Data | ConvertTo-Json -Depth 16)
  Write-Host "category='$Category' normalized to other"
}

function ConvertTo-ManifestSafeInteger {
  param($Value, [string]$Field)
  $IsIntegral = $Value -is [sbyte] -or $Value -is [byte] -or
    $Value -is [int16] -or $Value -is [uint16] -or
    $Value -is [int32] -or $Value -is [uint32] -or
    $Value -is [int64] -or $Value -is [uint64]
  if (!$IsIntegral) { throw "$Field must be an integer." }
  $Number = [decimal]$Value
  if ([decimal]::Truncate($Number) -ne $Number) { throw "$Field must be an integer." }
  if ($Number -lt -9999999999 -or $Number -gt 9999999999) {
    throw "$Field must be within the supported range [-9999999999, 9999999999]."
  }
  return [int64]$Number
}

function Assert-ManifestRankBoards {
  param([string]$File)
  if (!(Test-Path $File)) { return }
  try {
    $Data = Read-Utf8Text $File | ConvertFrom-Json
  } catch {
    throw "manifest json invalid: $File"
  }
  $Names = @($Data.PSObject.Properties.Name)
  if ($Names -notcontains "rankBoards") { return }
  if ($null -eq $Data.rankBoards) {
    throw "rankBoards must be an array; omit it to keep existing boards or use [] to clear all boards."
  }
  if ($Data.rankBoards -isnot [array]) {
    throw "rankBoards must be an array; omit it to keep existing boards or use [] to clear all boards."
  }
  $Boards = @($Data.rankBoards)
  if ($Boards.Count -gt 100) { throw "rankBoards supports at most 100 boards." }
  $Required = @("rankId", "displayName", "sortType", "cycleType", "minScore", "maxScore")
  $Seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  for ($I = 0; $I -lt $Boards.Count; $I++) {
    $Board = $Boards[$I]
    if ($null -eq $Board -or $Board -isnot [pscustomobject]) {
      throw "rankBoards[$I] must be an object with all six fields."
    }
    $BoardNames = @($Board.PSObject.Properties.Name)
    foreach ($Field in $Required) {
      if ($BoardNames -notcontains $Field) { throw "rankBoards[$I] missing required field: $Field" }
    }
    if ($Board.rankId -isnot [string]) { throw "rankBoards[$I].rankId must be a string." }
    if ($Board.displayName -isnot [string]) { throw "rankBoards[$I].displayName must be a string." }
    if ($Board.sortType -isnot [string]) { throw "rankBoards[$I].sortType must be a string." }
    if ($Board.cycleType -isnot [string]) { throw "rankBoards[$I].cycleType must be a string." }
    $RankId = $Board.rankId
    $DisplayName = $Board.displayName
    $SortType = $Board.sortType
    $CycleType = $Board.cycleType
    if ($RankId -ne $RankId.Trim() -or $RankId -notmatch '^[A-Za-z0-9_-]{1,64}$') {
      throw "rankBoards[$I].rankId must match [A-Za-z0-9_-] and be 1-64 bytes without surrounding whitespace."
    }
    if (!$Seen.Add($RankId)) { throw "rankBoards rankId duplicated: $RankId" }
    if ([string]::IsNullOrWhiteSpace($DisplayName) -or $DisplayName -ne $DisplayName.Trim() -or [Text.Encoding]::UTF8.GetByteCount($DisplayName) -gt 64) {
      throw "rankBoards[$I].displayName must be non-empty UTF-8 up to 64 bytes without surrounding whitespace."
    }
    if ($SortType -notin @("asc", "desc")) { throw "rankBoards[$I].sortType must be asc or desc." }
    if ($CycleType -notin @("day", "week", "month", "forever")) { throw "rankBoards[$I].cycleType must be day, week, month, or forever." }
    $MinScore = ConvertTo-ManifestSafeInteger $Board.minScore "rankBoards[$I].minScore"
    $MaxScore = ConvertTo-ManifestSafeInteger $Board.maxScore "rankBoards[$I].maxScore"
    if ($MinScore -gt $MaxScore) { throw "rankBoards[$I].minScore must not exceed maxScore." }
  }
}

function Assert-ManifestBrowserMinimums {
  param([string]$File)
  if (!(Test-Path $File)) { throw "manifest not found: $File" }
  try {
    $Data = Read-Utf8Text $File | ConvertFrom-Json
  } catch {
    throw "manifest json invalid: $File"
  }
  $Names = @($Data.PSObject.Properties.Name)
  foreach ($Key in @("minChromeMajor", "minIOSMajor")) {
    $Bad = $true
    if ($Names -contains $Key) {
      try {
        $Value = ConvertTo-ManifestSafeInteger $Data.$Key $Key
        if ($Value -gt 0) { $Bad = $false }
      } catch { }
    }
    if ($Bad) {
      throw "Fill minChromeMajor and minIOSMajor in $File as positive integers: the LOWEST Chrome major and Safari iOS major this build actually runs on. Lower values let more devices play, so do not inflate them; but ground the floor in evidence: WASM engine exports (e.g. Godot 4 Web) inherit it from the compiler toolchain (post-MVP WASM features land around Chrome 75-85 / iOS 15; check engine or Emscripten minimum-browser docs, fall back to the platform baseline 80/15 when unverifiable), while plain canvas/DOM H5 with down-leveled JS can go much lower. Then rerun this command."
    }
  }
}

function Set-ManifestSdkVersion {
  param([string]$File)
  # sdkVersion 跟随项目 SDK 安装收据，草稿上报后进 release manifest sdk 契约；不要手工维护
  if (!(Test-Path $SdkVersionFile)) { return }
  $V = (Read-Utf8Lines $SdkVersionFile | Select-Object -First 1).Trim()
  if (!$V) { return }
  try {
    $Data = Read-Utf8Text $File | ConvertFrom-Json
    $Data | Add-Member -NotePropertyName sdkVersion -NotePropertyValue $V -Force
    Write-Utf8TextNoBom $File ($Data | ConvertTo-Json -Depth 16)
  } catch {
    Write-Host "sdk-version-inject=skipped ($($_.Exception.Message))"
  }
}

function Invoke-DraftPreflight {
  param([string]$File)
  try {
    Normalize-ManifestCategory $File
    Assert-ManifestMetadata $File
    Assert-ManifestPayPoints $File
    Assert-ManifestRankBoards $File
    Assert-ManifestBrowserMinimums $File
  } catch {
    [Console]::Error.WriteLine("draft-preflight=failed")
    throw
  }
}

function Sync-OnlineCompatibilityRevision {
  param([string]$File)
  $OnlineFile = Join-Path (Get-Location) "builda.online.json"
  if (!(Test-Path $OnlineFile)) { return }
  try {
    $Online = Read-Utf8Text $OnlineFile | ConvertFrom-Json
    $Revision = ConvertTo-ManifestSafeInteger $Online.onlineCompatibilityRevision "onlineCompatibilityRevision"
    if ($Revision -le 0) { throw "onlineCompatibilityRevision must be positive" }
    $ManifestData = Read-Utf8Text $File | ConvertFrom-Json
    $ManifestData | Add-Member -NotePropertyName onlineCompatibilityRevision -NotePropertyValue $Revision -Force
    Write-Utf8TextNoBom $File ($ManifestData | ConvertTo-Json -Depth 16)
  } catch {
    throw "builda.online.json onlineCompatibilityRevision must be a positive integer: $($_.Exception.Message)"
  }
}

function ConvertTo-ManifestRequestBytes {
  param([string]$File)
  try {
    $Data = Read-Utf8Text $File | ConvertFrom-Json
  } catch {
    throw "manifest json invalid: $File"
  }
  $Json = $Data | ConvertTo-Json -Depth 16
  Write-Output -NoEnumerate ([System.Text.UTF8Encoding]::new($false).GetBytes($Json))
}

function Get-RelativePathCompat {
  param([string]$BasePath, [string]$TargetPath)
  if ([System.IO.Path].GetMethods().Name -contains "GetRelativePath") {
    return [System.IO.Path]::GetRelativePath($BasePath, $TargetPath)
  }
  $BaseFull = [System.IO.Path]::GetFullPath($BasePath)
  if (!$BaseFull.EndsWith([System.IO.Path]::DirectorySeparatorChar.ToString())) {
    $BaseFull += [System.IO.Path]::DirectorySeparatorChar
  }
  $BaseUri = [System.Uri]::new($BaseFull)
  $TargetUri = [System.Uri]::new([System.IO.Path]::GetFullPath($TargetPath))
  $RelativeUri = $BaseUri.MakeRelativeUri($TargetUri)
  return [System.Uri]::UnescapeDataString($RelativeUri.ToString()).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
}

function Assert-SafeZipEntryName {
  param([string]$Name)
  if (!$Name -or $Name.StartsWith("/") -or $Name.Contains("\") -or $Name.Contains(":") -or ($Name.Split("/") -contains "..")) {
    throw "Unsafe zip path: $Name (ZIP entries must use '/' and stay relative to the bundle root)"
  }
}

function New-BundleZip {
  param([string]$SourceDir, [string]$OutputZip)
  if (!$SourceDir -or !(Test-Path -PathType Container $SourceDir)) { throw "bundle source directory required" }
  if (!$OutputZip) { throw "bundle output zip required" }
  $SourceFull = [System.IO.Path]::GetFullPath((Resolve-Path $SourceDir).Path).TrimEnd('\', '/')
  $OutputFull = [System.IO.Path]::GetFullPath($OutputZip)
  if ($OutputFull.StartsWith($SourceFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "bundle output zip must be outside the source directory"
  }
  $OutputParent = Split-Path -Parent $OutputFull
  if ($OutputParent) { New-Item -ItemType Directory -Force -Path $OutputParent | Out-Null }
  if (Test-Path $OutputFull) { Remove-Item -Force $OutputFull }
  Add-Type -AssemblyName System.IO.Compression
  $FileStream = [System.IO.File]::Open($OutputFull, [System.IO.FileMode]::CreateNew)
  $Archive = New-Object System.IO.Compression.ZipArchive($FileStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    Get-ChildItem -LiteralPath $SourceFull -Recurse -File | ForEach-Object {
      $EntryName = (Get-RelativePathCompat $SourceFull $_.FullName).Replace('\', '/')
      Assert-SafeZipEntryName $EntryName
      $Entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $Input = [System.IO.File]::OpenRead($_.FullName)
      $Output = $Entry.Open()
      try { $Input.CopyTo($Output) } finally { $Output.Dispose(); $Input.Dispose() }
    }
  } finally {
    $Archive.Dispose()
    $FileStream.Dispose()
  }
  Write-Host "bundle-packed=$OutputFull"
}

function Test-SdkCompat {
  $Allowed = @(".gd", ".js", ".ts", ".tsx", ".jsx", ".html", ".cfg", ".tscn")
  # Unity 工程目录整体跳过：旧 Builda SDK API 只存在于 GDScript/JS 时代，Unity 项目无迁移
  # 负担；Library/Temp 文件量大，扫描徒增耗时与误报面。
  $Skip = @(".git", ".godot", ".builda-agent", ".builda-godot-agent", "addons", "node_modules", "__pycache__", "build", "dist", "target", "server-pack", "server_pack", "Library", "Temp", "Obj", "Logs", "Assets", "ProjectSettings", "Packages")
  $Errors = New-Object System.Collections.Generic.List[string]
  Get-ChildItem -Path "." -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $Extension = $_.Extension.ToLowerInvariant()
    if ($Allowed -notcontains $Extension) { return }
    $Rel = Get-RelativePathCompat (Get-Location).Path $_.FullName
    foreach ($Part in ($Rel -split '[\\/]')) {
      if ($Skip -contains $Part) { return }
    }
    try { $Lines = Read-Utf8Lines $_.FullName } catch { return }
    $BlockEnd = ""
    for ($Index = 0; $Index -lt $Lines.Count; $Index++) {
      $Line = [string]$Lines[$Index]
      $LineNo = $Index + 1
      $Code = $Line.TrimStart()
      if ($BlockEnd) {
        $End = $Code.IndexOf($BlockEnd)
        if ($End -lt 0) { continue }
        $Code = $Code.Substring($End + $BlockEnd.Length).TrimStart()
        $BlockEnd = ""
      }
      while ($Code) {
        $BlockStart = if ($Extension -eq ".html" -and $Code.StartsWith("<!--")) { "<!--" } elseif ($Code.StartsWith("/*")) { "/*" } else { "" }
        if (!$BlockStart) { break }
        $BlockEnd = if ($BlockStart -eq "<!--") { "-->" } else { "*/" }
        $End = $Code.IndexOf($BlockEnd, $BlockStart.Length)
        if ($End -lt 0) { $Code = ""; break }
        $Code = $Code.Substring($End + $BlockEnd.Length).TrimStart()
        $BlockEnd = ""
      }
      # comment-only lines are documentation, not executable legacy SDK calls.
      if (!$Code -or $Code.StartsWith("//") -or $Code.StartsWith("#") -or $Code.StartsWith(";")) { continue }
      if ($Code -match '\b(?:Builda|builda)\s*\.\s*cloud_get\s*\(') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; replace old cloud_get(...) with private_kv_get(...)") }
      if ($Code -match '\b(?:Builda|builda)\s*\.\s*cloud_set\s*\(') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; replace old cloud_set(...) with private_kv_set(...)") }
      if ($Code -match '\b(?:Builda|builda)\s*\.\s*cloud_delete\s*\(') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; replace old cloud_delete(...) with private_kv_remove(...)") }
      if ($Code -match '\b(?:Builda|builda)\s*\.\s*kv_get\s*\(') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; kv_get(...) no longer exists; use private_kv_get(...) (value is now bytes: var_to_bytes/bytes_to_var)") }
      if ($Code -match '\b(?:Builda|builda)\s*\.\s*kv_set\s*\(') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; kv_set(...) no longer exists; use private_kv_set(key, var_to_bytes(...))") }
      if ($Code -match '\b(?:Builda|builda)\s*\.\s*kv_remove\s*\(') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; kv_remove(...) no longer exists; use private_kv_remove(...)") }
      if ($Code -match '\b(?:Builda|builda)\s*\.\s*kv\s*\.') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; Builda.kv.* no longer exists; use Builda.privateKV.* (value is now Uint8Array)") }
      if ($Extension -eq ".gd" -and $Code -match '\b(?:Builda|builda)\s*\.\s*ready\s*\(') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; replace old ready(...) with runtime_ready(...)") }
      if ($Extension -in @(".js", ".ts", ".tsx", ".jsx", ".html") -and $Code -match '\b(?:Builda|builda)\s*\.\s*ready\s*\(') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; replace old Builda.ready(...) with Builda.runtime.ready(...)") }
      if ($Code -match 'Engine\.get_singleton\s*\(\s*["'']Builda["'']\s*\)') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; replace old Engine.get_singleton(""Builda"") usage with the generated BuildaClient autoload") }
      if ($Code -match 'get_node(?:_or_null)?\s*\(\s*["'']/root/Builda["'']\s*\)') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; replace old /root/Builda node usage with /root/BuildaClient") }
      if ($Code -match '\b(?:Builda|builda)\s*\.\s*init\s*\(') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; old Builda.init(...) is no longer part of the public SDK; use BuildaClient.builda.runtime_ready() when the game is ready") }
      if ($Code -match '\b(?:Builda|builda)\s*\.\s*event\s*\(') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; old event(...) analytics API is not part of the MVP SDK; remove it or keep analytics outside Builda") }
      if ($Code -match '\b(?:Builda|builda)\s*\.\s*track\s*\(') { $Errors.Add("${Rel}:${LineNo}: old Builda SDK API found; old track(...) analytics API is not part of the MVP SDK; remove it or keep analytics outside Builda") }
      if ($Code -match '\bbackend_create\s*\(') { $Errors.Add("${Rel}:${LineNo}: backend_create(...) 当前不受支持；联机功能内测中，如有需求请联系 Builda 官方") }
      if ($Code -match '\bBuilda\s*\.\s*backend\s*\.\s*create\s*\(') { $Errors.Add("${Rel}:${LineNo}: Builda.backend.create() 当前不受支持；联机功能内测中，如有需求请联系 Builda 官方") }
    }
  }
  if ($Errors.Count -gt 0) {
    Write-Host "sdk-compat=failed"
    foreach ($ErrorItem in $Errors) { Write-Error $ErrorItem }
    Write-Error "Current SDK calls are async request/signal based. If the old code expected a direct return value, store the request id and handle the result in BuildaClient.builda.sdk_result; see addons/builda/examples/example.gd and scripts/BuildaClient.gd."
    throw "SDK compatibility check failed"
  }
  Write-Host "sdk-compat=ok"
}

function Assert-CmdResponseOk {
  param([object]$Resp, [string]$Label)
  if ($null -ne $Resp.code -and [int]$Resp.code -ne 0) {
    if ([int]$Resp.code -eq 200455) {
      throw "发布失败：暂未开放外部游戏发布权限，请前往 $EarlyAccessUrl 申请内测资格"
    }
    if ([int]$Resp.code -eq 10008) {
      throw "BUILDA_GAME_QUOTA_EXCEEDED: game quota is full; manage an existing game in the Builda app, then retry the same publish command. upload-recovery=the uploaded Bundle receipt is retained and the same publish command will reuse it."
    }
    $Message = if ($Resp.error) { $Resp.error } elseif ($Resp.msg) { $Resp.msg } else { "" }
    throw "$Label failed: code=$($Resp.code) $Message"
  }
}

function Test-BundleZip {
  param([string]$Zip, [bool]$WebViewCompat = $false, [string]$Engine = "")
  if (!$Zip -or !(Test-Path $Zip)) { throw "zip file required" }
  if (!$Engine) { $Engine = Get-ManifestEngine }
  if ($Engine -notin @("godot", "h5", "unity")) { throw "bundle-check engine must be godot, h5 or unity: $Engine" }
  # 校验口径与后端 buildzip 一致（单一真相源：h5_bundle_spec.md 附表 B）
  $GodotExt = @(".html", ".js", ".wasm", ".pck", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".json", ".css", ".txt", ".md")
  $Html5Ext = $GodotExt + @(".mjs", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".ogg", ".wav", ".m4a", ".mp4", ".webm", ".avif", ".gif", ".bin", ".dat", ".glsl", ".frag", ".vert", ".atlas", ".fnt", ".xml", ".gltf", ".glb", ".ktx2", ".basis")
  $UnityExt = $Html5Ext + @(".unityweb", ".data")
  $AllowedExt = switch ($Engine) { "godot" { $GodotExt } "unity" { $UnityExt } default { $Html5Ext } }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Zip))
  try {
    if ($Archive.Entries.Count -gt 1000) { throw "Too many ZIP entries: max 1000 (files and directories)" }
    $HasIndex = $false
    $HasJs = $false
    $HasWasm = $false
    $HasPck = $false
    $HasBuildaSdk = $false
    $IndexHtml = ""
    $IndexJs = ""
    $Forbidden = @()
    $BadExt = @()
    $FileCount = 0
    [int64]$TotalUncompressed = 0
    # unity 的 Build/ 四件套（文件名带构建名变量，只做前缀+后缀匹配，附表 B.7）
    $UnityFound = @{ "loader.js" = $false; "framework.js" = $false; "wasm" = $false; "data" = $false }
    foreach ($Entry in $Archive.Entries) {
      Assert-SafeZipEntryName $Entry.FullName
      $Name = $Entry.FullName.TrimStart("./").TrimEnd("/")
      if (!$Name) { continue }
      if (!$Entry.FullName.EndsWith("/")) {
        $FileCount++
        if ($FileCount -gt 500) { throw "Too many bundle files: max 500" }
        if ([int64]$Entry.Length -gt 805306368) { throw "Bundle file exceeds 768MiB uncompressed: $Name" }
        $TotalUncompressed += [int64]$Entry.Length
        if ($TotalUncompressed -gt 1073741824) { throw "Bundle exceeds 1GiB total uncompressed size" }
      }
      if ($Name -eq "index.html") {
        $HasIndex = $true
        $Reader = New-Object System.IO.StreamReader($Entry.Open())
        try { $IndexHtml = $Reader.ReadToEnd() } finally { $Reader.Dispose() }
      }
      if ($Name -eq "index.js") {
        $HasJs = $true
        if ($Engine -eq "godot") {
          $Reader = New-Object System.IO.StreamReader($Entry.Open())
          try { $IndexJs = $Reader.ReadToEnd() } finally { $Reader.Dispose() }
        }
      }
      if ($Name -eq "index.wasm") { $HasWasm = $true }
      if ($Name -eq "index.pck") { $HasPck = $true }
      if ($Name -eq "addons/builda/web/builda-sdk.js" -or $Name -eq "builda-sdk.js") { $HasBuildaSdk = $true }
      if ($Name -match '(^|/)(project\.godot|export_presets\.cfg|\.env|builda-dev-shell\.html)$' -or
          $Name -match '\.import$' -or $Name -match '\.d\.ts$' -or
          $Name -match '(^|/)(\.godot|\.git|\.svn|\.hg|__MACOSX)(/|$)') {
        $Forbidden += $Name
      }
      if ($Engine -ne "godot") {
        if ($Name -match '\.map$') { $Forbidden += "$Name (sourcemap leaks sources; disable sourcemaps and rebuild)" }
        if ($Name -match '(^|/)node_modules(/|$)') { $Forbidden += "$Name (node_modules must not be zipped)" }
      }
      if ($Engine -eq "unity") {
        if ($Name -match '\.(meta|csproj|sln|unity)$') { $Forbidden += "$Name (Unity project/editor files must not be zipped)" }
        if ($Name -match '(^|/)(Library|Temp|Obj|ProjectSettings)(/|$)') { $Forbidden += "$Name (Unity project directories must not be zipped)" }
        if ($Name -like "Build/*") {
          if ($Name -like "*.loader.js") { $UnityFound["loader.js"] = $true }
          elseif ($Name -like "*.framework.js" -or $Name -like "*.framework.js.unityweb") { $UnityFound["framework.js"] = $true }
          elseif ($Name -like "*.wasm" -or $Name -like "*.wasm.unityweb") { $UnityFound["wasm"] = $true }
          elseif ($Name -like "*.data" -or $Name -like "*.data.unityweb") { $UnityFound["data"] = $true }
        }
      }
      # unity 的 StreamingAssets/ 跳过扩展名白名单（AssetBundle 惯例常无扩展名，附表 B.3）；
      # 禁用清单照常执行
      $StreamingExempt = ($Engine -eq "unity") -and ($Name -like "StreamingAssets/*")
      $Ext = [System.IO.Path]::GetExtension($Name).ToLowerInvariant()
      if (!$StreamingExempt -and $AllowedExt -notcontains $Ext) { $BadExt += $Name }
    }
    if (!$HasIndex) { throw "Missing root index.html" }
    if ($Engine -eq "godot") {
      if (!$HasJs) { throw "Missing root index.js" }
      if (!$HasWasm) { throw "Missing root index.wasm" }
      if (!$HasPck) { throw "Missing root index.pck" }
    }
    if ($Engine -eq "unity") {
      $MissingUnity = @($UnityFound.Keys | Where-Object { -not $UnityFound[$_] } | Sort-Object)
      if ($MissingUnity.Count -gt 0) {
        throw "Missing Build/ Unity WebGL artifacts (*.$($MissingUnity -join ', *.'); .unityweb suffix allowed). Re-export with the default Build/ output layout."
      }
    }
    if ($Forbidden.Count -gt 0) { throw "Forbidden project/editor files: $($Forbidden -join ', ')" }
    if ($BadExt.Count -gt 0) { throw "File types not allowed for engine=${Engine}: $($BadExt -join ', ')" }
    if ($HasBuildaSdk) { Write-Host "bundle-sdk=embedded (legacy form; new exports ship without SDK, host injects by manifest)" }
    if ($IndexHtml -notlike "*builda-sdk.js*") {
      if ($Engine -eq "godot") { throw "index.html does not load builda-sdk.js. Ensure Godot Web export head include injects the SDK script." }
      if ($Engine -eq "unity") { throw 'index.html does not load builda-sdk.js. Select the Builda WebGL Template (Player Settings -> Resolution and Presentation; installed by builda sdk install), or add <script src="builda-sdk.js"></script> to your custom template head, then rebuild.' }
      throw 'index.html does not load builda-sdk.js. Add <script src="builda-sdk.js"></script> to the HTML head and rebuild.'
    }
    if ($Engine -eq "godot" -and $WebViewCompat) {
      # Godot 专属：threads/COI 导出模板变量正则（h5 跳过，误报不可控）
      if ($IndexHtml -match '\bGODOT_THREADS_ENABLED\s*=\s*true\b' -or $IndexJs -match '\bGODOT_THREADS_ENABLED\s*=\s*true\b') {
        throw "Godot Web export has threads enabled. For WebView compatibility mode, set variant/thread_support=false and re-export."
      }
      if ($IndexHtml -match '\bensureCrossOriginIsolationHeaders\s*:\s*true\b' -or $IndexJs -match '\bensureCrossOriginIsolationHeaders\s*:\s*true\b') {
        throw "Godot Web export requests cross-origin isolation headers. For WebView compatibility mode, set progressive_web_app/ensure_cross_origin_isolation_headers=false and re-export."
      }
    }
    Write-Host "bundle=ok"
    Write-Host "bundle-engine=$Engine"
    if ($Engine -eq "godot") {
      if ($WebViewCompat) { Write-Host "threads-check=webview-compatible" } else { Write-Host "threads-check=default-allowed" }
    }
    # 非阻断提示：zip 超 50MiB 建议做包体优化；只提示、不改变服务端动态上传上限。
    [int64]$ZipBytes = (Get-Item $Zip).Length
    Write-Host "bundle-zip-bytes=$ZipBytes"
    if ($ZipBytes -gt 52428800) {
      $ZipMB = [math]::Floor($ZipBytes / 1048576)
      [Console]::Error.WriteLine("bundle-size-hint=zip 已达 ${ZipMB}MiB（>50MiB）。必须评估分包/资源外置优化；建议阅读 $AgentBase/agent/releases/$Version/md_bundle_size.md（大资源外置 res/**、音频/字体/纹理瘦身）。该提示不阻断上传。")
    }
  } finally {
    $Archive.Dispose()
  }
}

function Parse-DevArguments {
  param([string[]]$DevArgs)
  $Web = ""
  $Port = 18088
  $GameId = "local-game"
  $SafeArea = ""
  $Assets = ""
  for ($i = 0; $i -lt $DevArgs.Count; $i++) {
    $Arg = $DevArgs[$i]
    switch -Regex ($Arg) {
      "^--web$" {
        $i++
        if ($i -ge $DevArgs.Count) { throw "BUILDA_BAD_DEV_ARGS: --web requires a path" }
        $Web = $DevArgs[$i]
      }
      "^--web=(.*)$" { $Web = $Matches[1] }
      "^--port$" {
        $i++
        if ($i -ge $DevArgs.Count) { throw "BUILDA_BAD_DEV_ARGS: --port requires a number" }
        try { $Port = [int]$DevArgs[$i] } catch { throw "BUILDA_BAD_DEV_ARGS: invalid port" }
      }
      "^--port=(.*)$" { try { $Port = [int]$Matches[1] } catch { throw "BUILDA_BAD_DEV_ARGS: invalid port" } }
      "^--game-id$" {
        $i++
        if ($i -ge $DevArgs.Count) { throw "BUILDA_BAD_DEV_ARGS: --game-id requires a value" }
        $GameId = $DevArgs[$i]
      }
      "^--game-id=(.*)$" { $GameId = $Matches[1] }
      "^--safearea$" {
        $i++
        if ($i -ge $DevArgs.Count) { throw "BUILDA_BAD_DEV_ARGS: --safearea requires a value" }
        $SafeArea = $DevArgs[$i]
      }
      "^--safearea=(.*)$" { $SafeArea = $Matches[1] }
      "^--assets$" {
        $i++
        if ($i -ge $DevArgs.Count) { throw "BUILDA_BAD_DEV_ARGS: --assets requires a path" }
        $Assets = $DevArgs[$i]
      }
      "^--assets=(.*)$" { $Assets = $Matches[1] }
      "^-h$|^--help$|^help$|^$" {
        return [pscustomobject]@{ Help = $true }
      }
      default { throw "BUILDA_BAD_DEV_ARGS: unknown argument $Arg" }
    }
  }
  if (!$Web) { throw "BUILDA_BAD_DEV_ARGS: --web is required" }
  if ($Port -lt 0 -or $Port -gt 65535) { throw "BUILDA_BAD_DEV_ARGS: port must be between 0 and 65535" }
  if ($SafeArea -and $SafeArea -notmatch "^\d+(\.\d+)?,\d+(\.\d+)?,\d+(\.\d+)?,\d+(\.\d+)?$") {
    throw "BUILDA_BAD_DEV_ARGS: --safearea must be top,right,bottom,left in CSS px"
  }
  return [pscustomobject]@{ Help = $false; Web = $Web; Port = $Port; GameId = $GameId; SafeArea = $SafeArea; Assets = $Assets }
}

function Test-DevPathWithinRoot {
  param([string]$RootPath, [string]$CandidatePath)
  $RootFull = [System.IO.Path]::GetFullPath($RootPath)
  $CandidateFull = [System.IO.Path]::GetFullPath($CandidatePath)
  $Comparison = [System.StringComparison]::OrdinalIgnoreCase
  if ($CandidateFull.Equals($RootFull, $Comparison)) { return $true }
  $Separator = [string][System.IO.Path]::DirectorySeparatorChar
  $RootPrefix = if ($RootFull.EndsWith($Separator, [System.StringComparison]::Ordinal)) { $RootFull } else { $RootFull + $Separator }
  return $CandidateFull.StartsWith($RootPrefix, $Comparison)
}

function Expand-DevZip {
  param([string]$ZipPath, [string]$Prefix)
  $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ($Prefix + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    foreach ($Entry in $Zip.Entries) {
      $Name = $Entry.FullName
      if ($Name.StartsWith("/") -or $Name.Contains("\") -or $Name.Contains(":") -or ($Name.Split("/") -contains "..")) {
        throw "Unsafe zip path: $Name"
      }
      if (!$Entry.Name) { continue }
      $Target = Join-Path $TempDir ($Name -replace "/", [System.IO.Path]::DirectorySeparatorChar)
      $Parent = Split-Path -Parent $Target
      if ($Parent) { New-Item -ItemType Directory -Force -Path $Parent | Out-Null }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($Entry, $Target, $true)
    }
  } finally {
    $Zip.Dispose()
  }
  return $TempDir
}

function Invoke-DevServer {
  param([string[]]$DevArgs)
  $Options = Parse-DevArguments $DevArgs
  if ($Options.Help) {
    Write-Host "Usage: builda dev --web <dir|zip> [--assets <dir|zip>] [--port 18088] [--game-id local-game] [--safearea 44,0,34,0]"
    return
  }
  $Web = [string]$Options.Web
  $Port = [int]$Options.Port
  $GameId = [string]$Options.GameId
  $SafeArea = [string]$Options.SafeArea
  $Assets = [string]$Options.Assets
  if (!(Test-Path $Web)) { throw "BUILDA_BAD_DEV_ARGS: web path not found: $Web" }

  $Resolved = Resolve-Path $Web
  $TempDir = $null
  if ((Get-Item $Resolved).PSIsContainer) {
    $WebRoot = $Resolved.Path
  } else {
    if ([System.IO.Path]::GetExtension($Resolved.Path).ToLowerInvariant() -ne ".zip") { throw "dev --web file must be a .zip H5 bundle" }
    $TempDir = Expand-DevZip $Resolved.Path "builda-dev-web-"
    $WebRoot = $TempDir
  }
  if (!(Test-Path (Join-Path $WebRoot "index.html"))) { throw "dev web root missing index.html: $WebRoot" }
  # assets 兜底源（audio/**、res/**，与 assets.zip 同布局）：CP 不用再把资源拷进构建目录，
  # mock SDK 按页面目录解析出的 /audio/... /res/... 请求在 web root 缺文件时由这里补上
  if (!$Assets -and ((Test-Path "assets\audio") -or (Test-Path "assets\res"))) { $Assets = "assets" }
  $AssetsRoot = ""
  $AssetsTempDir = $null
  if ($Assets) {
    if (!(Test-Path $Assets)) { throw "BUILDA_BAD_DEV_ARGS: assets path not found: $Assets" }
    $AssetsResolved = Resolve-Path $Assets
    if ((Get-Item $AssetsResolved).PSIsContainer) {
      $AssetsRoot = $AssetsResolved.Path
    } else {
      if ([System.IO.Path]::GetExtension($AssetsResolved.Path).ToLowerInvariant() -ne ".zip") { throw "dev --assets file must be a .zip assets bundle" }
      $AssetsTempDir = Expand-DevZip $AssetsResolved.Path "builda-dev-assets-"
      $AssetsRoot = $AssetsTempDir
    }
  }
  # mock SDK/外壳兜底查找顺序：web 导出目录 → Godot addon → HTML5 工具链落点（$ProjectStateDir/sdk/web/）
  $ProjectSdkJs = @(
    (Join-Path (Get-Location) "addons\builda\web\builda-sdk.js"),
    (Join-Path (Get-Location) (Join-Path $ProjectStateDir "sdk\web\builda-sdk.js"))
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  $SdkPresent = (Test-Path (Join-Path $WebRoot "addons\builda\web\builda-sdk.js")) -or (Test-Path (Join-Path $WebRoot "builda-sdk.js")) -or [bool]$ProjectSdkJs
  # 测试外壳随 mock SDK 装进项目，web 导出里不会有；从项目目录兜底 serve
  $ProjectShell = @(
    (Join-Path (Get-Location) "addons\builda\web\builda-dev-shell.html"),
    (Join-Path (Get-Location) (Join-Path $ProjectStateDir "sdk\web\builda-dev-shell.html"))
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  $ShellPresent = (Test-Path (Join-Path $WebRoot "builda-dev-shell.html")) -or [bool]$ProjectShell

  $Listener = $null
  $TcpListener = $null
  $UseHttpListener = [System.Net.HttpListener]::IsSupported -and $env:BUILDA_DEV_FORCE_TCP_LISTENER -ne "1"
  $ActualPort = $Port
  $Bound = $false
  $Candidates = if ($Port -eq 0) { @(0) } else { $Port..([Math]::Min($Port + 20, 65535)) }
  if ($UseHttpListener) {
    try { $Listener = New-Object System.Net.HttpListener } catch { $UseHttpListener = $false }
  }
  if ($UseHttpListener) {
    foreach ($Candidate in $Candidates) {
      $TryPort = if ($Candidate -eq 0) {
        $Probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
        $Probe.Start()
        $FreePort = $Probe.LocalEndpoint.Port
        $Probe.Stop()
        $FreePort
      } else {
        $Candidate
      }
      $Listener.Prefixes.Clear()
      $Listener.Prefixes.Add("http://127.0.0.1:$TryPort/")
      try {
        $Listener.Start()
        $ActualPort = $TryPort
        $Bound = $true
        break
      } catch {}
    }
    if (!$Bound) {
      try { $Listener.Close() } catch {}
      $Listener = $null
      $UseHttpListener = $false
    }
  }
  if (!$UseHttpListener) {
    foreach ($Candidate in $Candidates) {
      try {
        $TcpListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Candidate)
        $TcpListener.Start()
        $ActualPort = ([System.Net.IPEndPoint]$TcpListener.LocalEndpoint).Port
        $Bound = $true
        break
      } catch {
        if ($TcpListener) { try { $TcpListener.Stop() } catch {} }
        $TcpListener = $null
      }
    }
  }
  if (!$Bound) { throw "could not bind localhost port $Port" }

  $EntryQuery = "gameId=$([uri]::EscapeDataString($GameId))"
  if ($SafeArea) { $EntryQuery += "&builda_mock_safearea=$([uri]::EscapeDataString($SafeArea))" }
  $EntryPath = "/index.html?$EntryQuery"
  $ShellPath = "/builda-dev-shell.html?$EntryQuery"
  function New-DevResponse([byte[]]$Bytes, [string]$ContentType, [int]$Status = 200, [string]$Location = "") {
    return [pscustomobject]@{ Bytes = $Bytes; ContentType = $ContentType; Status = $Status; Location = $Location }
  }
  function Get-DevContentType([string]$Path) {
    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
      ".html" { "text/html; charset=utf-8" }
      ".htm" { "text/html; charset=utf-8" }
      ".css" { "text/css; charset=utf-8" }
      ".js" { "text/javascript; charset=utf-8" }
      ".mjs" { "text/javascript; charset=utf-8" }
      ".map" { "application/json; charset=utf-8" }
      ".wasm" { "application/wasm" }
      ".pck" { "application/octet-stream" }
      ".json" { "application/json; charset=utf-8" }
      ".xml" { "application/xml; charset=utf-8" }
      ".txt" { "text/plain; charset=utf-8" }
      ".svg" { "image/svg+xml" }
      ".ico" { "image/x-icon" }
      ".png" { "image/png" }
      ".jpg" { "image/jpeg" }
      ".jpeg" { "image/jpeg" }
      ".gif" { "image/gif" }
      ".webp" { "image/webp" }
      ".avif" { "image/avif" }
      ".woff" { "font/woff" }
      ".woff2" { "font/woff2" }
      ".ttf" { "font/ttf" }
      ".otf" { "font/otf" }
      ".eot" { "application/vnd.ms-fontobject" }
      ".mp3" { "audio/mpeg" }
      ".ogg" { "audio/ogg" }
      ".wav" { "audio/wav" }
      ".m4a" { "audio/mp4" }
      ".mp4" { "video/mp4" }
      ".webm" { "video/webm" }
      default { "application/octet-stream" }
    }
  }

  function Get-DevResponse([string]$Path) {
    if ($Path -eq "/") {
      $Location = if ($ShellPresent) { $ShellPath } else { $EntryPath }
      return New-DevResponse @() "text/plain; charset=utf-8" 302 $Location
    }
    if ($Path -eq "/health") {
      $InstalledSdkVersion = ""
      if (Test-Path $SdkVersionFile) { $InstalledSdkVersion = (Read-Utf8Lines $SdkVersionFile | Select-Object -First 1).Trim() }
      $Health = [ordered]@{
        toolchainVersion = $Version
        sdkVersion = $InstalledSdkVersion
        gameId = $GameId
        webRoot = $WebRoot
      } | ConvertTo-Json -Compress
      return New-DevResponse ([System.Text.Encoding]::UTF8.GetBytes($Health)) "application/json; charset=utf-8"
    }
    if ($Path -eq "/builda-dev-shell.html" -and !(Test-Path (Join-Path $WebRoot "builda-dev-shell.html")) -and $ProjectShell) {
      return New-DevResponse ([System.IO.File]::ReadAllBytes($ProjectShell)) "text/html; charset=utf-8"
    }
    if (($Path -eq "/builda-sdk.js" -or $Path -eq "/addons/builda/web/builda-sdk.js") -and $ProjectSdkJs) {
      $InWeb = Join-Path $WebRoot ($Path.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar)
      if (!(Test-Path $InWeb)) {
        return New-DevResponse ([System.IO.File]::ReadAllBytes($ProjectSdkJs)) "text/javascript; charset=utf-8"
      }
    }
    if ($AssetsRoot -and ($Path -match '^/(audio|res)/')) {
      # assets 兜底：web root 没有该文件时从项目 assets 源伺服（Test-DevPathWithinRoot 防 .. 逃逸）
      $RelAsset = $Path.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar
      $InWeb = Join-Path $WebRoot $RelAsset
      if (!(Test-Path -LiteralPath $InWeb)) {
        try { $AssetTarget = [System.IO.Path]::GetFullPath((Join-Path $AssetsRoot $RelAsset)) } catch { $AssetTarget = "" }
        if ($AssetTarget -and (Test-DevPathWithinRoot $AssetsRoot $AssetTarget) -and (Test-Path -LiteralPath $AssetTarget) -and !(Get-Item -LiteralPath $AssetTarget).PSIsContainer) {
          return New-DevResponse ([System.IO.File]::ReadAllBytes($AssetTarget)) (Get-DevContentType $AssetTarget)
        }
      }
    }
    $Rel = $Path.TrimStart("/")
    if (!$Rel) { $Rel = "index.html" }
    try {
      $Target = [System.IO.Path]::GetFullPath((Join-Path $WebRoot ($Rel -replace "/", [System.IO.Path]::DirectorySeparatorChar)))
    } catch {
      return New-DevResponse ([System.Text.Encoding]::UTF8.GetBytes("not found")) "text/plain; charset=utf-8" 404
    }
    $RootFull = [System.IO.Path]::GetFullPath($WebRoot)
    if (!(Test-DevPathWithinRoot $RootFull $Target) -or !(Test-Path -LiteralPath $Target) -or (Get-Item -LiteralPath $Target).PSIsContainer) {
      return New-DevResponse ([System.Text.Encoding]::UTF8.GetBytes("not found")) "text/plain; charset=utf-8" 404
    }
    return New-DevResponse ([System.IO.File]::ReadAllBytes($Target)) (Get-DevContentType $Target)
  }

  function Send-DevHttpListenerResponse($Context, $Reply, [bool]$HeadOnly) {
    $Context.Response.StatusCode = $Reply.Status
    $Context.Response.ContentType = $Reply.ContentType
    if ($Reply.Location) { $Context.Response.Headers["Location"] = $Reply.Location }
    $Context.Response.Headers["Cross-Origin-Opener-Policy"] = "same-origin"
    $Context.Response.Headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    $Context.Response.Headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    $Context.Response.ContentLength64 = $Reply.Bytes.Length
    if (!$HeadOnly) { $Context.Response.OutputStream.Write($Reply.Bytes, 0, $Reply.Bytes.Length) }
    $Context.Response.Close()
  }

  function Send-DevTcpResponse($Client, $Reply, [bool]$HeadOnly) {
    $Reason = switch ($Reply.Status) { 200 { "OK" } 302 { "Found" } 400 { "Bad Request" } 404 { "Not Found" } default { "Error" } }
    $Headers = "HTTP/1.1 $($Reply.Status) $Reason`r`nContent-Type: $($Reply.ContentType)`r`nContent-Length: $($Reply.Bytes.Length)`r`nConnection: close`r`nCross-Origin-Opener-Policy: same-origin`r`nCross-Origin-Embedder-Policy: require-corp`r`nCross-Origin-Resource-Policy: cross-origin`r`n"
    if ($Reply.Location) { $Headers += "Location: $($Reply.Location)`r`n" }
    $Headers += "`r`n"
    $Stream = $Client.GetStream()
    $HeaderBytes = [System.Text.Encoding]::ASCII.GetBytes($Headers)
    $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)
    if (!$HeadOnly) { $Stream.Write($Reply.Bytes, 0, $Reply.Bytes.Length) }
    $Stream.Flush()
  }

  $BaseUrl = "http://127.0.0.1:$ActualPort"
  Write-Host "dev=ok"
  if ($ShellPresent) { Write-Host "dev-url=$BaseUrl$ShellPath" } else { Write-Host "dev-url=$BaseUrl$EntryPath" }
  Write-Host "game-url=$BaseUrl$EntryPath"
  Write-Host "sdk-mode=local-mock"
  if ($ShellPresent) { Write-Host "dev-shell=present" } else { Write-Host "dev-shell=missing" }
  if ($SdkPresent) { Write-Host "dev-sdk=present" } else { Write-Host "dev-sdk=missing" }
  Write-Host "dev-web=$WebRoot"
  if ($AssetsRoot) {
    Write-Host "dev-assets=$AssetsRoot (audio/**, res/** served as a same-origin fallback; keep them out of the build dir and the bundle zip)"
  } else {
    Write-Host "dev-assets=none (games using Builda.audio.* / assets.url(): pass --assets <dir|zip> or keep audio/, res/ under .\assets\ at the project root)"
  }
  if ($UseHttpListener) { Write-Host "dev-listener=http" } else { Write-Host "dev-listener=tcp-fallback" }
  Write-Host "dev-mock-player=local-player (append &builda_mock_player=<id>&builda_mock_name=<name> to the URL to switch identity)"
  if (!$ShellPresent) {
    Write-Host "dev-shell-warning=builda-dev-shell.html not found; run sdk install to get the test shell (orientation/notch/capsule/pay/ad mock)."
  }
  if (!$SdkPresent) {
    Write-Host "dev-warning=builda-sdk.js not found in web root or project; run sdk install (dev server serves the project copy automatically)."
  }

  try {
    if ($UseHttpListener) {
      while ($Listener.IsListening) {
        $Context = $Listener.GetContext()
        $Path = [System.Uri]::UnescapeDataString($Context.Request.Url.AbsolutePath)
        $Reply = Get-DevResponse $Path
        Send-DevHttpListenerResponse $Context $Reply ($Context.Request.HttpMethod -eq "HEAD")
      }
    } else {
      while ($true) {
        $ClientConnection = $TcpListener.AcceptTcpClient()
        try {
          $ClientConnection.ReceiveTimeout = 5000
          $Stream = $ClientConnection.GetStream()
          $Reader = New-Object -TypeName System.IO.StreamReader -ArgumentList @($Stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
          $RequestLine = $Reader.ReadLine()
          while ($null -ne ($HeaderLine = $Reader.ReadLine()) -and $HeaderLine.Length -gt 0) {}
          if ($RequestLine -notmatch '^(GET|HEAD) ([^ ]+) HTTP/1\.[01]$') {
            $Reply = New-DevResponse ([System.Text.Encoding]::UTF8.GetBytes("bad request")) "text/plain; charset=utf-8" 400
            Send-DevTcpResponse $ClientConnection $Reply $false
            continue
          }
          $Method = $Matches[1]
          $RequestTarget = $Matches[2]
          $RawPath = ($RequestTarget -split '\?', 2)[0]
          try { $Path = [System.Uri]::UnescapeDataString($RawPath) } catch { $Path = "/__invalid_path__" }
          $Reply = Get-DevResponse $Path
          Send-DevTcpResponse $ClientConnection $Reply ($Method -eq "HEAD")
        } finally {
          $ClientConnection.Close()
        }
      }
    }
  } finally {
    if ($Listener) {
      if ($Listener.IsListening) { $Listener.Stop() }
      $Listener.Close()
    }
    if ($TcpListener) { $TcpListener.Stop() }
    if ($TempDir -and (Test-Path $TempDir)) { Remove-Item -Recurse -Force $TempDir }
    if ($AssetsTempDir -and (Test-Path $AssetsTempDir)) { Remove-Item -Recurse -Force $AssetsTempDir }
  }
}

function Test-AssetsZip {
  param([string]$Zip)
  if (!$Zip -or !(Test-Path $Zip)) { throw "assets.zip file required" }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Zip))
  try {
    $Count = 0
    $PckCount = 0
    [int64]$Total = 0
    foreach ($Entry in $Archive.Entries) {
      $Name = $Entry.FullName.TrimStart("./").TrimEnd("/")
      if (!$Name) { continue }
      if ($Name.EndsWith("/")) { continue }
      if ($Name.StartsWith("/") -or $Name.Contains("\") -or $Name.Contains(":") -or $Name -match '(^|/)\.\.(/|$)') {
        throw "Unsafe asset path: $Name"
      }
      if ($Name -notmatch '^(audio|res)/') { throw "Asset must be under audio/ or res/: $Name" }
      if ($Name -match '^audio/' -and $Name -notmatch '\.(mp3|ogg|wav)$') { throw "Only .mp3/.ogg/.wav assets are allowed under audio/: $Name" }
      if ($Name -match '^res/' -and $Name -notmatch '\.(glb|gltf|bin|ktx2|png|jpg|jpeg|webp|json|bundle|hash|pck)$') {
        throw "Only .glb/.gltf/.bin/.ktx2/.png/.jpg/.jpeg/.webp/.json/.bundle/.hash/.pck assets are allowed under res/: $Name"
      }
      if ($Name -match '\.pck$') { $PckCount += 1 }
      if ($Name -match '(^|/)(\.godot|\.git|\.svn|\.hg|__MACOSX)(/|$)' -or $Name -match '(^|/)\.[^/]+$') {
        throw "Forbidden asset path: $Name"
      }
      if ($Entry.Length -gt 32MB) { throw "Asset file exceeds 32MB: $Name" }
      $Count += 1
      $Total += $Entry.Length
      if ($Count -gt 500) { throw "Too many asset files: max 500" }
      if ($Total -gt 320MB) { throw "Assets zip exceeds 320MB uncompressed" }
    }
    if ($Count -eq 0) { throw "assets.zip is empty" }
    Write-Host "assets=ok"
    Write-Host "assets-files=$Count"
    Write-Host "assets-bytes=$Total"
    if ($PckCount -gt 0) {
      Write-Host "assets-pck=$PckCount"
      Write-Host "assets-pck-note=服务端会深度校验 pck 必须 data-only：不含 .gd/.gdc/.gdns/.cs 等脚本、原生库、加密内容，场景/资源不得引用脚本；含脚本的 pck 会在上传时整包被拒。"
    }
  } finally {
    $Archive.Dispose()
  }
}

function Upload-AssetsZip {
  param([string]$Zip)
  Need-Token
  if (!$Zip -or !(Test-Path $Zip)) { throw "assets.zip file required" }
  Test-AssetsZip $Zip | Out-Null
  if (!(Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw "curl.exe is required for assets upload on Windows." }
  $ZipPath = Resolve-Path $Zip
  $GameId = Get-ProjectGameId
  $Arguments = @("-X", "POST", "$Base/api/v1/uploads/assets", "-F", "file=@$ZipPath")
  if ($GameId) { $Arguments += @("-F", "gameId=$GameId") }
  $Raw = Invoke-BuildaCurlUploadWithAuthRetry -Label "assets upload" -CurlArguments $Arguments
  $Resp = $Raw | ConvertFrom-Json
  Write-Utf8TextNoBom (Join-Path $Root "last-assets.json") ($Resp | ConvertTo-Json -Depth 8)
  $Resp | ConvertTo-Json -Depth 8
  if ($Resp.assetsVersion) {
    if (!(Test-Path $Manifest)) { Write-DefaultManifest }
    $Data = Read-Utf8Text $Manifest | ConvertFrom-Json
    $Data | Add-Member -NotePropertyName assetsVersion -NotePropertyValue $Resp.assetsVersion -Force
    $Data | Add-Member -NotePropertyName assetsBaseUrl -NotePropertyValue $Resp.assetsBaseUrl -Force
    $Data | Add-Member -NotePropertyName assetsManifestUrl -NotePropertyValue $Resp.assetsManifestUrl -Force
    Write-Utf8TextNoBom $Manifest ($Data | ConvertTo-Json -Depth 8)
    Write-Host "Updated $Manifest with audio assets fields."
  }
}

function Get-VerifiedSdkArchive {
  param([string]$ChannelPath, [string]$ArtifactName)
  $Meta = Get-BuildaRemoteJson -Uri "$AgentBase/agent/sdk/$ChannelPath"
  $ExpectedUrl = "$AgentBase/agent/releases/$Version/$ArtifactName"
  if ([string]$Meta.version -ne $Version -or [string]$Meta.url -ne $ExpectedUrl -or
      [string]$Meta.sha256 -notmatch '^[0-9a-fA-F]{64}$' -or [int64]$Meta.size -le 0) {
    throw "SDK metadata invalid or does not match CLI version $Version."
  }
  $TransactionRoot = Join-Path ([System.IO.Path]::GetFullPath($ProjectStateDir)) (".sdk-install-" + [System.Guid]::NewGuid().ToString("N"))
  $Archive = Join-Path $TransactionRoot $ArtifactName
  try {
    [System.IO.Directory]::CreateDirectory($TransactionRoot) | Out-Null
    Invoke-BuildaRawDownload -Uri $Meta.url -Destination $Archive
    $ActualSize = (Get-Item -LiteralPath $Archive).Length
    $ActualSha = Get-BuildaFileSha256 $Archive
    if ($ActualSize -ne [int64]$Meta.size -or $ActualSha -ne ([string]$Meta.sha256).ToLowerInvariant()) {
      throw "SDK archive size or SHA-256 mismatch."
    }
    return @{ Root = $TransactionRoot; Archive = $Archive; Version = [string]$Meta.version }
  } catch {
    Remove-Item -Recurse -Force -LiteralPath $TransactionRoot -ErrorAction SilentlyContinue
    throw
  }
}

function Install-SdkDirectorySet {
  param([string]$TransactionRoot, [object[]]$Mappings)
  $BackupRoot = Join-Path $TransactionRoot "backup"
  [System.IO.Directory]::CreateDirectory($BackupRoot) | Out-Null
  $Records = New-Object System.Collections.Generic.List[object]
  try {
    for ($Index = 0; $Index -lt $Mappings.Count; $Index++) {
      $Source = [System.IO.Path]::GetFullPath([string]$Mappings[$Index].Source)
      $Destination = [System.IO.Path]::GetFullPath([string]$Mappings[$Index].Destination)
      if (!(Test-Path -LiteralPath $Source -PathType Container)) { throw "SDK staged directory missing: $Source" }
      $Parent = [System.IO.Path]::GetDirectoryName($Destination)
      if ($Parent) { [System.IO.Directory]::CreateDirectory($Parent) | Out-Null }
      $Backup = Join-Path $BackupRoot ([string]$Index)
      $Record = @{ Destination = $Destination; Backup = $Backup; HadOld = (Test-Path -LiteralPath $Destination); Installed = $false }
      $Records.Add($Record)
      if ($Record.HadOld) { [System.IO.Directory]::Move($Destination, $Backup) }
      [System.IO.Directory]::Move($Source, $Destination)
      $Record.Installed = $true
    }
  } catch {
    $Failure = $_
    $RollbackErrors = New-Object System.Collections.Generic.List[string]
    for ($Index = $Records.Count - 1; $Index -ge 0; $Index--) {
      $Record = $Records[$Index]
      try {
        if ($Record.Installed -and (Test-Path -LiteralPath $Record.Destination)) {
          Remove-Item -Recurse -Force -LiteralPath $Record.Destination
        }
        if ($Record.HadOld -and (Test-Path -LiteralPath $Record.Backup)) {
          [System.IO.Directory]::Move($Record.Backup, $Record.Destination)
        }
      } catch {
        $RollbackErrors.Add($_.Exception.Message)
      }
    }
    if ($RollbackErrors.Count -gt 0) {
      throw "BUILDA_SDK_ROLLBACK_FAILED: backup=$BackupRoot errors=$([string]::Join('; ', $RollbackErrors)) original=$($Failure.Exception.Message)"
    }
    throw $Failure
  }
}

function Install-WebSdk {
  # HTML5 项目：mock SDK/d.ts/dev-shell/mic worker 装到 $ProjectStateDir/sdk/web/
  $Download = Get-VerifiedSdkArchive "web/latest.json" "builda-sdk-web.zip"
  $Stage = Join-Path $Download.Root "stage/web"
  $Committed = $false
  try {
    Expand-Archive -Force -Path $Download.Archive -DestinationPath $Stage
    if (!(Test-Path (Join-Path $Stage "builda-sdk.js")) -or !(Test-Path (Join-Path $Stage "builda-sdk.d.ts"))) { throw "Web SDK zip layout invalid." }
    $Dst = Join-Path $ProjectStateDir "sdk/web"
    Install-SdkDirectorySet $Download.Root @(@{ Source = $Stage; Destination = $Dst })
    $Committed = $true
  } catch {
    if ($_.Exception.Message -notlike "BUILDA_SDK_ROLLBACK_FAILED:*") {
      Remove-Item -Recurse -Force -LiteralPath $Download.Root -ErrorAction SilentlyContinue
    }
    throw
  } finally {
    if ($Committed) { Remove-Item -Recurse -Force -LiteralPath $Download.Root -ErrorAction SilentlyContinue }
  }
  Write-Utf8TextNoBom $SdkVersionFile "$Version$([Environment]::NewLine)"
  Write-Host "sdk-version=$Version"
  Write-Host "sdk-installed=$Dst"
  Write-Host "sdk-engine=h5"
  Write-Host 'sdk-next-1=在游戏 HTML 的 <head> 里引用根路径 SDK：<script src="builda-sdk.js"></script>（构建产物 index.html 必须带上该引用；zip 不内嵌 SDK，正式运行时由宿主按 manifest sdk 契约注入）'
  Write-Host "sdk-next-2=本地调试：builda dev --web <构建目录或 zip>（dev server 自动从 $Dst 兜底 serve mock SDK 与测试外壳）"
  Write-Host "sdk-next-3=TypeScript 类型提示：把 $Dst/builda-sdk.d.ts 加进 tsconfig include（可选）"
  try {
    Test-Sdk
  } catch {
    Write-Host "sdk-install=ok"
    Write-Error "sdk-next=fix sdk check errors, then rerun: builda sdk check"
  }
}

function Install-UnitySdk {
  # Unity 项目：C# 包装层/jslib 装 Assets/Builda/，Builda WebGL 模板装 Assets/WebGLTemplates/
  # （Unity 硬性要求的模板位置），web 内核 mock 落 $ProjectStateDir/sdk/web/（与 h5 同构）。
  # 三个落点都归 SDK 所有，升级整体覆盖。
  $Download = Get-VerifiedSdkArchive "unity/latest.json" "builda-sdk-unity.zip"
  $TmpDir = Join-Path $Download.Root "stage"
  $Committed = $false
  try {
    Expand-Archive -Force -Path $Download.Archive -DestinationPath $TmpDir
    if (!(Test-Path (Join-Path $TmpDir "Assets/Builda")) -or
        !(Test-Path (Join-Path $TmpDir "Assets/WebGLTemplates/Builda")) -or
        !(Test-Path (Join-Path $TmpDir ".builda-agent/sdk/web"))) {
      throw "Unity SDK zip layout invalid."
    }
    $Mappings = @(
      @{ Source = (Join-Path $TmpDir "Assets/Builda"); Destination = "Assets/Builda" },
      @{ Source = (Join-Path $TmpDir "Assets/WebGLTemplates/Builda"); Destination = "Assets/WebGLTemplates/Builda" },
      @{ Source = (Join-Path $TmpDir ".builda-agent/sdk/web"); Destination = (Join-Path $ProjectStateDir "sdk/web") }
    )
    $MicSource = Join-Path $TmpDir "Assets/StreamingAssets/builda-mic"
    if (Test-Path $MicSource) {
      if (Test-Path "Assets/StreamingAssets/builda-mic") {
        Write-Host "sdk-mic=preserved (Assets/StreamingAssets/builda-mic is project-owned; delete it and rerun sdk install to reset to defaults)"
      } else {
        $Mappings += @{ Source = $MicSource; Destination = "Assets/StreamingAssets/builda-mic" }
        Write-Host "sdk-mic=Assets/StreamingAssets/builda-mic"
      }
    }
    Install-SdkDirectorySet $Download.Root $Mappings
    $Committed = $true
  } catch {
    if ($_.Exception.Message -notlike "BUILDA_SDK_ROLLBACK_FAILED:*") {
      Remove-Item -Recurse -Force -LiteralPath $Download.Root -ErrorAction SilentlyContinue
    }
    throw
  } finally {
    if ($Committed) { Remove-Item -Recurse -Force -LiteralPath $Download.Root -ErrorAction SilentlyContinue }
  }
  # BuildaMic 分析 Worker 归项目所有（L2 模板，CP 可魔改算法）：升级不覆盖已存在目录；
  # 恢复默认 = 删除 Assets\StreamingAssets\builda-mic 后重跑 sdk install
  Write-Utf8TextNoBom $SdkVersionFile "$Version$([Environment]::NewLine)"
  Write-Host "sdk-version=$Version"
  Write-Host "sdk-installed=Assets/Builda"
  Write-Host "sdk-engine=unity"
  Write-Host "sdk-next-1=Player Settings > Resolution and Presentation > WebGL Template 选 Builda（模板已装到 Assets/WebGLTemplates/Builda/，head 内已引用 builda-sdk.js）"
  Write-Host "sdk-next-2=Player Settings > Publishing Settings：Compression Format 选 Brotli 并勾选 Decompression Fallback（推荐），或选 Disabled；开压缩但不勾 Fallback 的产物会被上传校验拒绝"
  Write-Host "sdk-next-3=本地调试：builda dev --web <WebGL 构建目录或 zip>（dev server 自动从 $ProjectStateDir/sdk/web 兜底 serve mock SDK 与测试外壳）"
  try {
    Test-Sdk
  } catch {
    Write-Host "sdk-install=ok"
    Write-Error "sdk-next=fix sdk check errors, then rerun: builda sdk check"
  }
}

function Install-Sdk {
  # 引擎分流：godot 装 addon（现有全流程）；h5 装 web 内核；unity 装 C# 包装层 + 模板 + web 内核
  if ((Get-EngineValue ".") -eq "h5") {
    Install-WebSdk
    return
  }
  if ((Get-EngineValue ".") -eq "unity") {
    Install-UnitySdk
    return
  }
  if (!(Test-Path "project.godot")) { throw "project.godot missing. Run inside a Godot project root, run: builda sdk init, or use an HTML5 (index.html/package.json at root) or Unity (ProjectSettings/ProjectVersion.txt) project." }
  $Download = Get-VerifiedSdkArchive "latest.json" "builda-sdk.zip"
  $StageRoot = Join-Path $Download.Root "stage"
  $StageAddon = Join-Path $StageRoot "addons/builda"
  $Committed = $false
  try {
    Expand-Archive -Force -Path $Download.Archive -DestinationPath $StageRoot
    if (!(Test-Path (Join-Path $StageAddon "builda.gd")) -or !(Test-Path (Join-Path $StageAddon "plugin.cfg"))) { throw "Godot SDK zip layout invalid." }
    if (Test-Path "addons/builda/mic") {
      Remove-Item -Recurse -Force -LiteralPath (Join-Path $StageAddon "mic") -ErrorAction SilentlyContinue
      Copy-Item -Recurse -Force "addons/builda/mic" (Join-Path $StageAddon "mic")
      Write-Host "sdk-mic=preserved (addons/builda/mic is project-owned; delete it and rerun sdk install to reset to defaults)"
    }
    Install-SdkDirectorySet $Download.Root @(@{ Source = $StageAddon; Destination = "addons/builda" })
    $Committed = $true
  } catch {
    if ($_.Exception.Message -notlike "BUILDA_SDK_ROLLBACK_FAILED:*") {
      Remove-Item -Recurse -Force -LiteralPath $Download.Root -ErrorAction SilentlyContinue
    }
    throw
  } finally {
    if ($Committed) { Remove-Item -Recurse -Force -LiteralPath $Download.Root -ErrorAction SilentlyContinue }
  }
  Write-Utf8TextNoBom $SdkVersionFile "$Version$([Environment]::NewLine)"
  Write-Host "sdk-version=$Version"
  Write-Host "sdk-installed=addons/builda"
  Install-BuildaClient
  Set-WebHeadInclude
  try {
    Test-Sdk
  } catch {
    Write-Host "sdk-install=ok"
    Write-Error "sdk-next=fix sdk check errors, then rerun: builda sdk check"
  }
}

function Install-BuildaClient {
  $Example = Join-Path "addons\builda\examples" "BuildaClient.gd"
  if (!(Test-Path $Example)) { return }
  New-Item -ItemType Directory -Force -Path "scripts" | Out-Null
  $Target = Join-Path "scripts" "BuildaClient.gd"
  if (!(Test-Path $Target)) {
    Copy-Item -Force $Example $Target
    Write-Host "sdk-client=scripts/BuildaClient.gd"
  } else {
    Write-Host "sdk-client=scripts/BuildaClient.gd exists"
  }
  Set-BuildaAutoload
}

function Set-BuildaAutoload {
  if (!(Test-Path "project.godot")) { return }
  $Lines = New-Object System.Collections.Generic.List[string]
  $Lines.AddRange([string[]](Read-Utf8Lines "project.godot"))
  $Result = New-Object System.Collections.Generic.List[string]
  $InAutoload = $false
  $SawAutoload = $false
  $Wrote = $false
  foreach ($Line in $Lines) {
    if ($Line -eq "[autoload]") {
      $InAutoload = $true
      $SawAutoload = $true
      $Result.Add($Line)
      continue
    }
    if ($Line -match '^\[') {
      if ($InAutoload -and !$Wrote) {
        $Result.Add('BuildaClient="*res://scripts/BuildaClient.gd"')
        $Wrote = $true
      }
      $InAutoload = $false
    }
    if ($InAutoload -and $Line -match '^BuildaClient=') {
      if (!$Wrote) {
        $Result.Add('BuildaClient="*res://scripts/BuildaClient.gd"')
        $Wrote = $true
      }
      continue
    }
    $Result.Add($Line)
  }
  if (!$Wrote) {
    if (!$SawAutoload) {
      $Result.Add("")
      $Result.Add("[autoload]")
    }
    $Result.Add('BuildaClient="*res://scripts/BuildaClient.gd"')
  }
  Write-Utf8LinesNoBom "project.godot" $Result
  Write-Host "sdk-autoload=BuildaClient"
}

function Set-WebHeadInclude {
  if (!(Test-Path "export_presets.cfg")) {
    Write-Host "sdk-web-head=export_presets.cfg missing"
    return
  }
  $Path = "export_presets.cfg"
  $Lines = [System.Collections.Generic.List[string]]::new()
  $Lines.AddRange([string[]](Read-Utf8Lines $Path))
  $WebIds = @{}
  $Current = $null
  foreach ($Line in $Lines) {
    if ($Line -match '^\[preset\.(\d+)\]$') {
      $Current = $Matches[1]
      continue
    }
    if ($Line -match '^\[') {
      $Current = $null
      continue
    }
    if ($null -ne $Current -and $Line -eq 'platform="Web"') {
      $WebIds[$Current] = $true
    }
  }
  if ($WebIds.Count -eq 0) {
    Write-Host "sdk-web-head=no web preset"
    return
  }
  $Out = [System.Collections.Generic.List[string]]::new()
  $CurrentSection = $null
  $InWebOptions = $false
  $SeenHead = $false
  $Changed = $false
  $AlreadyOk = $false
  $Injected = 'html/head_include="<script src=\"builda-sdk.js\"></script>"'
  foreach ($Line in $Lines) {
    if ($Line -match '^\[preset\.(\d+)(\.options)?\]$') {
      if ($InWebOptions -and !$SeenHead) {
        $Out.Add($Injected)
        $Changed = $true
      }
      $CurrentSection = $Matches[1]
      $InWebOptions = $WebIds.ContainsKey($CurrentSection) -and ($Matches[2] -eq ".options")
      $SeenHead = $false
      $Out.Add($Line)
      continue
    }
    if ($Line -match '^\[') {
      if ($InWebOptions -and !$SeenHead) {
        $Out.Add($Injected)
        $Changed = $true
      }
      $CurrentSection = $null
      $InWebOptions = $false
      $SeenHead = $false
      $Out.Add($Line)
      continue
    }
    if ($null -ne $CurrentSection -and $WebIds.ContainsKey($CurrentSection) -and !$InWebOptions -and $Line.StartsWith("html/head_include=") -and $Line.Contains("builda-sdk.js")) {
      $Changed = $true
      continue
    }
    if ($InWebOptions -and $Line.StartsWith("html/head_include=")) {
      $SeenHead = $true
      if ($Line.Contains("builda-sdk.js")) {
        $Out.Add($Line.Replace("addons/builda/web/builda-sdk.js", "builda-sdk.js"))
        $AlreadyOk = $true
      } elseif ($Line -eq 'html/head_include=""') {
        $Out.Add($Injected)
        $Changed = $true
      } elseif ($Line.EndsWith('"')) {
        $Out.Add($Line.Substring(0, $Line.Length - 1) + '\n<script src=\"builda-sdk.js\"></script>"')
        $Changed = $true
      } else {
        $Out.Add($Line)
      }
      continue
    }
    $Out.Add($Line)
  }
  if ($InWebOptions -and !$SeenHead) {
    $Out.Add($Injected)
    $Changed = $true
  }
  if ($Changed) {
    Write-Utf8LinesNoBom $Path $Out
    Write-Host "sdk-web-head=builda-sdk.js injected"
  } elseif ($AlreadyOk) {
    Write-Host "sdk-web-head=builda-sdk.js exists"
  } else {
    Write-Host "sdk-web-head=builda-sdk.js exists"
  }
}

function Initialize-SdkProject {
  if (Test-Path "project.godot") {
    Write-Host "project.godot already exists"
    return
  }
  New-Item -ItemType Directory -Force -Path "scenes" | Out-Null
  New-Item -ItemType Directory -Force -Path "scripts" | Out-Null
  $ProjectContent = @'
; Engine configuration file.
; Minimal project skeleton generated by Builda SDK tooling for agent validation.

config_version=5

[application]
config/name="Builda SDK Minimal"
run/main_scene="res://scenes/main.tscn"
'@
  Write-Utf8TextNoBom "project.godot" $ProjectContent
  $SceneContent = @'
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/main.gd" id="1_main"]

[node name="Main" type="Node"]
script = ExtResource("1_main")
'@
  Write-Utf8TextNoBom (Join-Path "scenes" "main.tscn") $SceneContent
  $ScriptContent = @'
extends Node

func _ready() -> void:
	if Engine.has_singleton("JavaScriptBridge"):
		print("Builda SDK minimal project loaded")
	else:
		print("Builda SDK minimal project loaded outside Web runtime")
'@
  Write-Utf8TextNoBom (Join-Path "scripts" "main.gd") $ScriptContent
  Write-Host "sdk-init=ok"
  Write-Host "sdk-init-project=project.godot"
  Write-Host "sdk-init-next=builda sdk install && builda sdk smoke"
}

function Test-WebSdk {
  $Dst = Join-Path $ProjectStateDir "sdk/web"
  if (!(Test-Path (Join-Path $Dst "builda-sdk.js"))) { throw "Missing $Dst/builda-sdk.js. Run: builda sdk install" }
  if (!(Test-Path (Join-Path $Dst "builda-sdk.d.ts"))) { throw "Missing $Dst/builda-sdk.d.ts. Run: builda sdk install" }
  if (Test-Path $SdkVersionFile) {
    Write-Host "sdk-version=$((Read-Utf8Lines $SdkVersionFile | Select-Object -First 1).Trim())"
  } else {
    Write-Host "sdk-version=unknown"
    Write-Host "sdk-upgrade-hint=run builda sdk install to record the installed SDK version"
  }
  Test-SdkCompat
  Write-Host "sdk=ok"
  Write-Host "sdk-engine=h5"
  Write-Host "sdk-web=$Dst"
}

function Test-UnitySdk {
  $Dst = Join-Path $ProjectStateDir "sdk/web"
  if (!(Test-Path "Assets/Builda/Runtime/Builda.cs")) { throw "Missing Assets/Builda/Runtime/Builda.cs. Run: builda sdk install" }
  if (!(Test-Path "Assets/Builda/Plugins/WebGL/Builda.jslib")) { throw "Missing Assets/Builda/Plugins/WebGL/Builda.jslib. Run: builda sdk install" }
  if (!(Test-Path "Assets/Builda/Runtime/BuildaMic.cs")) { throw "Missing Assets/Builda/Runtime/BuildaMic.cs. Run: builda sdk install" }
  if (!(Test-Path "Assets/Builda/Plugins/WebGL/BuildaMic.jslib")) { throw "Missing Assets/Builda/Plugins/WebGL/BuildaMic.jslib. Run: builda sdk install" }
  if (!(Test-Path "Assets/WebGLTemplates/Builda/index.html")) { throw "Missing Assets/WebGLTemplates/Builda/index.html. Run: builda sdk install" }
  if ((Read-Utf8Text "Assets/WebGLTemplates/Builda/index.html") -notlike "*builda-sdk.js*") {
    throw "Builda WebGL template lost its builda-sdk.js reference. Run: builda sdk install"
  }
  if (!(Test-Path (Join-Path $Dst "builda-sdk.js"))) { throw "Missing $Dst/builda-sdk.js (mock SDK for builda dev). Run: builda sdk install" }
  if (Test-Path $SdkVersionFile) {
    $InstalledSdkVersion = (Read-Utf8Lines $SdkVersionFile | Select-Object -First 1).Trim()
    Write-Host "sdk-version=$InstalledSdkVersion"
    $CsLine = Read-Utf8Lines "Assets/Builda/Runtime/Builda.cs" | Where-Object { $_ -match 'SdkVersion = "([^"]*)"' } | Select-Object -First 1
    if ($CsLine -match 'SdkVersion = "([^"]*)"') {
      $CsVersion = $Matches[1]
      if ($InstalledSdkVersion -and $CsVersion -ne $InstalledSdkVersion) {
        throw "SDK version mismatch: $SdkVersionFile=$InstalledSdkVersion but Assets/Builda/Runtime/Builda.cs=$CsVersion. Run: builda sdk install"
      }
    }
  } else {
    Write-Host "sdk-version=unknown"
    Write-Host "sdk-upgrade-hint=run builda sdk install to record the installed SDK version"
  }
  Test-SdkCompat
  # 分析 Worker 项目所有，缺失只提示不判失败（BuildaMic 可选能力）
  if (Test-Path "Assets/StreamingAssets/builda-mic/builda-mic-worker.js") {
    Write-Host "sdk-mic=Assets/StreamingAssets/builda-mic user-owned"
  } else {
    Write-Host "sdk-mic=missing (rerun builda sdk install to restore the BuildaMic analysis worker)"
  }
  Write-Host "sdk=ok"
  Write-Host "sdk-engine=unity"
  Write-Host "sdk-unity=Assets/Builda"
}

# Get-SdkMockPath 当前项目 mock SDK 的落点（引擎分流；smoke 用；
# h5/unity 都落 $ProjectStateDir/sdk/web/，无 addons 时自动命中）
function Get-SdkMockPath {
  $WebMock = Join-Path $ProjectStateDir "sdk/web/builda-sdk.js"
  if ((Test-Path $WebMock) -and !(Test-Path "addons/builda/web/builda-sdk.js")) { return $WebMock }
  return "addons/builda/web/builda-sdk.js"
}

function Test-Sdk {
  if ((Get-EngineValue ".") -eq "h5") {
    Test-WebSdk
    return
  }
  if ((Get-EngineValue ".") -eq "unity") {
    Test-UnitySdk
    return
  }
  if (!(Test-Path "addons/builda/builda.gd")) { throw "Missing addons/builda/builda.gd. Run: builda sdk install" }
  if (!(Test-Path "addons/builda/web/builda-sdk.js")) { throw "Missing addons/builda/web/builda-sdk.js. Run: builda sdk install" }
  if (!(Test-Path "addons/builda/web/builda-sdk.d.ts")) { throw "Missing addons/builda/web/builda-sdk.d.ts. Run: builda sdk install" }
  $InstalledSdkVersion = ""
  if (Test-Path $SdkVersionFile) {
    $InstalledSdkVersion = (Read-Utf8Lines $SdkVersionFile | Select-Object -First 1).Trim()
    Write-Host "sdk-version=$InstalledSdkVersion"
  } else {
    Write-Host "sdk-version=unknown"
    Write-Host "sdk-upgrade-hint=run builda sdk install to record the installed SDK version"
  }
  $PluginVersion = ""
  if (Test-Path "addons/builda/plugin.cfg") {
    $PluginLine = Read-Utf8Lines "addons/builda/plugin.cfg" | Where-Object { $_ -match '^version="([^"]*)"' } | Select-Object -First 1
    if ($PluginLine -match '^version="([^"]*)"') { $PluginVersion = $Matches[1] }
  }
  if ($PluginVersion) {
    Write-Host "sdk-addon-version=$PluginVersion"
    if ($InstalledSdkVersion -and $InstalledSdkVersion -ne $PluginVersion) {
      throw "SDK version mismatch: $SdkVersionFile=$InstalledSdkVersion but addons/builda/plugin.cfg=$PluginVersion. Run: builda sdk install"
    }
  } else {
    Write-Host "sdk-addon-version=unknown"
  }
  if ((Test-Path "project.godot") -and ((Read-Utf8Text "project.godot") -match '(?m)^BuildaClient="\*res://scripts/BuildaClient\.gd"') -and !(Test-Path "scripts/BuildaClient.gd")) {
    throw "Autoload BuildaClient points to missing scripts/BuildaClient.gd. Run: builda sdk install"
  }
  if (Test-Path "scripts/BuildaClient.gd") { Write-Host "sdk-client=scripts/BuildaClient.gd user-owned" } else { Write-Host "sdk-client=missing" }
  Test-SdkCompat
  Write-Host "sdk=ok"
  Write-Host "sdk-addon=addons/builda"
}

function Write-SdkSmokeNextHint {
  param([string]$Engine)
  switch ($Engine) {
    "godot" { Write-Host "sdk-next=export Godot Web build, then run builda dev --web <export directory or zip>" }
    "h5" { Write-Host "sdk-next=run builda dev --web <H5 build directory or zip>" }
    "unity" { Write-Host "sdk-next=build Unity WebGL, then run builda dev --web <WebGL build directory or zip>" }
    default { Write-Host "sdk-next=run builda dev --web <web build directory or zip>" }
  }
  Write-Host "sdk-next-url=?gameId=local-game&builda_mock_player=alice&builda_mock_name=Alice"
}

function Invoke-SdkSmoke {
  Test-Sdk | Out-Null
  $Engine = Get-EngineValue "."
  if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "sdk-smoke=manual"
    Write-SdkSmokeNextHint $Engine
    Write-Host "Then call Builda.whoami() and Builda.privateKV.set/get/remove."
    return
  }
  $Script = @'
const fs = require("fs");
const vm = require("vm");
const store = new Map();
global.window = {
  location: { search: "?gameId=local-game&builda_mock_player=alice&builda_mock_name=Alice" },
  localStorage: {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  }
};
global.URLSearchParams = URLSearchParams;
global.fetch = async () => { throw new Error("local mock smoke must not call fetch"); };
vm.runInThisContext(fs.readFileSync(process.env.BUILDA_SMOKE_SDK || "addons/builda/web/builda-sdk.js", "utf8"));
(async () => {
  const who = await window.Builda.whoami();
  if (!who.ok || who.data.id !== "alice") throw new Error("whoami mock failed");
  const save = new TextEncoder().encode(JSON.stringify({ count: 3 }));
  const set = await window.Builda.privateKV.set("wins", save);
  if (!set.ok) throw new Error("privateKV.set mock failed");
  const got = await window.Builda.privateKV.get("wins");
  if (!got.ok || !(got.data instanceof Uint8Array) || JSON.parse(new TextDecoder().decode(got.data)).count !== 3) throw new Error("privateKV.get mock failed");
  const setMany = await window.Builda.privateKV.setMany({ a: new Uint8Array([1]), b: new Uint8Array([2, 2]) });
  if (!setMany.ok) throw new Error("privateKV.setMany mock failed");
  const gotMany = await window.Builda.privateKV.getMany(["a", "b", "absent"]);
  if (!gotMany.ok || gotMany.data.entries.a.length !== 1 || gotMany.data.entries.b.length !== 2 || gotMany.data.entries.absent !== null) throw new Error("privateKV.getMany mock failed");
  const tooBig = await window.Builda.privateKV.set("big", new Uint8Array(32 * 1024 + 1));
  if (tooBig.ok || tooBig.error.code !== "VALUE_TOO_LARGE") throw new Error("privateKV value size limit not enforced");
  const removedMany = await window.Builda.privateKV.removeMany(["a", "b"]);
  if (!removedMany.ok) throw new Error("privateKV.removeMany mock failed");
  const removed = await window.Builda.privateKV.remove("wins");
  if (!removed.ok) throw new Error("privateKV.remove mock failed");
  const missing = await window.Builda.privateKV.get("wins");
  if (!missing.ok || missing.data !== null) throw new Error("privateKV.remove verification failed");
  console.log("sdk-smoke=ok");
  console.log("sdk-mode=local-mock");
  console.log("sdk-smoke-verified=whoami,privateKV.set,privateKV.get,privateKV.setMany,privateKV.getMany,privateKV.removeMany,privateKV.remove");
})().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
'@
  $env:BUILDA_SMOKE_SDK = Get-SdkMockPath
  try {
    $Script | node
  } finally {
    Remove-Item Env:BUILDA_SMOKE_SDK -ErrorAction SilentlyContinue
  }
  if ($LASTEXITCODE -ne 0) { throw "sdk smoke failed" }
  Write-SdkSmokeNextHint $Engine
}

function Save-Grant {
  param([string]$Grant)
  if (!$Grant) { throw "empty grant" }
  if ([System.IO.Path]::GetFullPath($AuthDir) -eq $SelfDir) { Write-StateGitignore }
  New-Item -ItemType Directory -Force -Path $AuthDir | Out-Null
  $Grant | Set-Content -Encoding ASCII $TokenPath
  Write-Host "Agent grant saved for 30 minutes."
}

function Save-Refresh {
  param([string]$Refresh)
  if (!$Refresh) { return }
  if ([System.IO.Path]::GetFullPath($AuthDir) -eq $SelfDir) { Write-StateGitignore }
  New-Item -ItemType Directory -Force -Path $AuthDir | Out-Null
  $Refresh | Set-Content -Encoding ASCII $RefreshPath
  Write-Host "Agent authorization saved for 30 days."
}

function Grant-NeedsRefresh {
  if (!(Test-Path $RefreshPath)) { return $false }
  if (!(Test-Path $TokenPath)) { return $true }
  $Age = (Get-Date) - (Get-Item $TokenPath).LastWriteTime
  return $Age.TotalSeconds -ge 1500
}

function Test-GrantFresh {
  if (!(Test-Path $TokenPath)) { return $false }
  $Age = (Get-Date) - (Get-Item $TokenPath).LastWriteTime
  return $Age.TotalSeconds -lt 1500
}

function Test-GrantWithServer {
  if (!(Test-Path $TokenPath)) { return $false }
  $Response = Invoke-BuildaHttpRequest -Method "GET" -Uri "$Base/api/v1/agent/whoami" -Headers @{ Authorization = "Bearer $(Get-Token)" }
  if ($Response.Status -eq 0) {
    throw "AUTH_REFRESH_NETWORK_ERROR: authorization validation transport unavailable (kind=$($Response.Error)); saved authorization was preserved."
  }
  if ($Response.Status -eq 200) { return $true }
  if ($Response.Status -eq 401 -or $Response.Status -eq 403) { return $false }
  throw "AUTH_REFRESH_SERVER_ERROR: authorization validation unavailable (HTTP $($Response.Status)); saved authorization was preserved."
}

function Refresh-Grant {
  if (!(Test-Path $RefreshPath)) { throw "No saved agent authorization." }
  $Refresh = (Read-Utf8Text $RefreshPath).Trim()
  if (!$Refresh) { throw "Empty saved agent authorization." }
  [byte[]]$BodyBytes = [System.Text.Encoding]::UTF8.GetBytes((@{ refresh_token = $Refresh } | ConvertTo-Json -Compress))
  $Response = Invoke-BuildaHttpRequest -Method "POST" -Uri "$Base/api/v1/agent/auth/refresh" -BodyBytes $BodyBytes -ContentType "application/json"
  if ($Response.Status -eq 0) {
    throw "AUTH_REFRESH_NETWORK_ERROR: transport unavailable (kind=$($Response.Error)); saved authorization was preserved."
  }
  if ($Response.Status -eq 401 -or $Response.Status -eq 403) {
    throw "AUTH_REFRESH_CREDENTIAL_INVALID: saved authorization was rejected; browser authorization is required."
  }
  if ($Response.Status -eq 400 -and ([string]$Response.Body -match '(?i)invalid[_ -]?grant|invalid[_ -]?token|refresh[_ -]?token.*(invalid|expired)')) {
    throw "AUTH_REFRESH_CREDENTIAL_INVALID: saved authorization is invalid or expired; browser authorization is required."
  }
  if (!$Response.IsSuccess) {
    throw "AUTH_REFRESH_SERVER_ERROR: refresh service unavailable (HTTP $($Response.Status)); saved authorization was preserved."
  }
  $Resp = if ([string]::IsNullOrWhiteSpace([string]$Response.Body)) { $null } else { [string]$Response.Body | ConvertFrom-Json }
  if (!$Resp -or !$Resp.token) { throw "AUTH_REFRESH_SERVER_ERROR: successful refresh response did not contain a grant; saved authorization was preserved." }
  Save-Grant $Resp.token | Out-Null
  Write-Host "Agent grant refreshed automatically."
}

function Write-AuthStatus {
  Write-Host "auth-dir=$AuthDir"
  if ($env:BUILDA_AUTH_DIR) { Write-Host "auth-store=custom" } else { Write-Host "auth-store=user" }
  if (Test-Path $TokenPath) { Write-Host "grant=present" } else { Write-Host "grant=missing" }
  if (Test-Path $RefreshPath) { Write-Host "agent-authorization=present" } else { Write-Host "agent-authorization=missing" }
}

function Logout-Authorization {
  try {
    foreach ($CredentialPath in @($TokenPath, $RefreshPath)) {
      if (Test-Path $CredentialPath) { Remove-Item -Force -ErrorAction Stop $CredentialPath }
    }
  } catch {
    throw "BUILDA_AUTH_LOGOUT_FAILED: credentials could not be removed from $AuthDir."
  }
  if ((Test-Path $TokenPath) -or (Test-Path $RefreshPath)) {
    throw "BUILDA_AUTH_LOGOUT_FAILED: credentials remain in $AuthDir."
  }
  Write-Host "authorization=logged-out"
  Write-Host "auth-dir=$AuthDir"
}

function Auth-WithPairCode {
  param([string]$Code)
  [byte[]]$BodyBytes = [System.Text.Encoding]::UTF8.GetBytes((@{ code = $Code } | ConvertTo-Json -Compress))
  $Response = Invoke-BuildaHttpRequest -Method "POST" -Uri "$Base/api/v1/agent/exchange" -BodyBytes $BodyBytes -ContentType "application/json"
  if ($Response.Status -eq 0) {
    throw "AUTH_EXCHANGE_NETWORK_ERROR: pair code exchange transport unavailable (kind=$($Response.Error))."
  }
  if ($Response.Status -eq 400 -or $Response.Status -eq 401 -or $Response.Status -eq 403 -or $Response.Status -eq 404) {
    Write-Host "Pair code exchange failed or expired. Starting browser authorization instead."
    Auth-WithBrowser
    return
  }
  if (!$Response.IsSuccess) { throw "AUTH_EXCHANGE_SERVER_ERROR: pair code exchange unavailable (HTTP $($Response.Status))." }
  $Resp = if ([string]::IsNullOrWhiteSpace([string]$Response.Body)) { $null } else { [string]$Response.Body | ConvertFrom-Json }
  if (!$Resp -or !$Resp.token) { throw "AUTH_EXCHANGE_SERVER_ERROR: successful pair code exchange did not contain a grant." }
  Save-Grant $Resp.token
  Save-Refresh $Resp.refresh_token
}

function Auth-WithBrowser {
  $AuthBody = if ($SiteOrigin) { @{ site_origin = $SiteOrigin } | ConvertTo-Json -Compress } else { "{}" }
  $Resp = Invoke-BuildaJsonRequest -Method "POST" -Uri "$Base/api/v1/agent/auth/start" -Body $AuthBody
  if (!$Resp.auth_id -or !$Resp.authorize_url) { throw "Auth start failed." }
  $Interval = if ($Resp.interval) { [int]$Resp.interval } else { 2 }
  $Expires = if ($Resp.expires_in) { [int]$Resp.expires_in } else { 600 }
  $ActivateUrl = if ($Resp.activate_url) { [string]$Resp.activate_url } else { "$Base/activate" }

  Write-Host "I need your BuildaGame permission to upload a draft."
  Write-Host "authorization-url=$($Resp.authorize_url)"
  Write-Host "Opening the browser authorization page..."
  try {
    Start-Process $Resp.authorize_url | Out-Null
  } catch {
    Write-Host "Open this URL in your browser:"
    Write-Host $Resp.authorize_url
  }
  Write-Host "If the browser did not open, visit:"
  Write-Host $Resp.authorize_url
  if ($Resp.user_code) {
    Write-Host "activation-url=$ActivateUrl"
    Write-Host "authorization-code=$($Resp.user_code)"
    Write-Host ""
    Write-Host "On another device, open:"
    Write-Host $ActivateUrl
    Write-Host "Enter code: $($Resp.user_code)"
  }
  Write-Host "Log in or sign up there, click Allow agent, then return here."

  $Elapsed = 0
  while ($Elapsed -lt $Expires) {
    Start-Sleep -Seconds $Interval
    $Elapsed += $Interval
    $Poll = Invoke-BuildaJsonRequest -Method "GET" -Uri "$Base/api/v1/agent/auth/status?auth_id=$([uri]::EscapeDataString([string]$Resp.auth_id))"
    if ($Poll.status -eq "approved") {
      Save-Grant $Poll.token
      Save-Refresh $Poll.refresh_token
      return
    }
    if ($Poll.status -eq "expired") {
      throw "Authorization expired. Run: builda auth"
    }
    Write-Host -NoNewline "."
  }
  Write-Host ""
  throw "Authorization timed out. Run: builda auth"
}

function Ensure-Authorization {
  param([string]$Code)
  if ((Test-GrantFresh) -and (Test-GrantWithServer)) {
    Write-Host "authorization=ready"
    Write-Host "grant=present"
    if (Test-Path $RefreshPath) { Write-Host "agent-authorization=present" } else { Write-Host "agent-authorization=missing" }
    return
  }
  if (Test-Path $RefreshPath) {
    try {
      Refresh-Grant
      Write-Host "authorization=ready"
      Write-Host "grant=present"
      Write-Host "agent-authorization=present"
      return
    } catch {
      $RefreshError = [string]$_.Exception.Message
      if (!$RefreshError.StartsWith("AUTH_REFRESH_CREDENTIAL_INVALID:")) { throw }
      Write-Host "Saved agent authorization is invalid; starting browser authorization."
    }
  }
  if ($Code) {
    Auth-WithPairCode $Code
  } else {
    Auth-WithBrowser
  }
  Write-Host "authorization=ready"
  Write-Host "grant=present"
  if (Test-Path $RefreshPath) { Write-Host "agent-authorization=present" } else { Write-Host "agent-authorization=missing" }
}

function Invoke-StudioAuth {
  $Ticket = $env:BUILDA_STUDIO_AUTH_TICKET
  if (!$Ticket) { throw "studio-auth requires BUILDA_STUDIO_AUTH_TICKET" }
  New-Item -ItemType Directory -Force -Path $AuthDir | Out-Null
  if (Test-Path $RefreshPath) { throw "studio-auth refuses an auth directory containing a refresh-token; use an isolated Studio HOME" }
  $Resp = Invoke-BuildaJsonRequest -Method "POST" -Uri "$Base/api/v1/agent/auth/studio-exchange" -Body (@{ ticket = $Ticket } | ConvertTo-Json -Compress)
  if (!$Resp.token) { throw "Studio auth exchange did not return a grant." }
  if (!$Resp.refresh_token) { throw "Studio auth exchange did not return a renewal credential." }
  Save-Grant $Resp.token | Out-Null
  Save-Refresh $Resp.refresh_token | Out-Null
  Write-Host "authorization=ready"
  Write-Host "grant=present"
  Write-Host "agent-authorization=present"
  Write-Host "authorization-source=studio"
}

function Get-BundleIdentity {
  param([string]$Path, [string]$Engine)
  $Resolved = (Resolve-Path $Path).Path
  $Stream = [System.IO.File]::OpenRead($Resolved)
  $Hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $Hash = -join ($Hasher.ComputeHash($Stream) | ForEach-Object { $_.ToString("x2") })
  } finally {
    $Hasher.Dispose()
    $Stream.Dispose()
  }
  $NormalizedEngine = $Engine.Trim().ToLowerInvariant()
  if (!$NormalizedEngine) { $NormalizedEngine = "godot" }
  $LegacyStream = [System.IO.File]::OpenRead($Resolved)
  $LegacyHasher = [System.Security.Cryptography.SHA256]::Create()
  $Crypto = [System.Security.Cryptography.CryptoStream]::new(
    [System.IO.Stream]::Null,
    $LegacyHasher,
    [System.Security.Cryptography.CryptoStreamMode]::Write
  )
  try {
    $LegacyStream.CopyTo($Crypto)
    $Suffix = [System.Text.Encoding]::UTF8.GetBytes("`0$NormalizedEngine")
    $Crypto.Write($Suffix, 0, $Suffix.Length)
    $Crypto.FlushFinalBlock()
    $StudioPayloadHash = -join ($LegacyHasher.Hash | ForEach-Object { $_.ToString("x2") })
  } finally {
    $Crypto.Dispose()
    $LegacyHasher.Dispose()
    $LegacyStream.Dispose()
  }
  @{ Size = (Get-Item $Resolved).Length; Sha256 = $Hash; StudioPayloadHash = $StudioPayloadHash; Path = $Resolved }
}

function Get-UploaderPlatform {
  if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) {
    $OsName = "windows"
  } elseif ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::OSX)) {
    $OsName = "darwin"
  } elseif ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Linux)) {
    $OsName = "linux"
  } else {
    throw "Unsupported uploader OS."
  }
  $Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  $ArchName = switch ($Architecture) {
    "x64" { "amd64" }
    "arm64" { "arm64" }
    default { throw "Unsupported uploader architecture: $Architecture" }
  }
  $Name = "$OsName-$ArchName"
  if ($Name -notin @("darwin-amd64", "darwin-arm64", "linux-amd64", "linux-arm64", "windows-amd64", "windows-arm64")) {
    throw "Uploader Helper is not published for $Name."
  }
  @{ OS = $OsName; Arch = $ArchName; Name = $Name }
}

function Install-UploaderHelper {
  $Platform = Get-UploaderPlatform
  $Suffix = if ($Platform.OS -eq "windows") { ".exe" } else { "" }
  $Artifact = "builda-uploader-$($Platform.Name)$Suffix"
  $Sums = Get-BuildaRemoteUtf8Text -Uri "$AgentBase/agent/releases/$Version/SHA256SUMS"
  $Pattern = "(?m)^([0-9a-f]{64})\s{2}$([regex]::Escape($Artifact))\r?$"
  $Match = [regex]::Match($Sums, $Pattern)
  if (!$Match.Success) { throw "Uploader checksum is missing or invalid for $($Platform.Name)." }
  $Expected = $Match.Groups[1].Value
  $Directory = Join-Path $Root "tools/$Expected/$($Platform.Name)"
  $Binary = Join-Path $Directory "builda-uploader$Suffix"
  if ((Test-Path $Binary) -and ((Get-BuildaFileSha256 $Binary) -eq $Expected)) {
    return $Binary
  }
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  $Temporary = Join-Path $Directory ".download-$PID"
  Remove-Item -Force -ErrorAction SilentlyContinue $Temporary
  try {
    Invoke-BuildaRawDownload -Uri "$AgentBase/agent/releases/$Version/$Artifact" -Destination $Temporary
    if ((Get-BuildaFileSha256 $Temporary) -ne $Expected) {
      throw "Uploader helper checksum mismatch."
    }
    Move-Item -Force $Temporary $Binary
  } finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $Temporary
  }
  return $Binary
}

function Get-StudioUploadHeaders {
  param([string]$IdempotencyKey)
  $Headers = @{ Authorization = "Bearer $(Get-Token)"; "Idempotency-Key" = $IdempotencyKey }
  if ($env:BUILDA_PUBLISH_OPERATION_ID) {
    if (!$env:BUILDA_PUBLISH_LEASE_ID -or !$env:BUILDA_PUBLISH_ATTEMPT) { throw "missing Studio publish lease" }
    $Headers["X-Builda-Studio-Publish-Id"] = $env:BUILDA_PUBLISH_OPERATION_ID
    $Headers["X-Builda-Publish-Lease-Id"] = $env:BUILDA_PUBLISH_LEASE_ID
    $Headers["X-Builda-Publish-Attempt"] = $env:BUILDA_PUBLISH_ATTEMPT
  }
  return $Headers
}

function Get-UploadIdempotencyKey {
  param([string]$Engine, [string]$GameId, [string]$BundleSha256)
  $Scope = "new"
  if ($GameId) {
    $Hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
      $Digest = -join ($Hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($GameId)) | ForEach-Object { $_.ToString("x2") })
    } finally {
      $Hasher.Dispose()
    }
    $Scope = "game-$($Digest.Substring(0, 16))"
  }
  return "build-$Engine-$Scope-$BundleSha256"
}

function Get-DraftIdempotencyKey {
  param([string]$Action, [string]$GameId, [string]$ManifestFile, [bool]$ExistingOnly = $false)
  $PayloadHash = Get-BuildaFileSha256 $ManifestFile
  $Scope = "new"
  if ($GameId) {
    $Hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
      $GameHash = -join ($Hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($GameId)) | ForEach-Object { $_.ToString("x2") })
    } finally {
      $Hasher.Dispose()
    }
    $Scope = $GameHash.Substring(0, 16)
  }
  $Hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $FingerprintInput = "$Action`0$GameId`0$PayloadHash"
    $Fingerprint = -join ($Hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($FingerprintInput)) | ForEach-Object { $_.ToString("x2") })
  } finally {
    $Hasher.Dispose()
  }
  $Receipt = Join-Path $Root "last-draft-operation-$Fingerprint"
  $Prefix = "draft-$Action-$Scope-$PayloadHash-"
  if ($ExistingOnly) {
    if ($Action -eq "create" -and !$GameId -and !(Test-Path $Receipt)) {
      $PendingOperations = @()
      foreach ($PendingReceipt in @(Get-ChildItem -Path $Root -Filter "last-draft-operation-*" -File -ErrorAction SilentlyContinue)) {
        try { $PendingOperation = (Read-Utf8Text $PendingReceipt.FullName).Trim() } catch { continue }
        if ($PendingOperation -match '^draft-create-new-[0-9a-f]{64}-[0-9a-f]{32}$') {
          $PendingOperations += $PendingOperation
        }
      }
      if ($PendingOperations.Count -eq 1) { return $PendingOperations[0] }
      if ($PendingOperations.Count -gt 1) {
        throw "multiple pending Windows draft operations found; keep the intended receipt and retry"
      }
    }
    for ($Attempt = 0; $Attempt -lt 50; $Attempt++) {
      if (!(Test-Path $Receipt)) { return "" }
      try { $Operation = (Read-Utf8Text $Receipt).Trim() } catch { $Operation = "" }
      if ($Operation -match ("^" + [regex]::Escape($Prefix) + "[0-9a-f]{32}$")) { return $Operation }
      Start-Sleep -Milliseconds 20
    }
    throw "invalid or incomplete draft operation receipt: $Receipt; retry, or remove it if no publish is running"
  }
  $Stream = $null
  try {
    $Stream = [System.IO.File]::Open($Receipt, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  } catch [System.IO.IOException] {
    $Operation = ""
    for ($Attempt = 0; $Attempt -lt 50; $Attempt++) {
      try { $Operation = (Read-Utf8Text $Receipt).Trim() } catch { $Operation = "" }
      if ($Operation -match ("^" + [regex]::Escape($Prefix) + "[0-9a-f]{32}$")) { break }
      Start-Sleep -Milliseconds 20
    }
    if ($Operation -notmatch ("^" + [regex]::Escape($Prefix) + "[0-9a-f]{32}$")) {
      throw "invalid or incomplete draft operation receipt: $Receipt; retry, or remove it if no publish is running"
    }
  }
  if ($Stream) {
    try {
      $Operation = $Prefix + [System.Guid]::NewGuid().ToString("N")
      $Bytes = [System.Text.Encoding]::ASCII.GetBytes("$Operation`n")
      $Stream.Write($Bytes, 0, $Bytes.Length)
      $Stream.Flush($true)
    } finally {
      $Stream.Dispose()
    }
  }
  return $Operation
}

function Complete-DraftIdempotencyKey {
  param([string]$Operation)
  foreach ($Receipt in @(Get-ChildItem -Path $Root -Filter "last-draft-operation-*" -File -ErrorAction SilentlyContinue)) {
    try { $Saved = (Read-Utf8Text $Receipt.FullName).Trim() } catch { continue }
    if ($Saved -eq $Operation) {
      Remove-Item -Force $Receipt.FullName
      return
    }
  }
}

function Invoke-UploadSessionRequest {
  param([string]$Method, [string]$Uri, [hashtable]$Headers, [string]$Body = "")
  [byte[]]$BodyBytes = @()
  if ($Body) { $BodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body) }
  return Invoke-BuildaAuthenticatedRequest -Method $Method -Uri $Uri -Headers $Headers -BodyBytes $BodyBytes -ContentType "application/json" -AllowHttpFailure
}

function Test-BuildaHttpTimeoutException {
  param([System.Exception]$Exception)
  $Pending = New-Object System.Collections.ArrayList
  $Seen = New-Object System.Collections.ArrayList
  if ($null -ne $Exception) { [void]$Pending.Add($Exception) }
  while ($Pending.Count -gt 0) {
    $Current = $Pending[0]
    $Pending.RemoveAt(0)
    $AlreadySeen = $false
    foreach ($Item in $Seen) {
      if ([object]::ReferenceEquals($Item, $Current)) { $AlreadySeen = $true; break }
    }
    if ($AlreadySeen) { continue }
    [void]$Seen.Add($Current)
    if ($Current -is [System.OperationCanceledException]) { return $true }
    if ($null -ne $Current.InnerException) { [void]$Pending.Add($Current.InnerException) }
    try {
      $BaseException = $Current.GetBaseException()
      if ($null -ne $BaseException -and ![object]::ReferenceEquals($BaseException, $Current)) { [void]$Pending.Add($BaseException) }
    } catch {}
    $ErrorRecordProperty = $Current.PSObject.Properties["ErrorRecord"]
    if ($ErrorRecordProperty -and $null -ne $ErrorRecordProperty.Value -and $null -ne $ErrorRecordProperty.Value.Exception) {
      [void]$Pending.Add($ErrorRecordProperty.Value.Exception)
    }
    $WrappedExceptionProperty = $Current.PSObject.Properties["Exception"]
    if ($WrappedExceptionProperty -and $null -ne $WrappedExceptionProperty.Value -and $WrappedExceptionProperty.Value -is [System.Exception]) {
      [void]$Pending.Add($WrappedExceptionProperty.Value)
    }
  }
  return $false
}

function Invoke-BuildaHttpRequest {
  param(
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers = @{},
    [byte[]]$BodyBytes = @(),
    [string]$ContentType = "application/json",
    [int]$TimeoutSeconds = 100
  )
  Add-Type -AssemblyName System.Net.Http
  $Handler = $null
  $Client = $null
  $Request = $null
  $Response = $null
  try {
    $Handler = New-Object System.Net.Http.HttpClientHandler
    $Client = New-Object -TypeName System.Net.Http.HttpClient -ArgumentList @(,$Handler)
    $Client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
    $HttpMethod = New-Object -TypeName System.Net.Http.HttpMethod -ArgumentList @($Method)
    $Request = New-Object -TypeName System.Net.Http.HttpRequestMessage -ArgumentList @($HttpMethod, [System.Uri]$Uri)
    foreach ($Name in $Headers.Keys) {
      [void]$Request.Headers.TryAddWithoutValidation([string]$Name, [string]$Headers[$Name])
    }
    if ($BodyBytes.Count -gt 0) {
      $Request.Content = New-Object System.Net.Http.ByteArrayContent -ArgumentList @(,$BodyBytes)
      $Request.Content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue($ContentType)
    }
    $Response = $Client.SendAsync($Request).GetAwaiter().GetResult()
    $ResponseBytes = $Response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $ResponseBody = [System.Text.Encoding]::UTF8.GetString($ResponseBytes)
    $ResponseHeaders = @{}
    foreach ($Header in $Response.Headers) { $ResponseHeaders[$Header.Key] = [string]::Join(",", $Header.Value) }
    foreach ($Header in $Response.Content.Headers) { $ResponseHeaders[$Header.Key] = [string]::Join(",", $Header.Value) }
    return @{ Status = [int]$Response.StatusCode; Headers = $ResponseHeaders; Body = $ResponseBody; IsSuccess = [bool]$Response.IsSuccessStatusCode; Error = "" }
  } catch {
    $Kind = if (Test-BuildaHttpTimeoutException $_.Exception) { "timeout" } else { "network" }
    return @{ Status = 0; Headers = @{}; Body = ""; IsSuccess = $false; Error = $Kind }
  } finally {
    foreach ($Disposable in @($Response, $Request, $Client, $Handler)) {
      if ($null -ne $Disposable -and $Disposable -is [System.IDisposable]) { $Disposable.Dispose() }
    }
  }
}

function Format-BuildaHttpFailure {
  param([hashtable]$Response)
  if ($Response.Status -eq 0) { return "BUILDA_HTTP_ERROR: kind=$($Response.Error)" }
  $SafeBody = [string]$Response.Body
  $SafeBody = [regex]::Replace($SafeBody, '(?i)("(?:authorization|token|refresh_token|cookie|signature|url)"\s*:\s*)"[^"]*"', '$1"<redacted>"')
  $SafeBody = [regex]::Replace($SafeBody, '(?i)(https://[^\s?"'']+)\?[^\s"'']+', '$1?<redacted>')
  if ($SafeBody.Length -gt 512) { $SafeBody = $SafeBody.Substring(0, 512) }
  return "BUILDA_HTTP_ERROR: status=$($Response.Status) body=$SafeBody"
}

function Invoke-BuildaJsonRequest {
  param([string]$Method, [string]$Uri, [hashtable]$Headers = @{}, [string]$Body = "")
  [byte[]]$BodyBytes = @()
  if ($Body) { $BodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body) }
  $Response = Invoke-BuildaHttpRequest -Method $Method -Uri $Uri -Headers $Headers -BodyBytes $BodyBytes -ContentType "application/json"
  if (!$Response.IsSuccess) { throw (Format-BuildaHttpFailure $Response) }
  if ([string]::IsNullOrWhiteSpace([string]$Response.Body)) { return $null }
  return ([string]$Response.Body | ConvertFrom-Json)
}

function Invoke-BuildaAuthenticatedRequest {
  param(
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers = @{},
    [byte[]]$BodyBytes = @(),
    [string]$ContentType = "application/json",
    [switch]$AllowHttpFailure
  )
  $RequestHeaders = @{}
  foreach ($Name in $Headers.Keys) { $RequestHeaders[$Name] = $Headers[$Name] }
  $RequestHeaders["Authorization"] = "Bearer $(Get-Token)"
  $Response = Invoke-BuildaHttpRequest -Method $Method -Uri $Uri -Headers $RequestHeaders -BodyBytes $BodyBytes -ContentType $ContentType
  if ($Response.Status -eq 401 -and (Test-Path $RefreshPath)) {
    try {
      Refresh-Grant | Out-Null
      $RequestHeaders["Authorization"] = "Bearer $(Get-Token)"
      $Response = Invoke-BuildaHttpRequest -Method $Method -Uri $Uri -Headers $RequestHeaders -BodyBytes $BodyBytes -ContentType $ContentType
    } catch {
      $RefreshFailure = [string]$_.Exception.Message
      if (!$RefreshFailure.StartsWith("AUTH_REFRESH_CREDENTIAL_INVALID:")) { throw }
    }
  }
  if ($Response.Status -eq 401) { throw "BUILDA_AUTH_REJECTED: authorization was rejected after one refresh" }
  if (!$Response.IsSuccess -and !$AllowHttpFailure) { throw (Format-BuildaHttpFailure $Response) }
  return $Response
}

function Invoke-BuildaCurlUploadWithAuthRetry {
  param([string]$Label, [string[]]$CurlArguments)
  if (!(Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw "curl.exe is required for $Label on Windows." }
  $BodyPath = Join-Path ([System.IO.Path]::GetTempPath()) ("builda-curl-" + [System.Guid]::NewGuid().ToString("N") + ".json")
  try {
    for ($Attempt = 0; $Attempt -lt 2; $Attempt++) {
      $Arguments = @("-sS", "-o", $BodyPath, "-w", "%{http_code}") + $CurlArguments + @("-H", "Authorization: Bearer $(Get-Token)")
      $StatusText = & curl.exe @Arguments
      $CurlExitCode = $LASTEXITCODE
      $Body = if (Test-Path $BodyPath) { Read-Utf8Text $BodyPath } else { "" }
      $Status = 0
      [void][int]::TryParse(($StatusText -join "").Trim(), [ref]$Status)
      if ($Status -eq 401 -and $Attempt -eq 0 -and (Test-Path $RefreshPath)) {
        try { Refresh-Grant | Out-Null; continue } catch {
          $RefreshFailure = [string]$_.Exception.Message
          if (!$RefreshFailure.StartsWith("AUTH_REFRESH_CREDENTIAL_INVALID:")) { throw }
        }
      }
      if ($Status -eq 401) { throw "BUILDA_AUTH_REJECTED: authorization was rejected after one refresh" }
      if ($CurlExitCode -ne 0) { throw "BUILDA_HTTP_ERROR: kind=network curlExit=$CurlExitCode" }
      if ($Status -lt 200 -or $Status -ge 300) {
        throw (Format-BuildaHttpFailure @{ Status = $Status; Headers = @{}; Body = $Body; IsSuccess = $false; Error = "" })
      }
      return $Body
    }
  } finally {
    Remove-Item -Force $BodyPath -ErrorAction SilentlyContinue
  }
  throw "BUILDA_AUTH_REJECTED: authorization was rejected after one refresh"
}

function Invoke-DraftRequestWithAuthRetry {
  param([string]$Uri, [hashtable]$Headers, [byte[]]$BodyBytes)
  $Response = Invoke-BuildaAuthenticatedRequest -Method "POST" -Uri $Uri -Headers $Headers -BodyBytes $BodyBytes -ContentType "application/json"
  if ([string]::IsNullOrWhiteSpace([string]$Response.Body)) { return $null }
  return ([string]$Response.Body | ConvertFrom-Json)
}

function New-UploaderConfiguration {
  param(
    [string]$File,
    [string]$AgentVersion,
    [string]$HelperVersion,
    [string]$OS,
    [string]$Architecture,
    [string]$SessionJson
  )
  $TrimmedSession = $SessionJson.Trim()
  if (!$TrimmedSession.StartsWith("{") -or !$TrimmedSession.EndsWith("}")) {
    throw "BUILDA_UPLOADER_CONFIG_INVALID: field=session reason=expected_json_object"
  }
  # Preserve the server's canonical JSON bytes for the session object. Windows PowerShell 5.1
  # may otherwise coerce 64-bit JSON numbers while round-tripping ConvertFrom/ConvertTo-Json.
  $Metadata = @{
    schemaVersion = 1
    file = $File
    agentVersion = $AgentVersion
    helperVersion = $HelperVersion
    os = $OS
    arch = $Architecture
  } | ConvertTo-Json -Compress
  if (!$Metadata.EndsWith("}")) {
    throw "BUILDA_UPLOADER_CONFIG_INVALID: field=metadata reason=encode_failed"
  }
  return $Metadata.Substring(0, $Metadata.Length - 1) + ',"session":' + $TrimmedSession + '}'
}

function Invoke-UploaderHelper {
  param([string]$Binary, [string]$Configuration)
  $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $StartInfo.FileName = $Binary
  $StartInfo.UseShellExecute = $false
  $StartInfo.CreateNoWindow = $true
  $StartInfo.RedirectStandardInput = $true
  $StartInfo.RedirectStandardOutput = $true
  # stderr is intentionally inherited: progress never contaminates the Build DTO on stdout.
  $StartInfo.RedirectStandardError = $false
  $Process = New-Object System.Diagnostics.Process
  $Process.StartInfo = $StartInfo
  if (!$Process.Start()) { throw "Failed to start uploader helper." }
  $InputBytes = [System.Text.Encoding]::UTF8.GetBytes("$Configuration`n")
  $InputStream = $Process.StandardInput.BaseStream
  $InputStream.Write($InputBytes, 0, $InputBytes.Length)
  $InputStream.Flush()
  $InputStream.Close()
  $OutputBytes = New-Object System.IO.MemoryStream
  try {
    $Process.StandardOutput.BaseStream.CopyTo($OutputBytes)
    $Output = [System.Text.Encoding]::UTF8.GetString($OutputBytes.ToArray())
  } finally {
    $OutputBytes.Dispose()
  }
  $Process.WaitForExit()
  if ($Process.ExitCode -ne 0) { throw "Uploader helper failed with exit code $($Process.ExitCode)." }
  return $Output.Trim()
}

function Invoke-LegacyBuildUpload {
  param([string]$Zip, [string]$Engine)
  if (!(Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw "curl.exe is required for legacy build upload on Windows." }
  $Arguments = @("-X", "POST", "$Base/api/v1/uploads/build")
  if ($env:BUILDA_PUBLISH_OPERATION_ID) {
    $Headers = Get-StudioUploadHeaders $env:BUILDA_PUBLISH_OPERATION_ID
    $Arguments += @(
      "-H", "Idempotency-Key: $($Headers['Idempotency-Key'])",
      "-H", "X-Builda-Studio-Publish-Id: $($Headers['X-Builda-Studio-Publish-Id'])",
      "-H", "X-Builda-Publish-Lease-Id: $($Headers['X-Builda-Publish-Lease-Id'])",
      "-H", "X-Builda-Publish-Attempt: $($Headers['X-Builda-Publish-Attempt'])"
    )
  }
  $Arguments += @("-F", "file=@$Zip", "-F", "engine=$Engine")
  return Invoke-BuildaCurlUploadWithAuthRetry -Label "build upload" -CurlArguments $Arguments
}

function Invoke-ResumableBuildUpload {
  param([string]$Zip, [string]$Engine)
  $Identity = Get-BundleIdentity $Zip $Engine
  $GameId = Get-ProjectGameId
  $Idempotency = if ($env:BUILDA_PUBLISH_OPERATION_ID) {
    $env:BUILDA_PUBLISH_OPERATION_ID
  } else {
    Get-UploadIdempotencyKey $Engine $GameId $Identity.Sha256
  }
  $Headers = Get-StudioUploadHeaders $Idempotency
  $RequestPayload = @{
    engine = $Engine; gameId = $GameId; expectedSize = $Identity.Size
    expectedSha256 = $Identity.Sha256; idempotencyKey = $Idempotency
  }
  if ($env:BUILDA_PUBLISH_OPERATION_ID) { $RequestPayload["studioPayloadHash"] = $Identity.StudioPayloadHash }
  $RequestBody = $RequestPayload | ConvertTo-Json -Compress
  $Response = Invoke-UploadSessionRequest -Method Post -Uri "$Base/api/v1/uploads/build/sessions" -Headers $Headers -Body $RequestBody
  if ($Response.Status -in @(404, 405)) {
    if ($Identity.Size -le 209715200) {
      Write-Error "upload-session=unsupported; falling back to the legacy <=200MiB upload" -ErrorAction Continue
      $LegacyResult = Invoke-LegacyBuildUpload $Identity.Path $Engine
      return $LegacyResult
    }
    throw "This server does not support resumable upload, and the bundle exceeds the legacy 200MiB limit."
  }
  if ($Response.Status -notin @(200, 201)) {
    throw "create upload session failed: $(Format-BuildaHttpFailure $Response)"
  }
  $Session = $Response.Body | ConvertFrom-Json
  if ($Session.status -eq "ready" -and $Session.result) {
    return ($Session.result | ConvertTo-Json -Depth 8 -Compress)
  }
  if ($Session.status -notin @("created", "uploading", "uploaded", "validating", "promoting", "retry_wait")) {
    throw "Upload session cannot continue: status=$($Session.status)"
  }
  $Platform = Get-UploaderPlatform
  $Helper = Install-UploaderHelper
  $Configuration = New-UploaderConfiguration -File $Identity.Path -AgentVersion $Version -HelperVersion $Version -OS $Platform.OS -Architecture $Platform.Arch -SessionJson ([string]$Response.Body)
  $HelperResult = Invoke-UploaderHelper $Helper $Configuration
  return $HelperResult
}

function Get-UploadSessionStatus {
  param([string]$SessionId)
  if (!$SessionId) { throw "Usage: builda upload-status <session>" }
  $Idempotency = if ($env:BUILDA_PUBLISH_OPERATION_ID) { $env:BUILDA_PUBLISH_OPERATION_ID } else { "inspect-$SessionId" }
  $Response = Invoke-UploadSessionRequest -Method Post -Uri "$Base/api/v1/uploads/build/sessions/$SessionId/inspect" -Headers (Get-StudioUploadHeaders $Idempotency)
  if ($Response.Status -ne 200) { throw "query upload session failed: HTTP $($Response.Status): $($Response.Body)" }
  $Session = $Response.Body | ConvertFrom-Json
  [int64]$UploadedBytes = 0
  foreach ($Part in @($Session.parts)) { $UploadedBytes += [int64]$Part.size }
  $Result = [ordered]@{
    id = $Session.id; status = $Session.status; engine = $Session.engine
    expectedSize = $Session.expectedSize; uploadedBytes = $UploadedBytes
    effectiveLimitBytes = $Session.effectiveLimitBytes; expiresAt = $Session.expiresAt
  }
  if ($Session.errorCode) { $Result["errorCode"] = $Session.errorCode }
  if ($Session.errorMessage) { $Result["errorMessage"] = $Session.errorMessage }
  if ($Session.result) { $Result["result"] = $Session.result }
  $Result | ConvertTo-Json -Depth 10 -Compress
}

function Cancel-UploadSession {
  param([string]$SessionId)
  if (!$SessionId) { throw "Usage: builda upload-cancel <session>" }
  $Idempotency = if ($env:BUILDA_PUBLISH_OPERATION_ID) { $env:BUILDA_PUBLISH_OPERATION_ID } else { "cancel-$SessionId" }
  $Headers = Get-StudioUploadHeaders $Idempotency
  $Response = Invoke-UploadSessionRequest -Method Post -Uri "$Base/api/v1/uploads/build/sessions/$SessionId/cancel" -Headers $Headers
  if ($Response.Status -ne 204) { throw "cancel upload session failed: HTTP $($Response.Status): $($Response.Body)" }
}

$Cmd = if ($args.Count -gt 0) { $args[0] } else { "" }
[string[]]$Rest = if ($args.Count -gt 1) { @($args[1..($args.Count - 1)]) } else { @() }
if ($Cmd -notin @("", "-h", "--help", "help", "version", "--version", "-v")) {
  Require-ProjectContext -OriginalArgs $args
}
Invoke-LegacyAuthMigrate
if ($Cmd -ne "studio-auth") { Maybe-SelfUpdate -OriginalArgs $args }

switch ($Cmd) {
  "studio-auth" {
    Invoke-StudioAuth
  }
  "auth" {
    $AuthArg = if ($Rest.Count -gt 0) { $Rest[0] } else { "" }
    if ($AuthArg -eq "status") {
      Write-AuthStatus
    } elseif ($AuthArg -eq "logout") {
      Logout-Authorization
    } elseif ($AuthArg -eq "--force") {
      Auth-WithBrowser
      Write-Host "authorization=ready"
      Write-Host "grant=present"
      Write-Host "agent-authorization=present"
    } else {
      $Code = if ($AuthArg) { $AuthArg } else { $PairCode }
      Ensure-Authorization $Code
    }
  }
  "check" {
    Check-SelfUpdate
    Sync-ProjectRegistrations *> $null
    Write-Host "project-registrations=ensured"
    Write-Host "BUILDA_BASE=$Base"
    Write-Host "BUILDA_AGENT_BASE=$AgentBase"
    if (Test-Path $TokenPath) { Write-Host "grant=present" } else { Write-Host "grant=missing" }
    if (Test-Path $RefreshPath) { Write-Host "agent-authorization=present" } else { Write-Host "agent-authorization=missing" }
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) { Write-Host "curl=ok" } else { Write-Host "curl=missing" }
    Write-Host "engine=$(Get-EngineValue '.')"
    if (Test-Path $ProjectFile) {
      $ProjectGameId = Get-ProjectGameId
      if ($ProjectGameId) { Write-Host "project-game-id=$ProjectGameId" } else { Write-Host "project-game-id=invalid" }
      Write-Host "project-state-dir=$(Split-Path -Parent $ProjectFile)"
    } elseif (Test-Path $LegacyProjectFile) {
      $ProjectGameId = Get-ProjectGameId
      if ($ProjectGameId) { Write-Host "project-game-id=$ProjectGameId" } else { Write-Host "project-game-id=invalid" }
      Write-Host "project-binding=$ProjectFile"
      Write-Host "project-state-dir=$(Split-Path -Parent $ProjectFile)"
    } else {
      Write-Host "project-game-id=missing"
    }
  }
  "update" {
    $Remote = Get-BuildaRemoteJson -Uri "$AgentBase/agent/version"
    if (!$Remote.version) { throw "remote Agent version is missing" }
    Update-BuildaTool -NewVersion $Remote.version
  }
  "sync-project" {
    Write-Host "Agent registrations:"
    Sync-ProjectRegistrations
  }
  "engine" {
    $Sub = if ($Rest.Count -gt 0) { $Rest[0] } else { "" }
    switch ($Sub) {
      "detect" {
        $Dir = if ($Rest.Count -gt 1) { $Rest[1] } else { "." }
        Invoke-EngineDetect $Dir
      }
      { $_ -in @("", "-h", "--help", "help") } {
        Write-Host "Usage: builda engine detect [dir]"
      }
      default {
        Write-Error "Unknown engine command: $Sub"
        Write-Host "Usage: builda engine detect [dir]"
        exit 1
      }
    }
  }
  "version" {
    Write-Host $Version
  }
  "--version" {
    Write-Host $Version
  }
  "-v" {
    Write-Host $Version
  }
  "new-manifest" {
    Write-DefaultManifest
  }
  "dev" {
    Invoke-DevServer -DevArgs $Rest
  }
  "bundle-pack" {
    if ($Rest.Count -ne 2) { throw "Usage: builda bundle-pack <build-directory> <output.zip>" }
    New-BundleZip $Rest[0] $Rest[1]
  }
  "bundle-check" {
    if ($Rest.Count -lt 1) { throw "zip file required" }
    $WebViewCompat = $false
    $Engine = ""
    $ZipArg = ""
    for ($I = 0; $I -lt $Rest.Count; $I++) {
      switch -Regex ($Rest[$I]) {
        "^--webview-compatible$" { $WebViewCompat = $true }
        "^--engine$" {
          $I++
          if ($I -ge $Rest.Count) { throw "Usage: builda bundle-check [--engine godot|h5|unity] [--webview-compatible] <zip>" }
          $Engine = $Rest[$I]
        }
        "^--engine=(.*)$" { $Engine = $Matches[1] }
        default { $ZipArg = $Rest[$I] }
      }
    }
    if (!$ZipArg) { throw "zip file required" }
    if ($env:BUILDA_WEBVIEW_COMPAT -eq "1") { $WebViewCompat = $true }
    Test-BundleZip $ZipArg $WebViewCompat $Engine
  }
  "assets" {
    $Sub = if ($Rest.Count -gt 0) { $Rest[0] } else { "" }
    switch ($Sub) {
      "check" {
        if ($Rest.Count -lt 2) { throw "Usage: builda assets check <zip>" }
        Test-AssetsZip $Rest[1]
      }
      "upload" {
        if ($Rest.Count -lt 2) { throw "Usage: builda assets upload <zip>" }
        Upload-AssetsZip $Rest[1]
      }
      { $_ -in @("", "-h", "--help", "help") } {
        Write-Host "Usage: builda assets check <zip> | upload <zip>"
      }
      default {
        Write-Error "Unknown assets command: $Sub"
        Write-Host "Usage: builda assets check <zip> | upload <zip>"
        exit 1
      }
    }
  }
  "sdk" {
    $Sub = if ($Rest.Count -gt 0) { $Rest[0] } else { "" }
    switch ($Sub) {
      "init" { Initialize-SdkProject }
      "install" { Install-Sdk }
      "check" { Test-Sdk }
      "smoke" { Invoke-SdkSmoke }
      { $_ -in @("", "-h", "--help", "help") } {
        Write-Host "Usage: builda sdk init | install | check | smoke"
      }
      default {
        Write-Error "Unknown sdk command: $Sub"
        Write-Host "Usage: builda sdk init | install | check | smoke"
        exit 1
      }
    }
  }
  "upload-build" {
    Need-Token
    if ($Rest.Count -lt 1 -or !(Test-Path $Rest[0])) { throw "zip file required" }
    $Engine = Get-ManifestEngine
    Test-BundleZip $Rest[0] $false $Engine | Out-Null
    $Zip = (Resolve-Path $Rest[0]).Path
    $Raw = Invoke-ResumableBuildUpload $Zip $Engine
    $Resp = $Raw | ConvertFrom-Json
    Write-Utf8TextNoBom (Join-Path $Root "last-build.json") ($Resp | ConvertTo-Json -Depth 8)
    $Resp | ConvertTo-Json -Depth 8
    if ($Resp.prefix) {
      if (!(Test-Path $Manifest)) { Write-DefaultManifest }
      $Data = Read-Utf8Text $Manifest | ConvertFrom-Json
      $BuildEntry = if ($Resp.entry) { $Resp.entry } else { "index.html" }
      foreach ($Field in @{
        buildPrefix = $Resp.prefix
        buildEntry = $BuildEntry
        buildSize = $(if ($Resp.size) { $Resp.size } else { 0 })
        bundleUrl = $(if ($Resp.bundleUrl) { $Resp.bundleUrl } else { "" })
        bundleMd5 = $(if ($Resp.bundleMd5) { $Resp.bundleMd5 } else { "" })
        bundleVersion = $(if ($Resp.bundleVersion) { $Resp.bundleVersion } else { $Resp.prefix })
        bundleEntry = $(if ($Resp.bundleEntry) { $Resp.bundleEntry } else { $BuildEntry })
        bundleSize = $(if ($Resp.bundleSize) { $Resp.bundleSize } else { 0 })
      }.GetEnumerator()) {
        $Data | Add-Member -NotePropertyName $Field.Key -NotePropertyValue $Field.Value -Force
      }
      Write-Utf8TextNoBom $Manifest ($Data | ConvertTo-Json -Depth 8)
      Write-Host "Updated $Manifest with build and H5 Bundle fields."
    }
  }
  "upload-status" {
    Need-Token
    $SessionId = if ($Rest.Count -gt 0) { $Rest[0] } else { "" }
    Get-UploadSessionStatus $SessionId
  }
  "upload-cancel" {
    Need-Token
    $SessionId = if ($Rest.Count -gt 0) { $Rest[0] } else { "" }
    Cancel-UploadSession $SessionId
  }
  "publish" {
    $VerboseOutput = $Rest -contains "--verbose"
    [string[]]$PublishArgs = @($Rest | Where-Object { $_ -ne "--verbose" })
    $Zip = if ($PublishArgs.Count -gt 0) { $PublishArgs[0] } else { "" }
    $File = if ($PublishArgs.Count -gt 1) { $PublishArgs[1] } else { $Manifest }
    if ($Zip -eq "-h" -or $Zip -eq "--help" -or $Zip -eq "help") {
      Write-Host "Usage: builda publish [build.zip] [manifest] [--verbose]"
      return
    }
    if (!(Test-Path $File)) { throw "manifest not found: $File" }
    Sync-OnlineCompatibilityRevision $File
    Invoke-DraftPreflight $File
    if ($Zip) {
      if (!(Test-Path $Zip)) { throw "build zip not found: $Zip" }
      $PreviousManifest = $env:BUILDA_MANIFEST
      try {
        $env:BUILDA_MANIFEST = [System.IO.Path]::GetFullPath($File)
        $UploadOutput = & $PSCommandPath upload-build $Zip
        $UploadSucceeded = $?
      } finally {
        if ($null -eq $PreviousManifest) { Remove-Item Env:BUILDA_MANIFEST -ErrorAction SilentlyContinue } else { $env:BUILDA_MANIFEST = $PreviousManifest }
      }
      if (!$UploadSucceeded) { throw "build upload failed" }
      if ($VerboseOutput -and $null -ne $UploadOutput) { $UploadOutput | Write-Output }
    }
    Set-ManifestSdkVersion $File
    $GameId = Get-ProjectGameId
    $PendingCreate = if ($env:BUILDA_PUBLISH_OPERATION_ID) { "" } else { Get-DraftIdempotencyKey "create" "" $File $true }
    if ($PendingCreate) {
      if ($VerboseOutput) { & $PSCommandPath create-draft $File --verbose } else { & $PSCommandPath create-draft $File }
    } elseif ($GameId) {
      if ($VerboseOutput) { & $PSCommandPath update-draft $GameId $File --verbose } else { & $PSCommandPath update-draft $GameId $File }
    } else {
      if ($VerboseOutput) { & $PSCommandPath create-draft $File --verbose } else { & $PSCommandPath create-draft $File }
    }
    $DraftSucceeded = $?
    if (!$DraftSucceeded) { throw "draft sync failed" }
  }
  "create-draft" {
    $VerboseOutput = $Rest -contains "--verbose"
    [string[]]$DraftArgs = @($Rest | Where-Object { $_ -ne "--verbose" })
    $File = if ($DraftArgs.Count -gt 0) { $DraftArgs[0] } else { $Manifest }
    if ($File -eq "-h" -or $File -eq "--help" -or $File -eq "help") {
      Write-Host "Usage: builda create-draft [manifest] [--verbose]"
      return
    }
    if (!(Test-Path $File)) { throw "manifest not found: $File" }
    Sync-OnlineCompatibilityRevision $File
    Invoke-DraftPreflight $File
    Set-ManifestSdkVersion $File
    Need-Token
    Migrate-LegacyProjectFile
    $Operation = ""
    if (!$env:BUILDA_PUBLISH_OPERATION_ID) {
      $Operation = Get-DraftIdempotencyKey "create" "" $File $true
    }
    if (Test-Path $ProjectFile) {
      $ExistingId = Get-ProjectGameId
      if ($ExistingId -and !$Operation) { throw "$ProjectFile already binds this project to $ExistingId. Use: builda update-draft" }
    }
    Write-PublishPreflight "create" "new-game"
    $Headers = if ($env:BUILDA_PUBLISH_OPERATION_ID) {
      Get-StudioUploadHeaders $env:BUILDA_PUBLISH_OPERATION_ID
    } else {
      if (!$Operation) { $Operation = Get-DraftIdempotencyKey "create" "" $File }
      @{
        Authorization = "Bearer $(Get-Token)"
        "Idempotency-Key" = $Operation
      }
    }
    [byte[]]$BodyBytes = ConvertTo-ManifestRequestBytes $File
    $Resp = Invoke-DraftRequestWithAuthRetry -Uri (Get-CmdUrl "game/create") -Headers $Headers -BodyBytes $BodyBytes
    Assert-CmdResponseOk $Resp "create draft"
    Write-Utf8TextNoBom (Join-Path $Root "last-draft.json") ($Resp | ConvertTo-Json -Depth 8)
    $GameId = $Resp.body.game.id
    $VersionId = if ($Resp.body.game.versionId) { $Resp.body.game.versionId } else { $Resp.body.game.draftVersionId }
    if (!$GameId -or !$VersionId) { throw "BUILDA_DRAFT_RESPONSE_INVALID: create draft response is missing gameId or versionId; retry with the preserved operation receipt." }
    if ($GameId) {
      $GameId | Set-Content -Encoding ASCII (Join-Path $Root "last-game-id")
      $GameId | Set-Content -Encoding ASCII (Join-Path $Root "last-draft-id")
    }
    if ($VersionId) { $VersionId | Set-Content -Encoding ASCII (Join-Path $Root "last-version-id") }
    Write-ProjectGame $GameId (Get-ManifestTitle $File) $VersionId
    if (!$env:BUILDA_PUBLISH_OPERATION_ID) { Complete-DraftIdempotencyKey $Operation }
    $ManifestData = Read-Utf8Text $File | ConvertFrom-Json
    Write-Host "sync=ok gameId=$GameId versionId=$VersionId bundleVersion=$($ManifestData.bundleVersion) orientation=$($ManifestData.orientation) clientDraft=ready publicRelease=pending_user_action"
    if ($VerboseOutput) { $Resp | ConvertTo-Json -Depth 8 }
  }
  "update-draft" {
    $VerboseOutput = $Rest -contains "--verbose"
    [string[]]$DraftArgs = @($Rest | Where-Object { $_ -ne "--verbose" })
    $Id = if ($DraftArgs.Count -gt 0) { $DraftArgs[0] } else { "" }
    if ($Id -eq "-h" -or $Id -eq "--help" -or $Id -eq "help") {
      Write-Host "Usage: builda update-draft [game_id] [manifest] [--verbose]"
      return
    }
    $File = if ($DraftArgs.Count -gt 1) { $DraftArgs[1] } else { $Manifest }
    if ($Id -and (Test-Path $Id)) {
      $File = $Id
      $Id = ""
    }
    if (!$Id) { $Id = Get-ProjectGameId }
    $LastGameId = Join-Path $Root "last-game-id"
    if (!$Id -and (Test-Path $LastGameId)) {
      $WeakId = (Read-Utf8Text $LastGameId).Trim()
      throw "No $ProjectFile in this project. Last global game id is $WeakId, but it may belong to another project. Pass the intended id explicitly once: builda update-draft $WeakId"
    }
    if (!$Id) { throw "game id required. Put $ProjectStateDir/game.json in this project or pass game id explicitly." }
    if (!(Test-Path $File)) { throw "manifest not found: $File" }
    Sync-OnlineCompatibilityRevision $File
    Invoke-DraftPreflight $File
    Set-ManifestSdkVersion $File
    Need-Token
    Write-PublishPreflight "update" $Id
    $Data = Read-Utf8Text $File | ConvertFrom-Json
    $Data | Add-Member -NotePropertyName id -NotePropertyValue $Id -Force
    $Body = $Data | ConvertTo-Json -Depth 8
    $BodyBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Body)
    $Operation = ""
    $Headers = if ($env:BUILDA_PUBLISH_OPERATION_ID) {
      Get-StudioUploadHeaders $env:BUILDA_PUBLISH_OPERATION_ID
    } else {
      $Operation = Get-DraftIdempotencyKey "update" $Id $File
      @{
        Authorization = "Bearer $(Get-Token)"
        "Idempotency-Key" = $Operation
      }
    }
    $Resp = Invoke-DraftRequestWithAuthRetry -Uri (Get-CmdUrl "game/updatedraft") -Headers $Headers -BodyBytes $BodyBytes
    Assert-CmdResponseOk $Resp "update draft"
    Write-Utf8TextNoBom (Join-Path $Root "last-draft.json") ($Resp | ConvertTo-Json -Depth 8)
    $GameId = $Resp.body.game.id
    $VersionId = if ($Resp.body.game.versionId) { $Resp.body.game.versionId } else { $Resp.body.game.draftVersionId }
    if (!$GameId) { $GameId = $Id }
    if (!$VersionId) { throw "BUILDA_DRAFT_RESPONSE_INVALID: update draft response is missing versionId; retry with the preserved operation receipt." }
    if ($GameId) {
      $GameId | Set-Content -Encoding ASCII (Join-Path $Root "last-game-id")
      $GameId | Set-Content -Encoding ASCII (Join-Path $Root "last-draft-id")
    }
    if ($VersionId) { $VersionId | Set-Content -Encoding ASCII (Join-Path $Root "last-version-id") }
    Write-ProjectGame $GameId (Get-ManifestTitle $File) $VersionId
    if (!$env:BUILDA_PUBLISH_OPERATION_ID) { Complete-DraftIdempotencyKey $Operation }
    $ManifestData = Read-Utf8Text $File | ConvertFrom-Json
    Write-Host "sync=ok gameId=$GameId versionId=$VersionId bundleVersion=$($ManifestData.bundleVersion) orientation=$($ManifestData.orientation) clientDraft=ready publicRelease=pending_user_action"
    if ($VerboseOutput) { $Resp | ConvertTo-Json -Depth 8 }
  }
  "status" {
    Write-Host "root=$Root"
    if (Test-Path $TokenPath) { Write-Host "grant=present" } else { Write-Host "grant=missing" }
    if (Test-Path $RefreshPath) { Write-Host "agent-authorization=present" } else { Write-Host "agent-authorization=missing" }
    if (Test-Path $TokenPath) {
      try { Write-ActingIdentity } catch { Write-Host "identity=unavailable" }
    } else {
      Write-Host "identity=unavailable"
    }
    if (Test-Path $Manifest) { Write-Host "manifest=$Manifest" }
    if (Test-Path $ProjectFile) {
      $ProjectGameId = Get-ProjectGameId
      if ($ProjectGameId) { Write-Host "project-game-id=$ProjectGameId" } else { Write-Host "project-game-id=invalid" }
      Write-Host "project-binding=$ProjectFile"
      Write-Host "project-state-dir=$(Split-Path -Parent $ProjectFile)"
    }
    $LastBuild = Join-Path $Root "last-build.json"
    if (Test-Path $LastBuild) { Write-Host "last-build=$LastBuild" }
    $LastAssets = Join-Path $Root "last-assets.json"
    if (Test-Path $LastAssets) { Write-Host "last-assets=$LastAssets" }
    $LastGameId = Join-Path $Root "last-game-id"
    if (Test-Path $LastGameId) { Write-Host "last-game-id=$((Read-Utf8Text $LastGameId).Trim()) (weak receipt, not project identity)" }
    $LastVersionId = Join-Path $Root "last-version-id"
    if (Test-Path $LastVersionId) { Write-Host "last-version-id=$((Read-Utf8Text $LastVersionId).Trim())" }
  }
  "uninstall" {
    Invoke-Uninstall $Rest
  }
  "whoami" {
    Write-ActingIdentity
  }
  { $_ -in @("", "-h", "--help", "help") } {
    Show-Usage
  }
  default {
    Write-Error "Unknown command: $Cmd"
    Show-Usage
    exit 1
  }
}
