# Deploy the OT app to 127.0.0.1:3000 - stop, build, relaunch as `next start`.
#
# Run in a NORMAL PowerShell window (not through Claude Code - the process kill
# is what the permission classifier refuses):
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\suwan\deploy-ot.ps1
#
# THAT SHORT PATH IS A LAUNCHER; THIS FILE IS THE DEPLOY. `C:\Users\suwan\
# deploy-ot.ps1` is three lines that call this one. The split is deliberate and
# each half earns its place:
#
#   * The short path exists because the first attempt at handing this over lived
#     in a temp directory, and the path was long enough that the quoting came
#     apart - after which a run that never happened was reported as a success.
#     A path with no spaces, typed from memory, cannot do that.
#   * This file is in the repository because a deploy procedure that is not
#     version-controlled is not reviewed, not backed up, and not part of the
#     change that alters it. It lived outside the repo until 2026-08-27, which
#     is why it spent a day describing a `next start` server while the machine
#     was running `next dev`: nothing tied it to the commits it was deploying.
#
# It is also ASCII-only, like scripts\start-server.ps1 and for the same reason -
# see the note there, and test\scriptEncoding.test.js, which enforces it.
#
# The app is down from step 3 until step 4 finishes - about a minute.
#
# WHAT THIS SCRIPT ASSUMES ABOUT THE MACHINE, written down because the last
# version assumed something else and was wrong about it for a day:
#
#   * There is NO "OT server" scheduled task. Checked 2026-08-20, 2026-08-25 and
#     2026-08-27; the only OT job is "OT backup". So nothing restarts the app on
#     its own, nothing brings it back after a reboot, and this script is the
#     whole of "deploy". README's Setup section carries the registration command
#     and it has never been run here.
#   * The thing on :3000 may be `next dev` OR `next start`. On 2026-08-27 it was
#     `next dev`, serving the working tree straight from source - which is why
#     an edit appeared live with no build and why `.next\BUILD_ID` was two days
#     stale while the app looked current. Step 2 names which one it found.
#   * The pid holding the port names NEITHER mode: both reach the socket through
#     the same `start-server.js` worker. `dev` or `start` is on its PARENT.
#
# STEP 5 IS THE ONLY PROOF THAT MATTERS. A new BUILD_ID on disk says a build
# happened, not that the running server is serving it - the two came apart on
# 2026-08-26 and that is exactly the failure. So step 5 pulls the CSS the server
# hands out and greps it.

$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\suwan\Documents\OT_HR'
$port = 3000
Set-Location $repo

function Get-Holder {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) { return $null }
    $pidOnPort = ($conn | Select-Object -First 1).OwningProcess
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $pidOnPort" -ErrorAction SilentlyContinue
    $parent = $null
    if ($proc) { $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.ParentProcessId)" -ErrorAction SilentlyContinue }
    $mode = 'unknown'
    if ($parent -and $parent.CommandLine -match '\bnext"?\s+dev\b')       { $mode = 'next dev' }
    elseif ($parent -and $parent.CommandLine -match '\bnext"?\s+start\b') { $mode = 'next start' }
    elseif ($parent -and $parent.Name -eq 'powershell.exe')               { $mode = 'start-server.ps1 wrapper' }
    [pscustomobject]@{
        Pid = $pidOnPort
        ParentPid = if ($parent) { $parent.ProcessId } else { $proc.ParentProcessId }
        ParentCmd = if ($parent) { $parent.CommandLine } else { '(parent gone)' }
        Mode = $mode
    }
}

Write-Host ''
Write-Host '== 1 . before-state, so a deploy that did not happen cannot look like one' -ForegroundColor Cyan
$beforeBuildId = if (Test-Path "$repo\.next\BUILD_ID") { Get-Content "$repo\.next\BUILD_ID" } else { '(no build)' }
$beforeCommit  = (git -C $repo rev-parse --short HEAD)
Write-Host "   commit    $beforeCommit"
Write-Host "   BUILD_ID  $beforeBuildId"
$before = Get-Holder
if ($before) {
    Write-Host "   :$port     pid $($before.Pid), parent $($before.ParentPid), mode $($before.Mode)"
    Write-Host "             $($before.ParentCmd)"
} else {
    Write-Host "   :$port     nothing listening"
}

Write-Host ''
Write-Host '== 2 . what is being replaced' -ForegroundColor Cyan
if (-not $before) {
    Write-Host '   nothing is on the port - this is a cold start, not a replacement' -ForegroundColor Yellow
} elseif ($before.Mode -eq 'next dev') {
    Write-Host '   a DEV server. It compiles from the working tree, so what HR has been' -ForegroundColor Yellow
    Write-Host '   looking at is uncommitted source, not a build. Replacing it with a' -ForegroundColor Yellow
    Write-Host '   production build is the point of this run.' -ForegroundColor Yellow
} else {
    Write-Host "   $($before.Mode) - a production server. Ordinary redeploy."
}

Write-Host ''
Write-Host '== 3 . stopping it (the app is down from here)' -ForegroundColor Cyan
if ($before) {
    # The PARENT first and the worker second. `next dev` and the start-server.ps1
    # wrapper both respawn their child if they outlive it, so killing the pid on
    # the port alone gets a server back that this script did not start and does
    # not know the build of.
    foreach ($target in @($before.ParentPid, $before.Pid)) {
        try { Stop-Process -Id $target -Force -ErrorAction Stop; Write-Host "   stopped pid $target" }
        catch { Write-Host "   pid $target was already gone" }
    }
    Start-Sleep -Seconds 3
    if (Get-Holder) { throw "port $port is still held - stop it by hand before building" }
}
Write-Host "   port $port is free" -ForegroundColor Green

Write-Host ''
Write-Host '== 4 . building, then relaunching' -ForegroundColor Cyan
# No VERIFY_DIST_DIR: this one writes .next, which is what `next start` serves.
# A scratch build is how a change is checked BEFORE this runs - see README.
npm run build
if ($LASTEXITCODE -ne 0) { throw 'build failed - the old .next is gone, do not walk away' }

# Invoke-CimMethod rather than Start-Process: a Start-Process server lands in the
# calling session's job object and dies with it. start-server.ps1 is what holds
# the foreground, writes logs\task.log and normalises the exit code.
$cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
       (Join-Path $repo 'scripts\start-server.ps1') + '" -Port ' + $port
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
Write-Host "   launcher pid $($r.ProcessId), return $($r.ReturnValue) (0 = ok)"
Start-Sleep -Seconds 10

Write-Host ''
Write-Host '== 5 . proving the RUNNING server serves the NEW bundle' -ForegroundColor Cyan
$afterBuildId = if (Test-Path "$repo\.next\BUILD_ID") { Get-Content "$repo\.next\BUILD_ID" } else { '(no build)' }
Write-Host "   BUILD_ID  $beforeBuildId  ->  $afterBuildId"
if ($afterBuildId -eq $beforeBuildId) {
    Write-Host '   UNCHANGED - the build did not run, or it produced the same id' -ForegroundColor Red
}
$after = Get-Holder
if (-not $after) {
    Write-Host "   :$port is NOT listening - see logs\task.log and logs\server.err.log" -ForegroundColor Red
} else {
    Write-Host "   :$port     pid $($after.Pid), mode $($after.Mode)" -ForegroundColor Green
    if ($after.Mode -eq 'next dev') { Write-Host '   STILL A DEV SERVER - the relaunch did not take' -ForegroundColor Red }
    try {
        $code = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing).StatusCode
        Write-Host "   /api/health -> $code" -ForegroundColor Green
    } catch { Write-Host "   /api/health did not answer yet: $_" -ForegroundColor Yellow }

    # THE CHECK THAT CANNOT BE FOOLED. Ask the server for its own HTML, follow
    # the stylesheet link it prints, and read that. Hashed chunk names mean a
    # production bundle; `app_*._.css` is what a dev server emits.
    try {
        $html = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing).Content
        $css  = ([regex]::Matches($html, '/_next/static/chunks/[A-Za-z0-9_.\-]+\.css') |
                 ForEach-Object { $_.Value } | Select-Object -Unique)
        Write-Host "   stylesheets: $($css -join ', ')"
        foreach ($href in $css) {
            $body = (Invoke-WebRequest -Uri "http://127.0.0.1:$port$href" -UseBasicParsing).Content
            if ($body -match 'pager-step') {
                Write-Host "   $href carries .pager-step - the new bundle is live" -ForegroundColor Green
            }
        }
        if ($css -match 'app_.*\._\.css') {
            Write-Host '   that is a DEV chunk name - this is still not a production build' -ForegroundColor Red
        }
    } catch { Write-Host "   could not read the bundle off the server: $_" -ForegroundColor Yellow }
}

Write-Host ''
Write-Host 'Check the port ONCE MORE in a few minutes.' -ForegroundColor Yellow
Write-Host 'A server that is alive now has died within minutes twice on this machine,' -ForegroundColor Yellow
Write-Host 'and the check that runs inside the launching call proves nothing. There is' -ForegroundColor Yellow
Write-Host 'no scheduled task to bring it back:' -ForegroundColor Yellow
Write-Host ''
Write-Host '    Get-NetTCPConnection -LocalPort 3000 -State Listen' -ForegroundColor Yellow
Write-Host '    Get-Content C:\Users\suwan\Documents\OT_HR\logs\task.log -Tail 5' -ForegroundColor Yellow
