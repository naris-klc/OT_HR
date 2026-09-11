'use client';

import React, { useEffect, useState } from 'react';
import { api, thaiStamp } from '@/lib/api.js';
import { backupNeedsAttention } from '@/lib/backupStatus.js';
import { Alert } from './common.jsx';

/**
 * งานสำรองข้อมูลล้มเหลว — บนหน้าที่ ฝ่ายบุคคล กับ admin เปิดทุกวัน
 *
 * WHY IT IS ON A WORKING SCREEN. The scheduled task failed every night from
 * 18–24 August and the only record of it was a line in backups/backup.log,
 * which is a file nobody opens because nothing ever asks them to. Six days of
 * "ล้มเหลว: ไม่พบปลายทาง E:\ot-backups" sat there while the app carried on
 * looking exactly as it does when backups are working. So the fact has to
 * arrive where the work is, not where the evidence is.
 *
 * IT IS NOT A COPY OF THE TASK'S LOG. The endpoint behind it reads the dumps
 * themselves — see lib/backupStatusQuery.js. A task can report success over a
 * folder that was pruned an hour later, and a task that was deleted reports
 * nothing at all rather than reporting a problem.
 *
 * IT ONLY EVER SAYS THE JOB IS BROKEN. Three states reach the screen —
 * `unreadable`, `none`, `stale` — and each of them means last night's backup
 * did not happen. `sameDisk` does not, as of 2026-08-24: a copy beside the
 * database is not a backup, and it is also a fact HR has already been given
 * and already answered (an external drive is on order, OneDrive was declined).
 * Standing over the queue repeating it every morning would not put a drive in
 * the machine; it would teach the person approving overtime to look past the
 * strip that is also where a genuinely failed job appears. The verdict is
 * still computed and still returned by GET /settings/backup-status —
 * `backupNeedsAttention` in lib/backupStatus.js is what stops it here.
 *
 * THERE IS NO GREEN STATE EITHER. When the job is running this renders
 * nothing, the same as PolicyDriftBanner. A tick saying "สำรองข้อมูลปกติ" would
 * be one more thing to read on a screen somebody opened to approve overtime,
 * and while the only destination on this machine is a folder on C: it would
 * also be a stronger claim than the truth.
 *
 * Fetched once on mount. The age of a backup changes by the hour and the job
 * runs at 01:00; polling it behind a queue somebody is working would spend a
 * filesystem scan a minute to learn nothing.
 *
 * hr and admin only — GET /settings/backup-status is theirs, so a manager's
 * request would be a 403 on every load of the queue. A manager can neither
 * plug a drive in nor re-run the job, which is the same reason the policy
 * strip beside this one stops at the same two roles.
 */
export function BackupBanner({ user }) {
  const [status, setStatus] = useState(null);
  const mayRead = ['hr', 'admin'].includes(user?.role);

  useEffect(() => {
    if (!mayRead) return undefined;
    let alive = true;
    api.get('/settings/backup-status')
      .then((res) => { if (alive) setStatus(res || null); })
      // Silent, like the policy strip: this is a warning about something else.
      // A screen that cannot check the backups must not refuse to show the
      // work they protect.
      .catch(() => {});
    return () => { alive = false; };
  }, [mayRead]);

  if (!status) return null;

  const { state, destination, ageHours, newest, incomplete } = status;

  // A pile of half-written dumps is its own fault and survives the silence
  // over `sameDisk`: it says the job is starting and not finishing, which is
  // nothing to do with which disk the folder is on and is not a decision
  // anybody has taken. Zero on this machine as of 2026-08-24, so on the
  // deployment as it stands this line shows nothing.
  const broken = backupNeedsAttention(status);
  if (!broken && !(incomplete > 0)) return null;

  // เก็บไว้ที่ไหน — printed in every state, because the commonest cause of
  // "ไม่มีข้อมูลสำรอง" on a system whose job is running fine is that BACKUP_DIR
  // and the scheduled task's -Destination are two different folders. The path
  // is the only thing on screen that makes that visible.
  const where = destination ? <code style={{ fontSize: 12 }}>{destination}</code> : null;

  const headline = (broken && {
    unreadable: 'ไม่พบโฟลเดอร์สำรองข้อมูล',
    none: 'ยังไม่มีข้อมูลสำรองในโฟลเดอร์นี้เลย',
    stale: 'ข้อมูลสำรองล่าสุดเก่ากว่า 24 ชั่วโมง',
  }[state]) || (broken ? 'สถานะการสำรองข้อมูลไม่ปกติ' : 'พบชุดสำรองที่สำรองไม่จบ');

  // Amber when the only thing wrong is leftover half-written folders — the job
  // itself is still running. Red when last night's backup did not happen.
  const kind = broken ? 'error' : 'warn';

  return (
    <Alert kind={kind}>
      <div>
        <strong>{headline}</strong>
        <div className="say">
          {state === 'unreadable' && (
            <>
              ปลายทางที่ตั้งไว้อ่านไม่ได้ — ไดรฟ์อาจไม่ได้เสียบ share หลุด
              {' '}หรือ <code style={{ fontSize: 12 }}>BACKUP_DIR</code> ไม่ตรงกับที่ตั้งไว้ใน Task Scheduler · {where}
            </>
          )}
          {state === 'none' && (
            <>
              โฟลเดอร์มีอยู่แต่ไม่มีชุดสำรองที่สมบูรณ์อยู่ในนั้น · {where}
            </>
          )}
          {state === 'stale' && newest && (
            <>
              ชุดล่าสุดเมื่อ {thaiStamp(newest.takenAt)}
              {' '}({Math.floor(ageHours)} ชม.ที่แล้ว) — งานสำรองอัตโนมัติน่าจะล้มเหลว · {where}
            </>
          )}
          {!broken && newest && (
            <>
              ชุดล่าสุดเมื่อ {thaiStamp(newest.takenAt)}
              {' '}({newest.totalDocuments} รายการ) สำรองสำเร็จ · {where}
            </>
          )}
          {incomplete > 0 && (
            <div style={{ marginTop: 4 }}>
              พบโฟลเดอร์ที่สำรองไม่จบ {incomplete} ชุด (ไม่มี manifest.json) — ไม่ถูกนับเป็นชุดสำรอง
            </div>
          )}
        </div>
      </div>
    </Alert>
  );
}

export default BackupBanner;
