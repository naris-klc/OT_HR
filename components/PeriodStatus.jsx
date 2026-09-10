'use client';

import React, { useEffect, useState } from 'react';
import { api, periodLabel } from '@/lib/api.js';
import { previousMonthOutstanding } from '@/lib/periodStatus.js';
import { previousPeriod } from '@/lib/reports.js';
import { Alert } from './common.jsx';

/**
 * สรุปสถานะงวด — what is still unanswered in this month, and nothing else.
 *
 * IT HAS NO BUTTONS, AND THAT IS THE POINT. Until 2026-08-31 this card was
 * PeriodLockBar: it carried ปิดงวด and เปิดงวด, a confirmation dialog, a
 * reopen-with-a-reason dialog, and the event history behind them. HR withdrew
 * the feature — the printed, signed F-HR-027 in the filing cabinet is the
 * record, so a lock in the database bought nothing and turned every late
 * correction into an errand for an administrator. See lib/periodStatus.js.
 *
 * WHAT SURVIVED IS THE CHECK THE BUTTON USED TO BE PRECEDED BY. ฝ่ายบุคคล come
 * to ตรวจสอบรายเดือน at the end of a month to read the totals, print the sheets
 * and export the file. The question they had before pressing print — is anything
 * in this month still waiting for somebody? — is the same question, and it is
 * worth more than the lock was, because a request nobody has signed is simply
 * absent from the paper.
 *
 * IT IS A NOTICE, NOT A CONTROL, so it never disables or hides itself by role.
 * The old card decided what to draw from `closeRefusal` and `reopenRefusal`,
 * which meant a หัวหน้า saw a different card from ฝ่ายบุคคล. There is nothing to
 * be permitted here: everybody who can reach this screen reads the same counts.
 */
export default function PeriodStatus({
  period,
  /**
   * ONE LINE INSTEAD OF A CARD — 2026-09-10.
   *
   * Reported as *"หน้านี้ดูยากและรกมากและส่วนกรองข้อมูลควรต่อเนื่องกับส่วนตาราง"*.
   * This card and ไฟล์สแกนนิ้วมือ were the two blocks STANDING BETWEEN the
   * filters and the table they filter — so the controls a reader had just set
   * and the rows those controls decide were separated by two unrelated cards,
   * and the page read as five stacked panels rather than as one screen.
   *
   * WHAT IS GIVEN UP AND WHAT IS NOT. The headline — the one line that answers
   * *is anything in this month still waiting for somebody?* — is what the card
   * existed for, and it is the line that stays. Everything under it is why, and
   * why is read once: it moves behind รายละเอียด, on the same row.
   *
   * NOT A DIFFERENT COMPONENT. The counts, the fetch, the previous-month
   * reminder and the wording are one implementation with two shapes, because
   * two components answering "what is outstanding this month" is the failure
   * this repo names by its cost. `detail` below is built once and drawn by both.
   */
  compact = false,
  /*
   * ── `actions` WAS HERE AND IS NOT ANY MORE — 2026-09-11 ────────────────────
   *
   * It existed for one caller and one control: ไฟล์สแกนนิ้วมือ, handed IN so it
   * would land on this component's own row of toggles instead of beside the
   * headline. That was the 2026-09-10 repair for a 390px phone where a sibling
   * on the right took half the width from "…ค้างอยู่ 13 ใบ".
   *
   * The button is on ตรวจสอบประจำเดือน's `.card-head` now, with the card's other
   * actions, and this component went inside the card with the rest of the
   * notices — so nothing is left to hand in. The phone problem it solved cannot
   * come back by this route either: the headline has the full width of the
   * notices band and no sibling on its right at any size.
   *
   * ⚠ WHAT IS KEPT is `.strip-actions` and the row it draws — รายละเอียด still
   * lives on it. A row built for two controls holding one is not a reason to
   * flatten it into the headline; the fold is what the whole `compact` shape
   * exists to offer.
   */
}) {
  const [state, setState] = useState(null);
  /** Whether the WHY under the headline is open — compact mode only. */
  const [open, setOpen] = useState(false);
  const [previous, setPrevious] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    try {
      setState(await api.get(`/periods/${period}`));
      setErr('');
    } catch (e) { setErr(e.message); }
    /**
     * The month BEFORE this one, fetched separately, and failure is silent.
     *
     * ฝ่ายบุคคล arrive on the current month by default; the month that ENDED is
     * the one they are about to print, and no other line on this screen mentions
     * it. A reminder that cannot be fetched is not a reason to break the card
     * about the month they are actually looking at.
     */
    try {
      setPrevious(await api.get(`/periods/${previousPeriod(period)}`));
    } catch { setPrevious(null); }
  }

  useEffect(() => { setState(null); setPrevious(null); load(); }, [period]);

  // Nothing at all until the counts are known: a card that says "ไม่มีเอกสาร
  // ตกค้าง" for half a second on a month with four pending requests is worse
  // than no card.
  //
  // ⚠ AND NOTHING IS DRAWN AROUND THE FAILURE EITHER, since 2026-09-11. This
  // used to return an empty `.period-strip` carrying the handed-in toggles, so
  // that ไฟล์สแกนนิ้วมือ did not vanish because a count failed to load. That
  // button is on the card head now and never passed through here, so the wrapper
  // held nothing — and an empty strip is the one thing `.month-notices:empty`
  // cannot take off the page.
  if (!state) return err ? <Alert kind="error">{err}</Alert> : null;

  const lastMonth = previousMonthOutstanding(previous);

  /**
   * EVERYTHING UNDER THE HEADLINE, built once for both shapes.
   *
   * The card prints it always; the strip prints it behind รายละเอียด. Written
   * as one expression rather than duplicated into the two returns because the
   * wording of these lines is the part that has been revised most — see the
   * notes inside it — and two copies is two of them to revise next time.
   */
  const detail = (
    <>
      {/* `why` AND NOT `text`, because the headline directly above already
          carries the count. The first draft printed the whole sentence here
          and the card read "มีใบรออนุมัติค้างอยู่ 4 ใบ" twice, one line
          apart — which reads as a bug rather than as emphasis.

          Two outstanding things get their `short` back as a label, because
          then the headline holds two counts and two bare consequences under
          it would be a matching exercise. */}
      {state.outstanding.map((item) => (
        <div className="hint" key={item.kind} style={{ margin: '4px 0 0' }}>
          {state.outstanding.length > 1 ? `${item.short} — ${item.why}` : item.why}
        </div>
      ))}

      {/* Finished, and worth a second look before the sheet is signed — never
          in the headline, because neither of these holds up a printout, and
          always with its count, because nothing above them named it. */}
      {state.review.length > 0 && (
        <div className="hint" style={{ margin: '4px 0 0' }}>
          ควรตรวจก่อนพิมพ์ (ไม่ได้ค้างใคร):
          {state.review.map((item) => (
            <div key={item.kind}>· {item.text}</div>
          ))}
        </div>
      )}

      {/* Only when last month still has something unanswered in it. A quiet
          finished month is silent — see previousMonthOutstanding.

          TWO LINES, WHAT AND THEN WHAT TO DO — 2026-09-10. This read
          "สิงหาคม 2569 ยังมีของค้างอยู่ — มีใบรออนุมัติค้างอยู่ 298 ใบ ·
          เลือกเดือนนั้นด้านบนเพื่อตรวจก่อนพิมพ์" as one run: ค้างอยู่ twice in
          one sentence, and "ด้านบน" pointing at a ประจำเดือน box that has been
          BELOW this line since the strip moved over the controls card. It names
          the box now, not a direction, so it stays true wherever the box goes. */}
      {lastMonth && (
        <div className="hint" style={{ margin: '6px 0 0' }}>
          <strong>เดือนก่อน · {periodLabel(previousPeriod(period))}</strong>
          {' '}— {lastMonth.outstanding.map((i) => i.short).join(' และ ')}
          <div>เลือกเดือนนั้นในช่อง ประจำเดือน เพื่อตรวจก่อนพิมพ์</div>
        </div>
      )}
    </>
  );

  /** Is there anything behind the headline worth a control to reach? */
  const hasDetail = Boolean(
    state.outstanding.length || state.review.length || lastMonth,
  );

  if (compact) {
    return (
      <div className={`period-strip ${state.clear ? 'clear' : 'outstanding'}`}>
        <div className="strip-line">
          {/* THE GLYPH IS NOT THE ONLY THING THAT SAYS WHICH — `.clear` and
              `.outstanding` colour the line as well, and the word ค้าง or the
              tick is in the headline itself. A ✓/⚠ carrying the whole message
              is one that a reader with a colour deficiency and a screen reader
              both miss; here it is the third telling, not the first. */}
          <span className="strip-mark" aria-hidden="true">{state.clear ? '✓' : '⚠'}</span>
          <strong className="strip-head">{state.headline}</strong>
        </div>
        {/* ซ่อนรายละเอียด and not a bare ซ่อน. It read "with two toggles on the
            row, a bare verb does not say which of the two it hides" until
            2026-09-11, when ไฟล์สแกนนิ้วมือ left this row for the card head. The
            wording stays: this notice sits in a band with ผลเทียบสแกน and
            MonthAlerts under it, all of which can be opened or closed, and a
            bare ซ่อน names none of them. */}
        {hasDetail && (
          <div className="strip-actions">
            <button
              type="button"
              className="strip-more"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? 'ซ่อนรายละเอียด' : 'รายละเอียด'}
              <span aria-hidden="true">{open ? ' ▲' : ' ▼'}</span>
            </button>
          </div>
        )}
        {/* Opened in place, under its own line and still above the controls
            card — so what a reader unfolds does not push the table off the
            screen the way a third card between them did. */}
        {open && <div className="strip-detail">{detail}</div>}
        {err && <Alert kind="error">{err}</Alert>}
      </div>
    );
  }

  return (
    <div className={`card period-status ${state.clear ? 'clear' : 'outstanding'}`}>
      <div>
        <strong>{state.clear ? '✓ ' : '⚠ '}{state.headline}</strong>
        {detail}
      </div>

      {err && <div style={{ marginTop: 10 }}><Alert kind="error">{err}</Alert></div>}
    </div>
  );
}
