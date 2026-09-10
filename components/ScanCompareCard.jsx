'use client';

import React from 'react';
import { periodLabel } from '@/lib/api.js';
import { Alert } from './common.jsx';
import { SCAN_BADGE } from '@/lib/scanMatch.js';

/**
 * ผลเทียบกับไฟล์สแกนนิ้วมือ — the month's reconciliation, as a card of its own.
 *
 * ── WHY THIS IS NOT PART OF ไฟล์สแกนนิ้วมือ ANY MORE ────────────────────────
 *
 * It was, until 2026-09-10, and the day it stopped being enough is the day the
 * import card learned to fold. `scanOpen` opens `false` on every visit — a
 * deliberate declutter, and the right call for the IMPORT, which is a
 * once-a-month act — but the comparison went down with it, and the comparison
 * is not an act. It is the answer to *"is this month safe to sign"*, which is
 * the question the whole screen exists to ask.
 *
 * So the two were split along the line that was always there:
 *
 *   · **นำเข้าไฟล์สแกน is a DEED** — done once, by one person, on one day.
 *     It folds, and components/ScanImport.jsx is still where it lives.
 *   · **ผลเทียบ is a FACT about the month on screen** — read by everybody who
 *     opens this tab, every time, before they trust a total. Facts do not fold.
 *
 * That is the same line `MonthAlerts` sits on, which is why this card sits
 * directly under it and above everything a reader can press.
 *
 * ── AND IT DOES NOT REPLACE THE ROW MARKS ──────────────────────────────────
 *
 * lib/scanMatch.js is a WARNING, not an arithmetic: no hour, bucket, ceiling or
 * status moves because of anything counted here. This card says how big the
 * pile is and offers one press to stand in front of it (`ดูเฉพาะคนที่ต้องตรวจ`);
 * the verdict on any single row is still one click deep, on that person's own
 * list, where the punch times are printed beside the request that claimed them.
 *
 * ── THE THREE STATES, AND THE ONE THAT USED TO BE INVISIBLE ────────────────
 *
 *   1. **ยังไม่ได้เทียบ** — no punches imported for this month at all. ONE ROW
 *      since 2026-09-11 (`.scan-line`); it read "said LOUDLY (`.scan-none`)"
 *      until then, and the reason it was said loudly is unchanged: the state it
 *      is most often mistaken for is state 3, and from a table with no marks on
 *      it the two look identical. A month nobody has checked and a month that
 *      came back clean are opposite answers and this card is the only thing that
 *      distinguishes them — which it does by SAYING SO, not by the size it says
 *      it in. See the block over the branch below.
 *   2. **มีคนต้องตรวจ** — the amber pile, with the way to it.
 *   3. **ทุกแถวตรง** — quiet, green, one sentence.
 *
 * Decided 2026-09-10 (docs/plan-monthly-review-approve-inline.md §5.3): state 1
 * does NOT disable approving. The comparison points at rows; it does not hold a
 * gate, and a month whose file arrives late is not a month that may not be
 * signed. The card says so on the same row — `ยืนยันได้ตามปกติ`.
 */
export default function ScanCompareCard({
  period,
  /** `{ counts, people, entryCount }` from `compareMonthAgainstScans`, or null. */
  compare = null,
  /** How many punches this month holds. `0`/`null` is state 1 above. */
  punchCount = null,
  /** Still fetching — draws nothing rather than claiming a month has no scans. */
  loading = false,
  /** Is the table currently narrowed to the flagged people? */
  onlyFlagged = false,
  /** Toggle that narrowing. Null hides the button (a reader who cannot filter). */
  onToggleFlagged = null,
  /** Open the import card — the one thing to do about state 1. */
  onOpenImport = null,
}) {
  /**
   * A month still loading claims nothing. The state this card exists to name is
   * "nobody has imported the file", and an unfinished request looks exactly
   * like it — which would put the loudest sentence on this screen in front of
   * a reader for the length of a round trip, on a month that is fine.
   */
  if (loading) return null;

  const flagged = compare?.people?.length || 0;
  const counts = compare?.counts;

  // ── 1. ยังไม่ได้เทียบ ─────────────────────────────────────────────────────
  /*
   * ⚠ ONE ROW SINCE 2026-09-11, AND IT WAS FOUR — a 16px headline, two hint
   * lines and a button on a line of its own. Asked for in three words:
   * *"ปรับอีกครับ กระชับให้เป็นแถวเดียว"*.
   *
   * WHAT THE 16px WAS FOR IS NOT WHAT IT DOES HERE ANY MORE. `.scan-none` was
   * written when this card floated on the page as a block of its own, where
   * being the loudest thing on the screen is what separated *"nobody imported
   * the file"* from *"every row agrees"* — two states that look identical from a
   * table with no marks on it. That separation is still the card's whole job and
   * is untouched: what distinguishes the two is that THIS SENTENCE EXISTS, not
   * that it is drawn large. Inside `.month-notices`, one line among งวด…ยังเปิด
   * อยู่ and MonthAlerts, a 16px shout is not louder than its neighbours — it is
   * simply a different size from them, which reads as the thing not belonging.
   *
   * THREE OF THE FOUR LINES WERE ANSWERED ELSEWHERE ON THE SCREEN:
   *   · the month — the card head one row up prints it, so `เดือนนี้` is not a
   *     question here the way it is at the top of a page;
   *   · *ตารางข้างล่างจึงไม่มีคอลัมน์ สแกน* — the reader can see that there is no
   *     such column;
   *   · *การเทียบสแกนเป็นการชี้ให้ดู ไม่ใช่เงื่อนไขการอนุมัติ* — the RULE stays
   *     (§5.3: this state does not gate approving) and is said as
   *     `ยืนยันได้ตามปกติ`, because what a reader needs from it is permission,
   *     not the doctrine behind the permission.
   *
   * WHAT COULD NOT BE CUT is `ไม่ได้แปลว่าทุกแถวตรง`. It is the misreading the
   * card exists to prevent, and it is the only clause here that carries new
   * information rather than restating the headline.
   */
  if (!punchCount) {
    return (
      <div className="scan-compare no-print">
        <Alert kind="info" mark={false}>
          <div className="scan-line">
            <span>
              <strong>ยังไม่ได้เทียบกับไฟล์สแกนนิ้วมือ</strong>
              {' — '}<strong>ไม่ได้แปลว่าทุกแถวตรง</strong> · ยืนยันได้ตามปกติ
            </span>
            {onOpenImport && (
              <button type="button" className="btn ghost sm" onClick={onOpenImport}>
                นำเข้าไฟล์สแกน
              </button>
            )}
          </div>
        </Alert>
      </div>
    );
  }

  // Punches are in but the comparison has not been asked for or came back
  // empty-handed. Nothing honest to say, so nothing is said.
  if (!counts) return null;

  const checked = counts.checked || 0;
  const agreed = Math.max(0, checked - (counts.mismatch || 0));

  return (
    <div className="scan-compare no-print">
      <Alert kind={counts.mismatch ? 'warn' : 'ok'} mark={false}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
          <strong>ผลเทียบกับไฟล์สแกนนิ้วมือ — {periodLabel(period)}</strong>
        </div>

        {/* THE HEADLINE IS THE PILE THAT NEEDS A PERSON, and it is the only
            figure here drawn large. Everything under it is the breakdown, in
            HR's own four words and in the order they gave them — see
            `SCAN_BADGE`. Naming the pile after half of itself is a mistake this
            comparison has already made once (see `summariseScanChecks`), which
            is why ไม่ครบ and เวลาเริ่มไม่ตรง are printed apart. */}
        <div className="scan-head">
          {counts.mismatch > 0 ? (
            <>
              <span className="scan-big warn">⚠ ต้องตรวจ {counts.mismatch} แถว</span>
              <span className="hint">{' '}({flagged} คน จาก {compare.entryCount} ใบ)</span>
            </>
          ) : (
            <span className="scan-big ok">✓ ทุกแถวที่เทียบได้ตรงกับไฟล์สแกน</span>
          )}
        </div>

        <div className="scan-tally">
          <span><strong>{counts.short}</strong> {SCAN_BADGE.SHORT}</span>
          <span><strong>{counts.startOff}</strong> {SCAN_BADGE.START_OFF}</span>
          <span><strong>{counts.noScan}</strong> {SCAN_BADGE.NO_SCAN} (ไม่มีสแกนนิ้ว)</span>
          <span className="quiet"><strong>{counts.overTime}</strong> {SCAN_BADGE.OVER}</span>
          <span className="quiet"><strong>{counts.flatDaily}</strong> เหมารายวัน</span>
          <span className="quiet"><strong>{agreed}</strong> ตรง</span>
        </div>

        {/* เกินเวลา และ เหมารายวัน ARE FACTS, NOT ERRANDS — *ข้อเท็จจริง ป้ายเทา
            ไม่นับกองที่ต้องตรวจ* (2026-09-07). They are drawn `.quiet` for the
            same reason they are counted outside `mismatch`: a screen that folds
            facts into the errand count is a screen whose errand count nobody
            trusts. Said in words as well as in colour, because colour alone is
            not a sentence. */}
        <div className="hint" style={{ margin: '6px 0 0' }}>
          <strong>{SCAN_BADGE.OVER}</strong> และ <strong>เหมารายวัน</strong> เป็นข้อเท็จจริง
          {' '}ไม่นับเป็นกองที่ต้องตรวจ · <strong>ตัวเลขชั่วโมงไม่ได้ถูกแก้จากไฟล์สแกน</strong>
          {' '}— นี่เป็นการชี้ให้ดู ไม่ใช่การคิดใหม่
        </div>

        {/* THE PRESS THAT TURNS A NUMBER INTO A PLACE TO STAND. It narrows the
            table below rather than listing names here: the list of names was
            what this card printed until today and it capped at twelve, which
            on a month with thirty flagged people is a card that names less than
            half of them and no way to reach the rest.

            A TOGGLE AND NOT A ONE-WAY TRIP — pressing it again is the way back,
            and ล้างตัวกรอง releases it too, because a filter the filter bar does
            not know about is how somebody comes to believe this month has
            eleven employees in it. */}
        {onToggleFlagged && flagged > 0 && (
          <button
            type="button"
            className={onlyFlagged ? 'btn ghost sm on' : 'btn ghost sm'}
            style={{ marginTop: 8 }}
            onClick={onToggleFlagged}
            aria-pressed={onlyFlagged}
          >
            {onlyFlagged
              ? 'แสดงทุกคนในเดือนนี้'
              : `ดูเฉพาะคนที่ต้องตรวจ (${flagged} คน)`}
          </button>
        )}
      </Alert>
    </div>
  );
}
