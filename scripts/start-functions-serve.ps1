# Launch `supabase functions serve --no-verify-jwt` DETACHED, with its stdout/stderr written to
# a dated log — register row 255 (2026-09-20).
#
# Why this exists: the CLI's `functions serve` destroys and RECREATES the edge-runtime container
# whenever the runtime dies (a new container id each time — Docker's own restart policy on it
# is `no`), and during a full verification pass that happened at least five times. Every
# recreation is a window in which Kong answers 503 "name resolution failed" (the container does
# not exist) and then 502 "An invalid response was received from the upstream server" (it exists
# and is not yet serving), and any suite mid-call fails on assertions that have nothing to do
# with it. The REASON for each crash was unrecoverable: the dead containers took their logs with
# them, Docker Desktop's event buffer retained nothing, and the serve process's own stdout was
# orphaned when the shell that launched it exited. This launcher is what turns the next
# occurrence into a diagnosis — the CLI prints the runtime's last words and its own restart
# reason to the stream captured here.
#
# Usage (from anywhere):   powershell -NoProfile -File scripts\start-functions-serve.ps1
# Stops any serve tree already running (by PID, found through its own command line — never a
# name-based kill), then starts a fresh one. The log lives under scripts\.pass-logs\ (gitignored):
#   scripts\.pass-logs\functions-serve\<UTC stamp>.log
# Read it with `Get-Content -Tail 50 -Wait`. `supabase stop` does NOT stop this process (CLAUDE.md,
# Working conventions); stop it by running this script's kill step or by PID.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'scripts\.pass-logs\functions-serve'
New-Item -ItemType Directory -Force $logDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ssZ')
$out = Join-Path $logDir "$stamp.log"
$err = Join-Path $logDir "$stamp.stderr.log"

# 1. Stop an existing serve tree, by PID, matched on the command line.
$existing = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'functions serve' }
foreach ($p in $existing) {
  Write-Host ("stopping existing functions serve: pid {0} ({1})" -f $p.ProcessId, $p.Name)
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { Write-Host ("  already gone: {0}" -f $_.Exception.Message) }
}
if ($existing) { Start-Sleep -Seconds 3 }

# 2. Start detached (survives this shell), stdout and stderr to the dated files.
$supabase = Join-Path $env:APPDATA 'npm\supabase.cmd'
if (-not (Test-Path $supabase)) { throw "supabase CLI not found at $supabase" }
$proc = Start-Process -FilePath $supabase -ArgumentList 'functions', 'serve', '--no-verify-jwt' `
  -WorkingDirectory $root -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
Write-Host ("started functions serve: pid {0}" -f $proc.Id)
Write-Host ("stdout -> {0}" -f $out)
Write-Host ("stderr -> {0}" -f $err)

# 3. Wait for the runtime to come up and show the first lines, so a broken start is visible now.
$deadline = (Get-Date).AddSeconds(90); $ok = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  $tail = @()
  foreach ($f in @($out, $err)) { if (Test-Path $f) { $tail += Get-Content $f -ErrorAction SilentlyContinue } }
  if ($tail -match 'Serving functions on') { $ok = $true; break }
}
foreach ($f in @($out, $err)) { if (Test-Path $f) { Get-Content $f -ErrorAction SilentlyContinue | Select-Object -First 6 } }
if (-not $ok) { Write-Host 'WARNING: "Serving functions on" not seen within 90s — read the log above'; exit 1 }
Write-Host 'functions serve is up and logging.'
