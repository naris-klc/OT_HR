<#
.SYNOPSIS
    สำรองฐานข้อมูล OT ไปยังดิสก์อื่น แล้วลบชุดเก่าที่เกินกำหนด — สำหรับ Task Scheduler

.DESCRIPTION
    A thin wrapper. Everything it does is `npm run backup -- --out … --keep …`;
    what it adds is the three things a scheduled task needs and a person typing
    the command does not:

      IT WRITES A LOG. A task that runs at 02:00 has nobody watching it, so the
      only evidence it ran is what it left behind. Both streams go to the log,
      appended, with the exit code on the last line.

      IT FAILS LOUDLY. `npm` exiting non-zero becomes a non-zero exit from this
      script, which is what Task Scheduler reads to mark the run as failed. A
      wrapper that swallows that is a backup job that reports success forever.

      IT REFUSES A DESTINATION THAT IS NOT THERE. An unplugged external drive or
      a disconnected share is the ordinary Monday-morning failure, and without
      this check `--out` would helpfully create the folder on whatever disk the
      path resolves to — which is usually the one holding the database, i.e. the
      exact disk the backup exists to be somewhere other than.

.PARAMETER Destination
    Where the backups go. MUST already exist, and SHOULD NOT be on the same
    physical disk as MongoDB — a copy beside the original protects against a
    mistaken query and against nothing else.

.PARAMETER Keep
    How many backups to leave behind. Older ones are deleted after the new one
    has been written successfully. Never deletes the newest, whatever this says.

.EXAMPLE
    .\scripts\backup.ps1 -Destination D:\ot-backups -Keep 30

.NOTES
    ตั้งเวลาด้วย Task Scheduler — ดูวิธีใน README หัวข้อ "สำรองและกู้คืนข้อมูล"
#>
param(
    [Parameter(Mandatory = $true)][string]$Destination,
    [int]$Keep = 30,
    [string]$LogFile
)

$ErrorActionPreference = 'Stop'

# The repository root — this file's parent's parent. Resolved from the script's
# own location rather than assumed to be the working directory, because Task
# Scheduler starts a task in C:\Windows\System32 unless told otherwise, and a
# job that only works when somebody remembers to set "Start in" is a job that
# breaks the first time it is recreated.
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not $LogFile) { $LogFile = Join-Path $Root 'backups\backup.log' }
$LogDir = Split-Path -Parent $LogFile
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $LogFile -Value $line -Encoding utf8
    Write-Output $line
}

Write-Log "เริ่มสำรองข้อมูล → $Destination (เก็บ $Keep ชุด)"

# Checked, never created. See the note above: creating it is how a backup ends
# up on the same disk as the database without anybody noticing.
if (-not (Test-Path $Destination)) {
    Write-Log "ล้มเหลว: ไม่พบปลายทาง $Destination — ไดรฟ์อาจไม่ได้เสียบ หรือ share หลุด"
    exit 1
}

# `Continue`, not the `Stop` set at the top, for the length of this one call.
# npm writes ordinary progress to stderr, and `2>&1` turns that into error
# records — under `Stop` a perfectly successful backup would throw on its own
# progress output. The exit code is what decides success here, not the stream a
# line happened to arrive on.
$ErrorActionPreference = 'Continue'
& npm run backup -- --out $Destination --keep $Keep 2>&1 | ForEach-Object { Write-Log $_ }
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

if ($code -ne 0) {
    Write-Log "ล้มเหลว: npm run backup จบด้วยรหัส $code"
    exit $code
}

Write-Log 'สำเร็จ'
exit 0
