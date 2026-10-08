'use client';

import React from 'react';
import { periodLabel, companyLabel } from '@/lib/api.js';
import { NoticeRow } from './common.jsx';
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
  /**
   * Is the import drawer open on the screen right now?
   *
   * ⚠ THIS CARD GETS OUT OF THE WAY WHEN IT IS — 2026-09-11, *"ปุ่มนำเข้าไฟล์
   * สแกน ซ้ำซ้อนหลายที่เยอะจัง"*, against a screenshot with three of them
   * stacked in 150px: the head's ไฟล์สแกน ▲, this card's นำเข้าไฟล์สแกน,
   * and the drawer's own นำเข้าไฟล์สแกน (.txt) — of which only the last one
   * opens a file dialog. The other two open a drawer that was already open, so
   * pressing either did nothing at all.
   *
   * SO THE POINTER STANDS DOWN WHEN THE THING IT POINTS AT IS ON SCREEN. State
   * 1 draws nothing while the drawer is open (decided the same day: the drawer
   * says นำเข้าแล้ว 0 จาก 4 ไฟล์ one line lower, which is the same fact with
   * the file picker beside it), and the ยังไม่ได้นำเข้าของบริษัท… line in
   * states 2 and 3 keeps its sentence and loses its button.
   *
   * ⚠ AND IT IS A PROP AND NOT A TERNARY AT THE CALLER. `onOpenImport` reads
   * `{() => setScanOpen(true)}` in components/HrView.jsx and a test pins that
   * literal, for the reason the block over it gives: this button OPENS and does
   * not toggle. What changes here is what this card DRAWS, which is this card's
   * to decide.
   */
  importOpen = false,
  /* `detailOpen` / `onToggleDetail` ถูกถอด 2026-10-08 — ตัวนับอยู่หลัง ▾ ของ
     `NoticeRow` แถวนี้เอง ไม่ได้เปิดพร้อมแจ้งเตือนเดือนอีกแล้ว */
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
  /* ── แถวในกล่องแจ้งเตือนของหน้า — 2026-10-08 ─────────────────────────────

     เคยเป็น `Alert` ที่วาด ⚠/✓ เองพร้อมปุ่ม ดูรายละเอียด ของตัวเองที่เปิดพร้อม
     แจ้งเตือนเดือน · ตอนนี้เป็น `NoticeRow` ใน `NoticeStack` ของหน้า: หัวเรื่องมี
     ตัวเลข ตัวนับหกช่องอยู่หลัง ▾ ของแถว · ชื่อเดือนออกจากหัวเรื่อง เพราะหัวการ์ด
     ข้างบนบอกเดือนอยู่แล้ว ข้อความทุกคำที่ HR ตกลงไว้ 2026-09-07 ยังอยู่ครบ */
  const importBtn = onOpenImport && !importOpen && (
    <button type="button" className="btn ghost sm" onClick={onOpenImport}>
      นำเข้าไฟล์สแกน
    </button>
  );

  if (!punchCount) {
    if (importOpen) return null;
    return (
      <NoticeRow
        tone="info"
        title="ยังไม่ได้เทียบกับไฟล์สแกนนิ้วมือ"
        detail="ไม่ได้แปลว่าทุกแถวตรง · ยืนยันได้ตามปกติ"
        action={importBtn}
      />
    );
  }

  if (!counts) return null;

  const checked = counts.checked || 0;
  const agreed = Math.max(0, checked - (counts.mismatch || 0));

  return (
    <>
      <NoticeRow
        tone={counts.mismatch ? 'warn' : 'ok'}
        title={counts.mismatch > 0
          ? `เทียบไฟล์สแกนแล้ว — ต้องตรวจ ${counts.mismatch} แถว`
          : 'เทียบไฟล์สแกนแล้ว — ทุกแถวที่เทียบได้ตรงกับไฟล์สแกน'}
        detail={counts.mismatch > 0 ? `${flagged} คน จาก ${compare.entryCount} ใบ` : null}
        /* กดแล้วตารางข้างล่างเหลือเฉพาะคนที่ต้องตรวจ — กดซ้ำคือทางกลับ และ
           ล้างตัวกรอง ก็ปล่อยมันด้วย */
        action={onToggleFlagged && flagged > 0 && (
          <button
            type="button"
            className={onlyFlagged ? 'btn ghost sm on' : 'btn ghost sm'}
            onClick={onToggleFlagged}
            aria-pressed={onlyFlagged}
          >
            {onlyFlagged ? 'แสดงทุกคนในเดือนนี้' : `ดูเฉพาะคนที่ต้องตรวจ (${flagged} คน)`}
          </button>
        )}
        more={(
          <div className="scan-tally">
            <span><strong>{counts.short}</strong> {SCAN_BADGE.SHORT}</span>
            <span><strong>{counts.startOff}</strong> {SCAN_BADGE.START_OFF}</span>
            <span><strong>{counts.noScan}</strong> {SCAN_BADGE.NO_SCAN}</span>
            <span className="quiet"><strong>{counts.overTime}</strong> {SCAN_BADGE.OVER}</span>
            <span className="quiet"><strong>{counts.flatDaily}</strong> เหมารายวัน</span>
            <span className="quiet"><strong>{agreed}</strong> ตรง</span>
            <span
              className="quiet"
              title={`${SCAN_BADGE.OVER} และ เหมารายวัน เป็นข้อเท็จจริง ไม่นับเป็นกองที่ต้องตรวจ · ตัวเลขชั่วโมงไม่ได้ถูกแก้จากไฟล์สแกน`}
            >
              {SCAN_BADGE.OVER} และ เหมารายวัน ไม่นับเป็นกองที่ต้องตรวจ
            </span>
          </div>
        )}
      />
      {/* เดือนที่นำเข้าไฟล์ไม่ครบทุกบริษัท — ตัวเลขข้างบนเป็นของครึ่งเดือน จึงต้อง
          บอกว่าครึ่งไหนยังไม่ถูกเทียบ ทั้งตอนเหลืองและตอนเขียว */}
      {notImported.length > 0 && (
        <NoticeRow
          tone="info"
          title={`ยังไม่ได้นำเข้าไฟล์สแกนของ ${notImported.map(companyLabel).join(' และ ')}`}
          detail="แถวของบริษัทนั้นยังไม่ถูกเทียบ และไม่นับในผลเทียบ · ยืนยันได้ตามปกติ"
          action={importBtn}
        />
      )}
    </>
  );
}
