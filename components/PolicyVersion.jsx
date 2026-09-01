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
      {/* `pv-by` — who set this rule set, under which rule set it is. The two
          lines were 11.5px on `--muted` against 14px on the ink above them, and
          at that distance the pair read as one two-line value rather than as a
          figure with a note about it. The class carries the size and a step
          lighter; it replaces an inline style, which is the one thing a media
          query cannot reach. */}
      {version.createdByName && (
        <div className="pv-by">ตั้งโดย {version.createdByName}</div>
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
 * EVERY WORD THIS WARNING HAS, IN ONE PLACE — and whether it has any at all.
 *
 * Two screens draw this now and they draw it differently. ตรวจสอบใบของพนักงาน
 * (`HrEntries`) still opens the full panel; ตรวจสอบรายเดือน puts it in a list
 * inside its alert strip, as a heading, a line of figures and a sentence. What
 * neither of them may do is hold its own copy of the wording: a warning that is
 * worded twice is a warning that gets corrected once.
 *
 * So the four cases live here with the version list and the colour, and both
 * callers are renderers. The strip also has to know, BEFORE it renders, whether
 * there is anything to say and how loud it is — `null` and `kind` are that
 * answer, and asking `spread.mixed` again at the call site is how two rules
 * that disagree start.
 *
 * `label` is the item's heading and the strip's collapsed line, in that order
 * of importance: five words that say which notice this is.
 *
 * THE FOUR CASES, and why they are four. "More than one version" is the literal
 * condition and on its own it cries wolf: answering OPEN 7 (may HR reject after
 * the manager approved) mints a version like any other and moves no number at
 * all. A banner that fires on that trains HR to dismiss the one that fires when
 * the rounding rule changed mid-month. So the two that cannot answer "do these
 * figures compare" say which of them they are. `arithmeticMixed` is null for
 * two quite different reasons — rows whose rules were never recorded, and a
 * screen holding version numbers but not the snapshots behind them — and
 * telling HR to run a migration when the real answer is "open ตรวจสอบรายเดือน"
 * sends them somewhere that will not help.
 */
export function policyVersionNotice(spread, { onGoMonthly } = {}) {
  if (!spread?.mixed) return null;

  const named = spread.used
    .map((u) => (u.seq != null
      ? `เวอร์ชัน ${u.seq} (${u.count} ใบ)`
      : `ไม่ทราบเวอร์ชัน (${u.count} ใบ)`));
  if (spread.unversioned) named.push(`ไม่ระบุเวอร์ชัน (${spread.unversioned} ใบ)`);

  /**
   * ONE LINE EACH, AND WHAT THAT COST.
   *
   * These ran to three sentences apiece until 2026-08-25 and each opened by
   * restating the condition — "กฎที่ใช้คำนวณชั่วโมงต่างกันจริง — ตัวเลขรวมจึง
   * มาจากวิธีคิดมากกว่าหนึ่งแบบ" in front of what to do about it. `heading`
   * above already says that in four words, and both callers draw `heading`
   * directly over this line, so it was the same fact twice, fourteen pixels
   * apart, on the screen that has the least room for it.
   *
   * WHAT DID NOT GO: the instruction, and where to carry it out.
   * `ตรวจก่อนเซ็นรับรอง` is the whole reason the first of these exists; the
   * migration command is the whole reason the third does. A version of this
   * that kept only the figures would be a tidier panel that had stopped saying
   * the thing it is for.
   */
  let say;
  if (spread.arithmeticMixed === true) {
    say = 'ตรวจก่อนเซ็นรับรอง หรือสั่งคำนวณใหม่ทั้งเดือนที่ ตั้งค่าระบบ → นโยบายการคำนวณ';
  } else if (spread.arithmeticMixed === false) {
    say = 'ต่างกันที่ข้อกำหนดเชิงสิทธิ์ ไม่ใช่การคิดชั่วโมง — ตัวเลขเทียบกันได้ตามปกติ';
  } else if (spread.unversioned > 0) {
    say = (
      <>
        มีใบที่ไม่ได้บันทึกว่าใช้กฎชุดใด — รัน <code>npm run migrate:policy-version</code>
      </>
    );
  } else {
    /* THE ONE CASE THAT NAMES A SCREEN, AND NOW OFFERS TO OPEN IT.

       This is the case whose whole content is "the answer is somewhere else":
       `arithmeticMixed` is null because THIS screen holds version numbers and
       not the snapshots behind them, and ตรวจสอบรายเดือน holds both. Telling
       somebody where to go and then making them find their own way there is
       the sentence doing half its job — กลับไปสรุปรายเดือน is at the top of
       the card, but nothing joins the two up.

       OPTIONAL, AND THAT IS NOT DEFENSIVE CODING. `MonthAlerts` draws this same
       notice ON ตรวจสอบรายเดือน, where a link back to the screen you are
       already on is worse than no link; it passes no callback and gets the
       plain sentence. It is the shape `AddBirthDateHint` in components/common.jsx
       already uses for the same reason — a link to a tab the reader does not
       have is worse than none — and the two halves of the wording are each
       written once here, so the string and the linked version cannot drift
       apart. */
    const lead = 'หน้านี้ไม่ได้โหลดกฎมาเทียบ — ดูที่หน้า ';
    const where = 'ตรวจสอบประจำเดือน';
    say = onGoMonthly
      ? (
        <>
          {lead}
          <button type="button" className="link" onClick={onGoMonthly}>{where}</button>
        </>
      )
      : lead + where;
  }

  return {
    // `ok` is not a softer warning, it is a different answer: the versions
    // differ and the arithmetic behind them does not, so the figures compare.
    kind: spread.arithmeticMixed === false ? 'ok' : 'warn',
    label: 'กฎการคำนวณคนละชุด',
    heading: 'เดือนนี้มีใบที่คำนวณด้วยกฎคนละชุด',
    figures: named.join(' · '),
    say,
  };
}

export function PolicyVersionBanner({ spread, onGoMonthly }) {
  const notice = policyVersionNotice(spread, { onGoMonthly });
  if (!notice) return null;

  return (
    // A renderer of `policyVersionNotice` and nothing else, so this panel and
    // the list item ตรวจสอบรายเดือน draws from the same call can never be two
    // different colours — or two different sentences — about one month.
    <Alert kind={notice.kind}>
      <strong>{notice.heading}</strong>
      <div style={{ marginTop: 4 }}>{notice.figures}</div>
      {/* THE INSTRUCTION, ONE STEP QUIETER — and by the same class ตรวจสอบ
          รายเดือน already prints this exact sentence with. It carried its own
          inline `fontSize` until 2026-08-26, which is how one line of one
          notice ended up being the only place in the app that said 12.5 by
          hand: the size, the space above it and the grey now come from
          `.alert .say`, so the panel and the list are one decision.

          WHY THE PANEL NEEDED IT. Three lines in one amber, two of them the
          same size, is a block the eye has to read to sort — and the third line
          is the only one that says what to DO about the other two. */}
      <div className="say">{notice.say}</div>
    </Alert>
  );
}
