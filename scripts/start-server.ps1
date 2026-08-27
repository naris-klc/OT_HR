<#
.SYNOPSIS
    Start the built OT app on a port and stay in the foreground - for Task Scheduler.

.DESCRIPTION
    A thin wrapper around the one command that serves the app:

        node node_modules\next\dist\bin\next start -p 3000

    That IS what `npm start` runs. What this adds is the four things a scheduled
    task needs and a person typing the command does not:

      IT STAYS IN THE FOREGROUND. Task Scheduler treats the task as running for
      as long as its action process lives, and "restart if the task fails" is
      read off that process's exit code. A launcher that starts the server and
      returns would report success immediately and never restart anything.

      IT WRITES A LOG. Nobody is watching the screen at 08:00, so the only
      evidence is what it left behind: logs\server.log for the app's own output,
      logs\server.err.log for its errors, logs\task.log for one line per start
      and one per exit, appended and never rotated.

      IT FAILS LOUDLY. The server exiting for any reason other than a clean stop
      becomes a non-zero exit from this script, which is what Task Scheduler
      reads to mark the run as failed - and a failed run is what the restart
      setting acts on. The code is normalised to 1: a raw exit code can be a
      value that truncates to 0 on its way out of powershell.exe, and a crash
      reported as success is a server that never comes back.

      IT REFUSES TO BE THE SECOND SERVER. If something is already listening on
      the port it logs that and exits 0, rather than starting a process that
      will fail to bind and be restarted for ever. Two servers on one port is
      the one failure this cannot recover from on its own.

    WHY THIS FILE IS PURE ASCII, and must stay that way. Task Scheduler runs it
    with `powershell.exe` - Windows PowerShell 5.1 - which reads a file with no
    byte-order mark as ANSI. scripts\backup.ps1 carries Thai text and therefore
    depends on its BOM surviving every editor that ever touches it; the day one
    stripped it, the parser failed at line 65 and the task exited 1 before the
    first log line, so the one place anybody would look was empty. Nothing here
    is outside ASCII, so there is no BOM to lose and no encoding to get wrong.
    Keep it that way: the Thai belongs in README, which nothing parses.

.PARAMETER Port
    The port to serve on. 3000 unless told otherwise - the same port the
    firewall rule for the office LAN allows.

.PARAMETER Root
    The repository. Resolved from this file's own location, because Task
    Scheduler starts a task in C:\Windows\System32 unless told otherwise, and a
    job that only works when somebody remembers to set "Start in" is a job that
    breaks the first time it is recreated.

.EXAMPLE
    .\scripts\start-server.ps1

.EXAMPLE
    .\scripts\start-server.ps1 -Port 3001

.NOTES
    THERE IS NO "OT server" SCHEDULED TASK ON THIS MACHINE, and this line said
    there was. It read "Registered as the scheduled task 'OT server'" from the
    day the file was written until 2026-08-27, and it was never true here:
    `Get-ScheduledTask` has been run three times - 2026-08-20, 2026-08-25 and
    2026-08-27 - and the only OT job on the box is "OT backup". Registering it
    was attempted on 2026-08-20 and refused before it reached the machine.

    What that costs, stated where somebody reading this file will see it: the
    app does NOT come back after a reboot, and nothing restarts it when it
    dies. A person starts it - by running this file, or `deploy-ot.ps1`, which
    is what a deploy uses. The registration command and the three checks that
    would prove it works are in README under the Setup heading, and none of the
    three has been walked on this machine.

    Everything else in this file is written FOR that task and is still right:
    the foreground wait, the exit-code normalising and the restart signal are
    what a scheduled task reads, and they cost nothing while there is none.

    THE PORT-BUSY BRANCH IS NOT A SUCCESS SIGNAL. It exits 0 and starts
    nothing, which is the right answer for a duplicate task run and the wrong
    thing to read as "the app is up and it is mine". On 2026-08-27 the port was
    held by a `next dev` for most of a morning, serving the working tree
    instead of a build. The log line below names the pid and the command that
    owns it, so `logs\task.log` can be read for which of the two happened.
#>
param(
    [int]$Port = 3000,
    [string]$Root
)

$ErrorActionPreference = 'Stop'

if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
Set-Location $Root

$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }

$TaskLog = Join-Path $LogDir 'task.log'
$OutLog  = Join-Path $LogDir 'server.log'
$ErrLog  = Join-Path $LogDir 'server.err.log'

function Write-Task([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $TaskLog -Value $line -Encoding utf8
    Write-Output $line
}

# Already up? Then this is a duplicate start - a second logon, a restart that
# raced an orphaned server - and the right answer is to do nothing and report
# success. Exiting non-zero here would make Task Scheduler restart it, once a
# minute, against a port that is never going to be free.
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    $held = ($busy | Select-Object -First 1).OwningProcess
    # WHICH server, not just that there is one. "already served by pid 10392" is
    # true of a `next dev` serving the working tree and of the built app this
    # file exists to run, and on 2026-08-27 it was the first for a morning while
    # this log said nothing to tell them apart.
    #
    # AND THE ANSWER IS ON THE PARENT, not on the pid holding the port. Both
    # modes reach the socket through the same worker - the pid on the port is
    # `node ...\next\dist\server\lib\start-server.js` either way, which names
    # neither. It is the process that spawned it that reads `next dev -p 3000`
    # or `next start -p 3000`. Walked on 2026-08-27, which is how this line
    # came to log the parent as well as the child.
    #
    # Best-effort throughout: a pid can be gone by the time it is asked about,
    # and losing the name of a process must not turn a clean exit 0 into a crash.
    # OWN COMMAND LINE FIRST, PARENT SECOND. The two modes are not the same
    # shape: under `next start` the listener IS `node ... next start` and its
    # parent is only this wrapper, while under `next dev` the listener is an
    # anonymous `start-server.js` worker and the name is one level up. Reading
    # the parent alone gets the production case wrong - it reported the real
    # server as "powershell.exe" on 2026-08-27.
    $what = ''
    try {
        $owner  = Get-CimInstance Win32_Process -Filter "ProcessId = $held" -ErrorAction Stop
        $parent = $null
        try { $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($owner.ParentProcessId)" -ErrorAction Stop } catch { }
        $mode = ''
        foreach ($line in @($owner.CommandLine, $(if ($parent) { $parent.CommandLine }))) {
            if (-not $line) { continue }
            if ($line -match '\bnext"?\s+dev\b')   { $mode = 'next dev - SERVING THE WORKING TREE, not a build; '; break }
            if ($line -match '\bnext"?\s+start\b') { $mode = 'next start; '; break }
        }
        if ($owner.CommandLine) { $mode += $owner.CommandLine }
        if ($parent) { $mode += " (parent pid $($parent.ProcessId): $($parent.Name))" }
        else { $mode += " (parent pid $($owner.ParentProcessId) unavailable)" }
        $what = " ($mode)"
    } catch { $what = ' (command line unavailable)' }
    Write-Task "port $Port is already served by pid $held$what - nothing to do"
    exit 0
}

# `next start` refuses without a build, and its own message goes to the app log
# where nobody is looking yet. Said here instead, on the line above the exit.
if (-not (Test-Path (Join-Path $Root '.next\BUILD_ID'))) {
    Write-Task "no production build in .next - run 'npm run build' first"
    exit 1
}

$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (-not (Test-Path $node)) {
    $node = (Get-Command node -ErrorAction Stop).Source
}
$next = Join-Path $Root 'node_modules\next\dist\bin\next'
if (-not (Test-Path $next)) {
    Write-Task "next is not installed at $next - run 'npm run setup'"
    exit 1
}

# One run's output at a time, with the run before it kept beside it. The pair is
# what answers "it died - what did it say" after the restart has already
# overwritten the live file. Named .prev.log rather than .log.prev so .gitignore's
# `*.log` still covers them.
foreach ($f in @($OutLog, $ErrLog)) {
    if (Test-Path $f) { Move-Item -Path $f -Destination ($f -replace '\.log$', '.prev.log') -Force }
}

Write-Task "starting: $node $next start -p $Port  (cwd $Root)"

$proc = Start-Process -FilePath $node `
    -ArgumentList @($next, 'start', '-p', "$Port") `
    -WorkingDirectory $Root -NoNewWindow -PassThru -Wait `
    -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog

$code = $proc.ExitCode
if ($code -eq 0) {
    Write-Task 'server exited cleanly (code 0) - not treated as a failure, so no restart'
    exit 0
}

# Normalised, deliberately. See the note at the top: the point of this line is
# that Task Scheduler sees a failure, not that it sees which one.
Write-Task "server exited with code $code - reporting failure so the task restarts"
exit 1
