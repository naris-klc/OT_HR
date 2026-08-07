'use client';

import React from 'react';
import { Alert } from './common.jsx';

/**
 * How a rule set appears on a screen HR is closing a month on.
 *
 * The premise of every one of these is that a column of hours says nothing
 * about what produced it. A policy flag can be answered on the 14th, and from
 * then until the month closes the entries still in flight are recomputed while
 * the signed-off ones deliberately are not — so a single column of figures can
 * hold two arithmetics with nothing distinguishing them. On paper it balances.
 * These say which is which.
 */

/**
 * "เวอร์ชัน 3".
 *
 * Three answers, not two. Nothing recorded is a dash; a pointer that resolved
 * to no row — a version not selected by the query, or one deleted straight out
 * of the database — is not the same thing and must not borrow the dash, because
 * "this entry predates versioning" and "this entry names rules nobody can find"
 * call for opposite reactions.
 */
export function versionName(version) {
  if (!version) return '—';
  return version.seq != null ? `เวอร์ชัน ${version.seq}` : 'ไม่ทราบเวอร์ชัน';
}

const NOT_RECORDED = 'ยื่นก่อนระบบเริ่มบันทึกเวอร์ชันนโยบาย';

/**
 * One entry's rule set.
 *
 * `version` is the populated `policyVersionId` — an object once populated, and
 * null on anything filed before versioning existed. The null case gets a
 * sentence rather than a blank: an empty cell reads as a screen that forgot to
 * fill it in, and this is a real answer about a real entry.
 */
export function PolicyVersionCell({ version }) {
  if (!version) {
    return (
      <span style={{ color: 'var(--muted)' }} title={NOT_RECORDED}>ไม่ระบุ</span>
    );
  }
  return (
    <span title={version.note || undefined}>
      {versionName(version)}
      {version.createdByName && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          ตั้งโดย {version.createdByName}
        </div>
      )}
    </span>
  );
}

/**
 * The rules on each side of one correction.
 *
 * Prints a single version where the correction stayed inside one — the usual
 * case, and the one a reader should be able to skip over — and an arrow only
 * where it crossed a boundary, because that is a correction whose hours moved
 * for two reasons at once.
 *
 * Both sides are the same shape: `before` is a `history.before` snapshot and
 * `after` is either the next snapshot or the entry as it stands, and both carry
 * `policyVersionId`. Populated to `{ seq }` for the ones it could resolve; a
 * bare id means the version row is gone or was not selected, and it prints as
 * unknown rather than as absent.
 */
export function PolicyVersionChange({ before, after }) {
  const from = before?.policyVersionId;
  const to = after?.policyVersionId;
  if (!from && !to) return <span style={{ color: 'var(--muted)' }}>ไม่ระบุ</span>;

  const same = String(from?._id || from || '') === String(to?._id || to || '');
  if (same) return <span>{versionName(to)}</span>;

  return (
    <span style={{ color: 'var(--amber)' }}>
      {from ? versionName(from) : 'ไม่ระบุ'}
      {' → '}
      {to ? versionName(to) : 'ไม่ระบุ'}
      <div style={{ fontSize: 11.5 }}>เปลี่ยนกฎการคำนวณ</div>
    </span>
  );
}

/**
 * The rule sets behind one row of a summary — which is a set, not a value.
 *
 * `spread` is what versionSpread() returned for that row's entries. A row using
 * one version prints it plainly; a row spanning two prints both in amber,
 * because that person's own monthly total is then a sum of hours that were not
 * all worked out the same way.
 */
export function PolicyVersionSummaryCell({ spread }) {
  if (!spread) return <span style={{ color: 'var(--muted)' }}>—</span>;

  const names = spread.used.map((u) => (u.seq != null ? `เวอร์ชัน ${u.seq}` : 'ไม่ทราบเวอร์ชัน'));
  if (spread.unversioned) names.push('ไม่ระบุ');

  if (!names.length) return <span style={{ color: 'var(--muted)' }}>—</span>;

  return (
    <span style={{ color: spread.mixed ? 'var(--amber)' : 'inherit' }}>
      {names.join(' + ')}
      {spread.mixed && (
        <div style={{ fontSize: 11.5 }}>ปนกัน</div>
      )}
    </span>
  );
}

/**
 * The warning, and the reason it is worded three ways.
 *
 * "More than one version" is the literal condition, and on its own it cries
 * wolf: answering OPEN 7 (may HR reject after the manager approved) mints a
 * version like any other and moves no number at all. A banner that fires on
 * that trains HR to dismiss the one that fires when the rounding rule changed
 * mid-month.
 *
 * So the four cases are separated, and the two that cannot answer "do these
 * figures compare" say which of them they are. `arithmeticMixed` is null for
 * two quite different reasons — rows whose rules were never recorded, and a
 * screen holding version numbers but not the snapshots behind them — and
 * telling HR to run a migration when the real answer is "open ตรวจสอบรายเดือน"
 * sends them somewhere that will not help.
 */
export function PolicyVersionBanner({ spread }) {
  if (!spread?.mixed) return null;

  const named = spread.used
    .map((u) => (u.seq != null
      ? `เวอร์ชัน ${u.seq} (${u.count} ใบ)`
      : `ไม่ทราบเวอร์ชัน (${u.count} ใบ)`));
  if (spread.unversioned) named.push(`ไม่ระบุเวอร์ชัน (${spread.unversioned} ใบ)`);

  const comparable = spread.arithmeticMixed === false;

  return (
    <Alert kind={comparable ? 'ok' : 'warn'}>
      <strong>เดือนนี้มีใบที่คำนวณด้วยกฎคนละชุด</strong>
      <div style={{ marginTop: 4 }}>{named.join(' · ')}</div>
      <div style={{ fontSize: 12.5, marginTop: 6 }}>
        {spread.arithmeticMixed === true && (
          <>
            กฎที่ใช้คำนวณชั่วโมงต่างกันจริง — ตัวเลขรวมด้านล่างจึงมาจากวิธีคิดมากกว่าหนึ่งแบบ ·
            {' '}ตรวจก่อนเซ็นรับรอง หรือสั่งคำนวณใหม่ทั้งเดือนพร้อมระบุเหตุผลที่หน้า ตั้งค่าระบบ → นโยบายการคำนวณ
          </>
        )}
        {comparable && (
          <>
            เวอร์ชันต่างกันแต่กฎที่ใช้คำนวณชั่วโมงเหมือนกันทุกข้อ — ตัวเลขเทียบกันได้ตามปกติ ·
            {' '}ที่ต่างคือข้อกำหนดเชิงสิทธิ์ ไม่ใช่การคิดชั่วโมง
          </>
        )}
        {spread.arithmeticMixed == null && (spread.unversioned > 0 ? (
          <>
            มีใบที่ไม่ได้บันทึกว่าใช้กฎชุดใด จึงเทียบไม่ได้ว่าตัวเลขมาจากวิธีคิดเดียวกันหรือไม่ ·
            {' '}รัน <code>npm run migrate:policy-version</code> เพื่อกำกับเวอร์ชันให้ใบเก่า
          </>
        ) : (
          <>
            หน้านี้แสดงเลขเวอร์ชันแต่ไม่ได้โหลดกฎเบื้องหลังมาด้วย จึงยังบอกไม่ได้ว่าต่างกันที่การคิดชั่วโมงหรือไม่ ·
            {' '}ดูที่หน้า ตรวจสอบรายเดือน ซึ่งเทียบให้แล้ว
          </>
        ))}
      </div>
    </Alert>
  );
}
