param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$logicalRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$node = (Get-Command node.exe -ErrorAction Stop).Source
# The workspace may be exposed through a migrated-drive compatibility path.
# Node/Next must start from the physical path used by its compiled modules.
$appRootBase64 = (& $node -e "process.stdout.write(Buffer.from(require('fs').realpathSync(process.argv[1]), 'utf16le').toString('base64'))" $logicalRoot)
$appRoot = if ($appRootBase64) {
  [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String($appRootBase64))
} else {
  $logicalRoot
}
if (-not $appRoot) { $appRoot = $logicalRoot }
$port = 3000
$appUrl = "http://127.0.0.1:$port"
$buildId = Join-Path $appRoot ".next\BUILD_ID"

function Get-PortListener([int]$targetPort) {
  try {
    $connection = Get-NetTCPConnection -LocalPort $targetPort -State Listen -ErrorAction Stop |
      Select-Object -First 1
    if (-not $connection) { return $null }
    return Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction Stop
  } catch {
    return $null
  }
}

function Test-IsThisAppProcess($process) {
  if (-not $process -or -not $process.CommandLine) { return $false }
  return $process.CommandLine.IndexOf($appRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-BuildRequired {
  if (-not [System.IO.File]::Exists($buildId)) { return $true }

  $builtAt = [System.IO.File]::GetLastWriteTime($buildId)
  $buildInputs = @(
    (Join-Path $appRoot "src"),
    (Join-Path $appRoot "public"),
    (Join-Path $appRoot "package.json"),
    (Join-Path $appRoot "package-lock.json"),
    (Join-Path $appRoot "next.config.ts"),
    (Join-Path $appRoot "tsconfig.json")
  )

  foreach ($inputPath in $buildInputs) {
    if (-not [System.IO.File]::Exists($inputPath) -and -not [System.IO.Directory]::Exists($inputPath)) { continue }
    $newerInput = Get-ChildItem -LiteralPath $inputPath -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -gt $builtAt } |
      Select-Object -First 1
    if ($newerInput) { return $true }
  }
  return $false
}

function Stop-StaleAppProcess($process, [int]$targetPort, [bool]$verifiedByApi = $false) {
  if (-not $verifiedByApi -and -not (Test-IsThisAppProcess $process)) {
    throw "Port $targetPort is already used by another program."
  }

  Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    Start-Sleep -Milliseconds 100
    if (-not (Get-PortListener $targetPort)) { return }
  }
  throw "The previous local service did not release port 3000."
}

function Test-AutumnRecruitmentApp([int]$targetPort) {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$targetPort/api/applications" -TimeoutSec 2
    if ($null -eq $response) { return $false }
    return $null -ne $response.PSObject.Properties["applications"]
  } catch {
    return $false
  }
}

function Wait-AutumnRecruitmentApp([int]$targetPort, [int]$attempts = 60) {
  for ($attempt = 0; $attempt -lt $attempts; $attempt += 1) {
    if (Test-AutumnRecruitmentApp $targetPort) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Find-RunningAppPort {
  foreach ($candidate in 3000..3010) {
    if (Test-AutumnRecruitmentApp $candidate) { return $candidate }
  }
  return $null
}

function Find-AvailablePort {
  foreach ($candidate in 3000..3010) {
    if (-not (Get-PortListener $candidate)) { return $candidate }
  }
  throw "Ports 3000-3010 are all occupied. Close one local service and try again."
}

function Show-LaunchError([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    $message,
    "Autumn Recruitment",
    [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]::Error
  ) | Out-Null
}

function Start-NpmProcess([string[]]$arguments, [switch]$Wait) {
  # Windows PowerShell 5.1 can reject WorkingDirectory when the target is a
  # .cmd shim. Start the child from the app directory instead so npm/Next see
  # the same working directory without passing that parameter.
  Push-Location -LiteralPath $appRoot
  try {
    if ($Wait) {
      return Start-Process -FilePath $npm -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    }
    return Start-Process -FilePath $npm -ArgumentList $arguments -WindowStyle Hidden -PassThru
  } finally {
    Pop-Location
  }
}

function Start-ApplicationBuild {
  # Next inspects route modules in parallel while building. Those modules open
  # SQLite during import, so pointing every build worker at the live database
  # makes otherwise harmless schema initialization race with itself and fail
  # with SQLITE_BUSY. Build against isolated in-memory databases; the started
  # server inherits the restored environment and still opens the live data.
  $previousDatabasePath = [System.Environment]::GetEnvironmentVariable(
    "RECRUITMENT_DB_PATH",
    [System.EnvironmentVariableTarget]::Process
  )
  try {
    [System.Environment]::SetEnvironmentVariable(
      "RECRUITMENT_DB_PATH",
      ":memory:",
      [System.EnvironmentVariableTarget]::Process
    )
    return Start-NpmProcess -arguments @("run", "build") -Wait
  } finally {
    [System.Environment]::SetEnvironmentVariable(
      "RECRUITMENT_DB_PATH",
      $previousDatabasePath,
      [System.EnvironmentVariableTarget]::Process
    )
  }
}

try {
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $runningPort = Find-RunningAppPort
  if ($null -eq $runningPort) {
    # A double-click can arrive after Next has opened the socket but before its
    # API is ready. Recognize that in-flight instance and wait instead of
    # starting a second server that immediately collides with the same port.
    foreach ($candidate in 3000..3010) {
      $candidateListener = Get-PortListener $candidate
      if ($candidateListener -and (Test-IsThisAppProcess $candidateListener)) {
        if (Wait-AutumnRecruitmentApp $candidate 30) { $runningPort = $candidate; break }
        Stop-StaleAppProcess $candidateListener $candidate
      }
    }
  }
  $port = if ($null -ne $runningPort) { [int]$runningPort } else { Find-AvailablePort }
  $appUrl = "http://127.0.0.1:$port"
  $listener = Get-PortListener $port
  $buildRequired = Test-BuildRequired
  $restartRequired = $false
  $verifiedByApi = $false

  if ($listener) {
    # The API signature is more reliable than a transient Windows process
    # command line, especially while npm hands the listener over to Next.
    $verifiedByApi = Test-AutumnRecruitmentApp $port
    if (-not $verifiedByApi -and -not (Test-IsThisAppProcess $listener)) {
      # A foreign process can claim a port between discovery and startup.
      $port = Find-AvailablePort
      $appUrl = "http://127.0.0.1:$port"
      $listener = $null
    }
    if ($listener) {
      $runningProcess = Get-Process -Id $listener.ProcessId -ErrorAction Stop
      $buildUpdatedAt = if ([System.IO.File]::Exists($buildId)) { [System.IO.File]::GetLastWriteTime($buildId) } else { [datetime]::MaxValue }
      $restartRequired = $buildRequired -or $runningProcess.StartTime -lt $buildUpdatedAt
      if ($restartRequired) { Stop-StaleAppProcess $listener $port $verifiedByApi }
    }
  }

  if ($buildRequired) {
    $build = Start-ApplicationBuild
    if ($build.ExitCode -ne 0) {
      throw "The application build failed. Run npm run build in the application directory for details."
    }
  }

  if (-not (Test-AutumnRecruitmentApp $port)) {
    Start-NpmProcess -arguments @("run", "start", "--", "-p", "$port") | Out-Null

    $ready = Wait-AutumnRecruitmentApp $port 60
    if (-not $ready) {
      throw "The local service did not start within 30 seconds on port $port."
    }
  }

  if (-not $NoBrowser) {
    Start-Process $appUrl
  }
} catch {
  Show-LaunchError $_.Exception.Message
  exit 1
}
