import { NextResponse } from 'next/server';

import { route } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { backupStatus, newestBackupBytes } from '@/lib/backupStatusQuery.js';

/**
 * สถานะการสำรองข้อมูล — อ่านจากไฟล์สำรองจริง ไม่ใช่จากบันทึกของ Task Scheduler
 *
 * ฝ่ายบุคคล and administrators only. Not because the age of a backup is a
 * secret, but because everything beside it here is: the destination path, the
 * document count, and the size of a dump that holds `passwordHash` for every
 * account. An employee has nothing to do about a missed backup and no screen
 * that would carry the answer.
 *
 * NOT ON /api/health. That route is unauthenticated so a monitor can reach it,
 * and this is exactly the sort of useful field that turns an open endpoint into
 * a leak one line at a time — a filesystem path and a roster count handed to
 * anybody who can reach port 3000. A monitor that wants to alarm on backups can
 * be given a credential; the health check stays the smallest true statement it
 * has always been.
 *
 * `no-store`, for the same reason /api/health uses it: a cached answer about
 * whether a backup exists is an answer about the past, and this one is read to
 * decide whether to go and fix something now. `NextResponse.json` directly
 * rather than the `json` helper, which sets a status and no headers.
 */
export const GET = route(async (req) => {
  requireRole(await requireAuth(req), 'admin', 'hr');

  const status = backupStatus();
  const bytes = status.newest ? newestBackupBytes(status.destination, status.newest.name) : null;

  return NextResponse.json(
    { ...status, newest: status.newest ? { ...status.newest, bytes } : null },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
});

/** The answer is a filesystem read; caching it at build time would freeze it. */
export const dynamic = 'force-dynamic';
