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
   * ⚠ `.strip-actions` WENT WITH IT ON 2026-09-11 — it read *"a row built for
   * two controls holding one is not a reason to flatten it into the headline"*
   * until that day, and the answer to that was *"กระชับให้แสดงใน 1 แถว"*. A row
   * of its own for one inline verb is what made this notice three lines tall
   * beside a band of one-line neighbours. รายละเอียด is in the sentence now.
   */
}) {
  const [state, setState] = useState(null);
  /** Whether the WHY under the headline is open — compact mode only. */
  /*
   * ⚠ `const [open, setOpen] = useState(false)` STOOD HERE — the fold behind
   * รายละเอียด. Asked to go on 2026-09-11: *"ให้กระชับ ได้ใจความในแถวเดียว
   * กันกับแจ้งเตือน เลยไม่ต้องกดซ่อนแสดงรายละเอียด"*. The strip says the whole of
   * itself in the row now, so there is nothing left to open.
   */
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
   * เดือนก่อนค้างอะไรไว้ — the counted half, built once and read by both shapes.
   *
   * The two draw it differently (the card gives it two lines, the row a clause)
   * and that is layout; the SENTENCE is one, and a second `.map(...).join(' และ
   * ')` in the other branch is the second copy that gets fixed and the first one
   * that does not.
   */
  const lastMonthShorts = lastMonth
    ? lastMonth.outstanding.map((i) => i.short).join(' และ ')
    : '';

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
          {' '}— {lastMonthShorts}
          <div>เลือกเดือนนั้นในช่อง ประจำเดือน เพื่อตรวจก่อนพิมพ์</div>
        </div>
      )}
    </>
  );

  /*
   * ⚠ `hasDetail` STOOD HERE — *is there anything behind the headline worth a
   * control to reach?* Nothing is behind the headline any more (2026-09-11), so
   * the question has no answer to give: each of the three pieces it counted now
   * draws or does not draw itself, in the row, on its own condition.
   */

  if (compact) {
    return (
      /**
       * ── ⚠ `box warn` / `box ok` — 2026-09-11 ─────────────────────────────
       *
       * *"เปลี่ยนแจ้งเตือนนี้ … ให้เป็นสไตล์เดียวกับแจ้งเตือนด้านล่าง"*, pointing at
       * the cream band สรุป OT ส่งบัญชี and สรุปแผนก carry over their totals —
       * `ค้างอนุมัติ n รายการ … ซึ่งไม่ถูกนับในสรุปนี้`. IT IS THE SAME SENTENCE
       * ABOUT THE SAME QUEUE, said one screen earlier, so it had no business
       * being a differently-shaped object.
       *
       * `box` AND NOT A GROUND OF ITS OWN. `.box` is the app's four-palette
       * band and those two screens wear it unmodified; `.period-strip` beside
       * it now says only what a notice with a fold needs on top of one.
       *
       * ⚠ AND THE TWO STATES TAKE TWO PALETTES. `warn` while something is
       * outstanding, `ok` when nothing is — a green band is the answer to the
       * question this component exists to ask before somebody prints, and
       * leaving the clear month blank would mean *checked, nothing pending*
       * and *not loaded* look identical again. `.clear`/`.outstanding` are gone
       * with the palettes they used to carry by hand.
       */
      <div className={`period-strip box ${state.clear ? 'ok' : 'warn'}`}>
        {/* ── ⚠ ONE ROW, AND NOTHING IS FOLDED AWAY IN IT ──────────────────

            It was a headline row, a `.strip-actions` row under it and a panel
            behind รายละเอียด — three lines tall before anything was opened, in a
            band whose other notices are one. Cut in two steps on 2026-09-11:
            *"กระชับให้แสดงใน 1 แถว"* moved the verb into the sentence, and
            *"ให้กระชับ ได้ใจความในแถวเดียว กันกับแจ้งเตือน เลยไม่ต้องกดซ่อนแสดง
            รายละเอียด"* took the verb away as well.

            ⚠ THE FOLD WAS NOT PROTECTING MUCH. What it hid was one consequence
            clause and last month's count — two facts, both of them the reason
            the headline matters, and both of them shorter than the control that
            hid them. A notice whose point is *read this before you print* that
            makes the reader press to find out why is a notice half of them will
            not finish.

            EVERYTHING IS TEXT IN ONE FLOW, not flex items. As separate items
            this row broke BETWEEN them at 390px — the ⚠ took a line to itself,
            the headline wrapped across two more, the verb landed on a fourth.
            Written as a sentence it wraps the way a sentence wraps, and one row
            is what a desktop sees. */}
        <div className="strip-line">
          {/* THE GLYPH IS NOT THE ONLY THING THAT SAYS WHICH — the band's own
              palette says it too, and the word ค้าง or the tick is in the
              headline itself. A ✓/⚠ carrying the whole message is one that a
              reader with a colour deficiency and a screen reader both miss;
              here it is the third telling, not the first. */}
          <span className="strip-mark" aria-hidden="true">{state.clear ? '✓' : '⚠'}</span>
          <strong className="strip-head">{state.headline}</strong>

          {/* `why` AND NOT `text`, because the headline four words back already
              carries the count — the first draft of the old card printed the
              whole sentence and read "มีใบรออนุมัติค้างอยู่ 4 ใบ" twice, which
              reads as a bug rather than as emphasis. Two outstanding things get
              their `short` back, because then the headline holds two counts and
              two bare consequences after it would be a matching exercise. */}
          {state.outstanding.map((item) => (
            <React.Fragment key={item.kind}>
              {' · '}
              {state.outstanding.length > 1 ? item.text : item.why}
            </React.Fragment>
          ))}

          {/* Finished, and worth a second look before the sheet is signed —
              after the outstanding pile and never in the headline, because
              neither of these holds up a printout. */}
          {state.review.length > 0 && (
            <>
              {' · ควรตรวจก่อนพิมพ์ (ไม่ได้ค้างใคร) '}
              {state.review.map((item) => item.text).join(' · ')}
            </>
          )}

          {/* Only when last month still has something unanswered in it. A quiet
              finished month is silent — see `previousMonthOutstanding`.

              IT NAMES THE BOX, NOT A DIRECTION. This read "เลือกเดือนนั้นด้านบน"
              until 2026-09-10, pointing at a ประจำเดือน picker that has been
              BELOW this line since the strip moved over the controls; a name
              stays true wherever the box goes. Shortened to the verb and the box
              on 2026-09-11 — เพื่อตรวจก่อนพิมพ์ is what the whole notice is for
              and does not need saying a second time inside it. */}
          {lastMonth && (
            <>
              {' · '}
              <strong>เดือนก่อน · {periodLabel(previousPeriod(period))}</strong>
              {' '}{lastMonthShorts} — เลือกที่ช่อง ประจำเดือน
            </>
          )}
        </div>
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
