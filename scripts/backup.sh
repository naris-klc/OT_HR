#!/bin/sh
#
# สำรองฐานข้อมูล OT ไปยังดิสก์อื่น แล้วลบชุดเก่าที่เกินกำหนด — สำหรับ cron
#
#   scripts/backup.sh /mnt/backups 30
#
# THE LINUX HALF, AND TODAY IT IS THE SPECULATIVE ONE. The system currently runs
# on a Windows laptop — see scripts/backup.ps1, which is the wrapper that
# actually executes. This exists so that moving to a server is a deploy rather
# than a small development project, and it is deliberately the same three lines
# of behaviour as its sibling. If you change one, change both.
#
# It is a thin wrapper. Everything it does is `npm run backup -- --out … --keep …`;
# what it adds is what a scheduled job needs and a person at a keyboard does not:
#
#   IT WRITES A LOG. A job that runs at 02:00 has nobody watching it, so what it
#   leaves behind is the only evidence it ran.
#
#   IT FAILS LOUDLY. A non-zero exit is what cron mails about and what a monitor
#   scrapes. A wrapper that swallows it is a backup job that reports success
#   forever.
#
#   IT REFUSES A DESTINATION THAT IS NOT THERE. An unmounted volume is the
#   ordinary failure, and without this check `--out` would create the directory
#   on the root filesystem — usually the disk holding the database, which is the
#   exact disk a backup exists to be somewhere other than.
#
# /bin/sh, not bash: this has to run under whatever cron hands it on a minimal
# server image, and nothing below needs more than POSIX.

set -eu

DEST="${1:-}"
KEEP="${2:-30}"

# Resolved from this file's location, not from the working directory — cron runs
# a job from the user's home, and a script that only works when somebody
# remembers to `cd` first breaks the first time it is copied to a new machine.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

LOG="${BACKUP_LOG:-$ROOT/backups/backup.log}"
mkdir -p "$(dirname "$LOG")"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$LOG"
}

if [ -z "$DEST" ]; then
  log 'ล้มเหลว: ต้องระบุปลายทาง — scripts/backup.sh /mnt/backups 30'
  exit 2
fi

log "เริ่มสำรองข้อมูล → $DEST (เก็บ $KEEP ชุด)"

# Checked, never created. Creating it is how a backup ends up on the same disk
# as the database without anybody noticing.
if [ ! -d "$DEST" ]; then
  log "ล้มเหลว: ไม่พบปลายทาง $DEST — ไดรฟ์อาจยังไม่ได้ mount"
  exit 1
fi

# Captured into a variable rather than piped into `tee`, and that is not a style
# choice. In POSIX sh `cmd | tee -a "$LOG"; code=$?` reads the exit status of
# TEE, which succeeds whenever it can write the log — so a failed backup would
# be recorded, correctly and in full, under a line saying it succeeded. There is
# no PIPESTATUS here and `pipefail` is not POSIX.
#
# `set -e` is lifted for the same reason it would otherwise exit before the
# failure could be logged, and the log line naming the code is the whole point
# of this wrapper on the night it fails.
set +e
output=$(npm run backup -- --out "$DEST" --keep "$KEEP" 2>&1)
code=$?
set -e

printf '%s\n' "$output" | tee -a "$LOG"

if [ "$code" -ne 0 ]; then
  log "ล้มเหลว: npm run backup จบด้วยรหัส $code"
  exit "$code"
fi

log 'สำเร็จ'
