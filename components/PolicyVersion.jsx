'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
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
 * The live rules are not on record — said on the screens people actually open.
 *
 * The condition and its cost are UnrecordedPolicy's in AdminView.jsx: while the
 * live policy differs from the newest recorded version, every entry filed is
 * filed unstamped, silently. What that component cannot do is be seen. It lives
 * on ตั้งค่าระบบ → นโยบายการคำนวณ, a page opened when somebody has a policy
 * question — roughly once a month — and the drift starts on a deploy. So the
 * warning and the entries it is about miss each other by weeks, which is the
 * same failure the whole mechanism exists to prevent, moved one screen along.
 *
 * This is the same fact on the queues, which are opened daily. One strip, and
 * deliberately less than the full banner: no per-item diff, no record button.
 * Both are on นโยบายการคำนวณ and both need reading before they are pressed, so
 * repeating them here would put a policy decision on a screen somebody is
 * halfway through approving a day's overtime on. This says what is wrong and
 * where it is fixed; that page says what changed and fixes it.
 *
 * Fetched once, when the screen mounts. It is a fact about a deploy, not about
 * the queue under it, so it cannot become true while somebody is reading — and
 * the endpoint counts every entry in the database by version, which is not a
 * thing to poll behind a page that is doing something else.
 *
 * Only for hr and admin: GET /settings/policy-versions is theirs (see the
 * route), so a manager's request would be a 403 on every load of รออนุมัติ.
 * That is the right answer rather than a gap to close — a manager cannot open
 * นโยบายการคำนวณ, has no tab leading to it, and cannot record a version, so the
 * strip would name a problem they can neither check nor fix.
 */
export function PolicyDriftBanner({ user, onOpenPolicy }) {
  const [live, setLive] = useState(null);
  const mayRead = ['hr', 'admin'].includes(user?.role);

  useEffect(() => {
    if (!mayRead) return undefined;
    let alive = true;
    // limit=1 — `live` is computed against the newest version alone, and the
    // version list itself is นโยบายการคำนวณ's business, not this strip's.
    api.get('/settings/policy-versions?limit=1')
      .then((res) => { if (alive) setLive(res.live || null); })
      // Silent: this is a warning about something else. A queue that will not
      // load its own rows says so; one that could not check the policy version
      // must not push that in front of the work.
      .catch(() => {});
    return () => { alive = false; };
  }, [mayRead]);

  if (!live || live.recorded) return null;

  // One child, not three: .alert is a flex row whose first item is the icon,
  // so every element passed in becomes another column beside it.
  return (
    <Alert kind="warn">
      <div>
        <strong>
          {live.latestSeq == null
            ? 'กฎที่ใช้อยู่ยังไม่เคยถูกบันทึกเป็นเวอร์ชัน'
            : `กฎที่ใช้อยู่ไม่ตรงกับเวอร์ชัน ${live.latestSeq} ซึ่งเป็นเวอร์ชันล่าสุดที่บันทึกไว้`}
        </strong>
        {' — ใบ OT ที่ยื่นใหม่จะไม่ถูกกำกับเวอร์ชัน'}
        {onOpenPolicy && (
          <>
            {' · '}
            <button type="button" className="link" onClick={onOpenPolicy}>
              ดูรายละเอียดที่หน้านโยบายการคำนวณ
            </button>
          </>
        )}
      </div>
    </Alert>
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
/**
 * WHETHER THIS BANNER HAS ANYTHING TO SAY, AND HOW LOUDLY — for a caller that
 * has to know before it renders.
 *
 * ตรวจสอบรายเดือน gathers its top-of-card notices into one strip and has to
 * count them, colour the strip by the worst of them and name each in a line.
 * All three questions are this component's to answer, so they are answered
 * here and `PolicyVersionBanner` reads its own `kind` off the same call. Asking
 * `spread.mixed` again at the call site is how two rules that disagree start.
 *
 * `label` is the strip's line, not a summary of the banner: five words that say
 * which notice this is, with the reading left to the banner underneath.
 */
export function policyVersionNotice(spread) {
  if (!spread?.mixed) return null;
  return {
    // `ok` is not a softer warning, it is a different answer: the versions
    // differ and the arithmetic behind them does not, so the figures compare.
    kind: spread.arithmeticMixed === false ? 'ok' : 'warn',
    label: 'กฎการคำนวณคนละชุด',
  };
}

export function PolicyVersionBanner({ spread }) {
  const notice = policyVersionNotice(spread);
  if (!notice) return null;

  const named = spread.used
    .map((u) => (u.seq != null
      ? `เวอร์ชัน ${u.seq} (${u.count} ใบ)`
      : `ไม่ทราบเวอร์ชัน (${u.count} ใบ)`));
  if (spread.unversioned) named.push(`ไม่ระบุเวอร์ชัน (${spread.unversioned} ใบ)`);

  const comparable = spread.arithmeticMixed === false;

  return (
    // From `policyVersionNotice` above, so the strip on ตรวจสอบรายเดือน and the
    // banner it opens are never two different colours about one month.
    <Alert kind={notice.kind}>
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
