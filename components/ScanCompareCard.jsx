'use client';

import React from 'react';
import { periodLabel, companyLabel } from '@/lib/api.js';
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
 * States 2 and 3 CAN BE ABOUT HALF A MONTH. Since 2026-09-11 a company with no
 * file of its own is left out of the comparison entirely rather than counted as
 * `ไม่มีสแกน`, so both states carry a line naming what they do not cover — see
 * the block over it, and docs/plan-monthly-partial-scan-import.md.
 *
 * Decided 2026-09-10 (docs/plan-monthly-review-approve-inline.md §5.3): state 1
 * does NOT disable approving. The comparison points at rows; it does not hold a
 * gate, and a month whose file arrives late is not a month that may not be
 * signed. The card says so on the same row — `ยืนยันได้ตามปกติ`.
 */
export default function ScanCompareCard({
  period,
  /**
   * `{ counts, people, entryCount, notImported }` from
   * `compareMonthAgainstScans`, or null. `notImported` is the company keys this
   * งวด holds no file for — the rows those numbers deliberately exclude.
   */
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
  /**
   * บริษัทที่ยังไม่มีไฟล์ของเขาในงวดนี้ — the half of the month these numbers
   * are NOT about. Straight off the comparison, which is where the cut was made
   * (`compareMonthAgainstScans`), so this card and the คอลัมน์ สแกน under it
   * are quoting one answer rather than two readings of `slots`.
   */
  const notImported = compare?.notImported || [];

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
        {/* ── ⚠ FIVE BLOCKS BECAME TWO ROWS — 2026-09-11 ─────────────────

            *"ปรับการแจ้งเตือนตามภาพให้กระชับด้วย แต่ยังได้ใจความครบถ้วน …
            ปรับให้เหลือไม่เกิน 1-2 แถวเป็นอันดับแรก"*. It was a title row, a
            headline row, the tally, a caveat paragraph and a button on a row of
            its own — five blocks for one answer.

            THE TITLE AND THE HEADLINE WERE ALWAYS ONE SENTENCE. *ผลเทียบกับ
            ไฟล์สแกนนิ้วมือ · สิงหาคม 2569* names the question and *⚠ ต้องตรวจ
            10 แถว* answers it; they sat in two blocks because the title row was
            built as a `space-between` flex that never got a second item. Read
            together they are the row, and `.scan-line` — the same row state 1
            uses — puts the one control this card has at the end of it.

            `.scan-big` KEEPS ITS SIZE. It is 15px against the 13px around it
            because it is the figure somebody scans the screen for; inlining it
            after a `<strong>` of the same weight changes where it sits, not how
            loud it is. */}
        <div className="scan-line">
          <span>
            <strong>ผลเทียบกับไฟล์สแกนนิ้วมือ · {periodLabel(period)}</strong>
            {' — '}
            {counts.mismatch > 0 ? (
              <>
                <span className="scan-big warn">⚠ ต้องตรวจ {counts.mismatch} แถว</span>
                <span className="hint">{' '}({flagged} คน จาก {compare.entryCount} ใบ)</span>
              </>
            ) : (
              <span className="scan-big ok">✓ ทุกแถวที่เทียบได้ตรงกับไฟล์สแกน</span>
            )}
          </span>
          {/* THE PRESS THAT TURNS A NUMBER INTO A PLACE TO STAND, and it is at
              the end of the sentence that holds the number now rather than on a
              row of its own. It narrows the table below rather than listing
              names here: the list of names was what this card printed until
              2026-09-10 and it capped at twelve, which on a month with thirty
              flagged people names less than half of them and offers no way to
              the rest.

              A TOGGLE AND NOT A ONE-WAY TRIP — pressing it again is the way
              back, and ล้างตัวกรอง releases it too, because a filter the filter
              bar does not know about is how somebody comes to believe this
              month has eleven employees in it. */}
          {onToggleFlagged && flagged > 0 && (
            <button
              type="button"
              className={onlyFlagged ? 'btn ghost sm on' : 'btn ghost sm'}
              onClick={onToggleFlagged}
              aria-pressed={onlyFlagged}
            >
              {onlyFlagged
                ? 'แสดงทุกคนในเดือนนี้'
                : `ดูเฉพาะคนที่ต้องตรวจ (${flagged} คน)`}
            </button>
          )}
        </div>

        {/* ── ⚠ WHAT THESE NUMBERS ARE NOT ABOUT — 2026-09-11 ──────────────
            A month can arrive half-imported: ไพรมัส's file in and เดมเทค's
            still on somebody's desktop. Since this round those rows are dropped
            before the comparison instead of coming back as `ไม่มีสแกน` (see
            `compareMonthAgainstScans`), which is right for the table — but it
            leaves this card describing HALF A MONTH in a voice that sounds like
            all of it. `✓ ทุกแถวที่เทียบได้ตรงกับไฟล์สแกน` over an unread payroll
            is precisely the misreading this card was built to prevent, one
            company wide instead of one month wide.

            SO IT IS SAID HERE, ABOVE THE BREAKDOWN, in both states — the green
            one needs it more than the amber one. `ยืนยันได้ตามปกติ` is §5.3
            again and carries the same weight it carries in state 1: this is not
            a gate, it is a thing left to do. */}
        {notImported.length > 0 && (
          <div className="scan-line" style={{ margin: '6px 0 0' }}>
            <span>
              ⚠ งวดนี้<strong>ยังไม่ได้นำเข้าไฟล์สแกนของ
                {' '}{notImported.map(companyLabel).join(' และ ')}</strong>
              {' — '}แถวของบริษัทนั้นยังไม่ได้ถูกเทียบกับอะไร และไม่ได้นับอยู่ในตัวเลขข้างล่าง
              {' · '}ยืนยันได้ตามปกติ
            </span>
            {onOpenImport && (
              <button type="button" className="btn ghost sm" onClick={onOpenImport}>
                นำเข้าไฟล์สแกน
              </button>
            )}
          </div>
        )}
        {/* THE CAVEAT IS THE LAST ITEM OF THE TALLY, NOT A PARAGRAPH UNDER IT.

            *เกินเวลา และ เหมารายวัน เป็นข้อเท็จจริง ไม่นับเป็นกองที่ต้องตรวจ* is a
            sentence ABOUT two of the six figures beside it, and `.scan-tally`
            is a wrapping flex row — so as an item it lands on the same line
            whenever there is room and takes its own when there is not, which is
            what a paragraph under the row could never do.

            ⚠ NOTHING IN IT WAS CUT. Both clauses are the ones HR settled on
            2026-09-07 (*ข้อเท็จจริง ป้ายเทา ไม่นับกองที่ต้องตรวจ*) and the line
            that says this comparison restates no hours. They are `.quiet`, like
            the two figures they qualify, for the same reason: a screen that
            folds facts into the errand count is a screen whose errand count
            nobody trusts. */}
        <div className="scan-tally">
          <span><strong>{counts.short}</strong> {SCAN_BADGE.SHORT}</span>
          <span><strong>{counts.startOff}</strong> {SCAN_BADGE.START_OFF}</span>
          <span><strong>{counts.noScan}</strong> {SCAN_BADGE.NO_SCAN} (ไม่มีสแกนนิ้ว)</span>
          <span className="quiet"><strong>{counts.overTime}</strong> {SCAN_BADGE.OVER}</span>
          <span className="quiet"><strong>{counts.flatDaily}</strong> เหมารายวัน</span>
          <span className="quiet"><strong>{agreed}</strong> ตรง</span>
          <span className="quiet">
            {SCAN_BADGE.OVER} และ เหมารายวัน เป็นข้อเท็จจริง ไม่นับเป็นกองที่ต้องตรวจ ·
            {' '}ตัวเลขชั่วโมงไม่ได้ถูกแก้จากไฟล์สแกน
          </span>
        </div>
      </Alert>
    </div>
  );
}
