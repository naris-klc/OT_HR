'use client';

import React, { useEffect, useRef, useState } from 'react';
import { api, periodLabel, companyLabel } from '@/lib/api.js';
import { Alert, Disclosure, ShowMore, stamp } from './common.jsx';
import {
  SCAN_FORMATS, SCAN_MAX_BYTES, MIXED_COMPANY, decodeScanText, parseScanFile,
  scanSummary, scanDateRange, periodMismatchNote, formatLabel, machineLabel,
} from '@/lib/scanFile.js';

/**
 * Which of the month's four a batch is, as one phrase — "เครื่องที่ 1 · ไพรมัส".
 *
 * A file that is neither says so instead of being labelled with a guess: the
 * two ways that happens (people from both payrolls in one file, or nobody in it
 * on the roster at all) are the two states somebody has to look at.
 */
function slotName(batch) {
  const machine = machineLabel(batch?.format);
  if (batch?.company === MIXED_COMPANY) return `${machine} · ⚠ ปนสองบริษัท`;
  if (!batch?.company) return `${machine} · ⚠ ไม่รู้บริษัท`;
  return `${machine} · ${companyLabel(batch.company)}`;
}

/**
 * นำเข้าไฟล์สแกนนิ้วมือ (.txt) — the card on ตรวจสอบประจำเดือน, and the only
 * way a scanner's file gets into this system.
 *
 * ── WHY IT IS ON THIS SCREEN AND NOT IN ตั้งค่าระบบ ─────────────────────────
 *
 * Because it is a MONTHLY act and this is the monthly screen. ฝ่ายบุคคล come
 * here at the end of a month with the file in one hand: they read the totals,
 * print the sheets, export the CSV. The roster import and the holiday calendar
 * live under ตั้งค่าระบบ because they are things you set up once and touch when
 * something changes; this is not that. The month picker at the top of this
 * screen is also what the card checks the file against — see `mismatch` below —
 * and a control that needs the month is a control that belongs beside it.
 *
 * ── WHAT PRESSING นำเข้า DOES, IN FULL ──────────────────────────────────────
 *
 * It stores the file and one row per scan, and it changes no figure anywhere.
 * The card says so out loud, every time, in the line under the button: nobody
 * should press this expecting a number on the table above it to move, and the
 * screen that would let them believe otherwise is this one.
 *
 * ── THE PREVIEW IS THE SAME MODULE THE SERVER RUNS ──────────────────────────
 *
 * lib/scanFile.js is pure, so the reading shown here before the upload and the
 * reading stored afterwards come from one piece of code. What is UPLOADED is
 * the file, never this reading — see app/api/scans/import/route.js. The preview
 * exists so that a file from the wrong month, or from a machine configured in
 * English, is caught by the person holding it rather than by whoever queries
 * the collection in six months' time.
 */
export default function ScanImport({
  period,
  /**
   * ── THE MONTH'S SCAN RECORD, HANDED DOWN — 2026-09-10 ────────────────────
   *
   * `{ batches, punchCount, slots, missing, unplaced, compare }`, exactly as
   * app/api/scans/route.js answers it. THIS CARD USED TO FETCH IT ITSELF and
   * stopped on the day the comparison was lifted out of it and onto the screen
   * as a card of its own (components/ScanCompareCard.jsx).
   *
   * TWO CARDS, ONE REQUEST, AND THAT IS THE WHOLE REASON. Left as it was, the
   * screen would ask the same route the same question twice — once for the
   * summary at the top and once again the moment somebody unfolded this panel —
   * and the two answers would be seconds apart, over a collection an import is
   * actively writing to. A card that says `17 แถวต้องตรวจ` above a panel that
   * says a different number is not a rounding error to a reader; it is a screen
   * that cannot be trusted about either.
   *
   * `null` while it is still in flight. Every figure below already had a
   * not-yet-loaded reading (`batches !== null`, `grid &&`), because this card
   * has always drawn before its own request landed.
   */
  scan = null,
  /**
   * นำเข้าสำเร็จแล้ว — ask for the month again.
   *
   * Called rather than reloading here, because what has to be re-read is the
   * whole screen's copy: the summary card above, the คอลัมน์สแกน in the table,
   * and this panel's own checklist are three readings of one import.
   */
  onImported = null,
}) {
  const fileRef = useRef(null);
  /** The chosen file and what this module read in it — never uploaded as-is. */
  const [pending, setPending] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const batches = scan?.batches ?? null;
  const punchCount = scan?.punchCount ?? null;
  /**
   * The month's four expected files and what has filled each — built by the
   * server (see app/api/scans/route.js), never assembled here: the list of
   * payroll entities is the server's, and a grid put together in the browser
   * would be a third statement of who they are.
   */
  const grid = scan?.slots ? { slots: scan.slots, missing: scan.missing, unplaced: scan.unplaced } : null;
  /**
   * The month changing empties this card's OWN state, and that is not tidiness.
   *
   * A preview computed from June's file, still on screen under a heading that
   * now says July, is the exact mistake this card is here to prevent — and the
   * same goes for a result panel reporting an import into a month nobody is
   * looking at any more.
   *
   * IT NO LONGER CLEARS `batches`/`grid`/`compare`, because it no longer owns
   * them: they arrive as `scan` and the screen above replaces them wholesale
   * when the month changes. What is left here is what only this card knows —
   * the file somebody picked and the panel reporting what happened to it.
   */
  useEffect(() => {
    setPending(null);
    setResult(null);
    setError('');
  }, [period]);

  /** Read the file, show what it says. Nothing leaves the browser here. */
  async function choose(event) {
    const file = event.target.files?.[0];
    // Emptied so choosing the SAME file twice fires this again — a browser
    // reports no change otherwise, and re-picking a file is what somebody does
    // after fixing it.
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;

    setResult(null);
    setError('');
    if (file.size > SCAN_MAX_BYTES) {
      setError(`ไฟล์ใหญ่เกิน ${Math.round(SCAN_MAX_BYTES / (1024 * 1024))} MB — ตรวจว่าเลือกไฟล์ .txt จากเครื่องสแกนถูกไฟล์`);
      return;
    }

    try {
      const { text, encoding } = decodeScanText(await file.arrayBuffer());
      const parsed = parseScanFile(text);
      setPending({ file, encoding, parsed, summary: scanSummary(parsed) });
    } catch (e) {
      setError(`อ่านไฟล์ไม่สำเร็จ: ${e.message}`);
    }
  }

  /**
   * Upload the file the preview was read from.
   *
   * A failure KEEPS `pending`, the same call the roster import makes: the
   * preview stays open beside the refusal so the filename in both is the same
   * filename, and ยืนยันนำเข้า is still there for a refusal a retry can beat.
   */
  async function confirm() {
    if (!pending) return;
    setSending(true);
    setError('');
    try {
      const res = await api.upload('/scans/import', pending.file);
      setResult(res);
      setPending(null);
      // The whole screen re-reads the month: this panel's checklist, the
      // summary card above it, and the คอลัมน์สแกน in the table are three
      // readings of the file that just landed.
      onImported?.();
    } catch (e) {
      setError(e.message);
    } finally { setSending(false); }
  }

  const mismatch = pending && periodMismatchNote(pending.summary, period);
  const readable = pending?.summary.punchCount > 0;

  return (
    /* ── A DRAWER IN ตรวจสอบประจำเดือน'S CARD, NOT A CARD OF ITS OWN ─────────
       The root here was a `card no-print` div until 2026-09-11 (written without
       its angle brackets on purpose — a test asserting that markup is gone must
       not find it in the sentence saying so; AGENTS.md counts five of those).
       What changed it is the screenshot HR sent with the words
       *"มันดูแปลกแยกไม่กลมกลืน"* — a second white slab, with its own border and
       its own shadow, parked in the middle of a screen that has one card on it.

       NOTHING INSIDE HERE MOVED. What is gone is the fill, the border, the
       shadow and the radius; `.scan-drawer` puts the same content on
       `--neutral-wash` between two hairlines, which is what a drawer pulled out
       of a card looks like in this app.

       ONE CALLER — components/HrView.jsx, and it renders this INSIDE the panel
       now, between the notices and the filter bar. A drawer with a `.card` root
       nested in a card is the shape this element can no longer be in. */
    <section className="scan-drawer no-print">
      {/* ── ⚠ THE WHOLE HEAD OF THIS DRAWER IS ONE ROW ────────────────

          2026-09-11, twice in one morning. *"ปรับการแสดงผลส่วนนี้ให้กระชับ แต่ยังได้
          รายละเอียดครบถ้วน"* put the heading and its figures on one baseline-aligned
          row — the heading is two words on a line 900px wide, over a line that
          says everything about the drawer. Then: *"ปุ่ม อ่านต่อ สำหรับคำอธิบาย
          ย้ายไปอยู่แถวเดียวกับ หัวข้อ"* — so `Disclosure` came inside this row too,
          and the last line the head spent on itself is a line of the table.

          THE FOLD IS ONE ELEMENT AND HAS TO BE TWO THINGS HERE: a control in the
          row, and a body that is not in it. `display: contents` on its wrapper
          (app/styles.css) hands both children to this flex row, where `order`
          puts อ่านต่อ after the figures and the body on a full-width line of its
          own underneath everything. Same mechanism as the manual card's head.

          IT IS A ROW THAT WRAPS. At 390px the heading, the figures, อ่านต่อ and
          นำเข้าไฟล์สแกน (.txt) break wherever they have to; nothing is shortened
          and nothing is cut. The button takes a 44px line of its own down there
          — it is the one thing in this drawer a finger has to hit. */}
      <div className="scan-drawer-head">
        <div className="scan-head-text">
          <h3 style={{ margin: 0 }}>ไฟล์สแกนนิ้วมือ</h3>
          <div className="hint" style={{ margin: 0 }}>
            {periodLabel(period)}
            {/* HOW MANY OF THE FOUR, NOT HOW MANY FILES. A month brings one file
                per machine per company, so "นำเข้าแล้ว 3 ไฟล์" is a number a
                reader still has to do arithmetic on — and gets wrong the moment
                one slot was imported twice and another not at all, which is
                exactly the case worth catching. The count comes off the grid the
                server built; `batches.length` is the fallback for a month
                answered before the grid existed. */}
            {grid
              /* ⚠ `(ไม่ต้องครบก็ได้)` MOVED UP HERE ON 2026-09-11, out of the
                 four rows below that each carried it as `(ไม่บังคับ)`. It is a
                 fact about the MONTH — HR, 2026-09-04: a machine may not have
                 been emptied, a company may have had nobody on it — so saying
                 it four times, once per empty row, was the same sentence
                 repeated at the reader until it stopped being read. Said once,
                 beside the count it qualifies. */
              ? ` · นำเข้าแล้ว ${grid.slots.length - grid.missing.length} จาก ${grid.slots.length} ไฟล์`
                + ' (ไม่ต้องครบก็ได้)'
                + ` · ${punchCount ?? 0} รายการสแกน`
              /* "จาก 4" IS A MAP, NOT A TARGET. HR said on 2026-09-04 that a
                 month does not have to have all four — a machine may not have
                 been emptied, a company may have had nobody on it. So nothing
                 on this card counts the empty rows as outstanding — the
                 comparison below runs on whatever arrived — and the line above
                 says so in the qualifier beside the count. It was said on each
                 empty row instead until 2026-09-11. */
              : batches !== null && (
                batches.length
                  ? ` · นำเข้าแล้ว ${batches.length} ไฟล์ · ${punchCount ?? 0} รายการสแกน`
                  : ' · ยังไม่มีไฟล์สแกนของเดือนนี้'
              )}
          </div>
        </div>
        {/*
          THE SAME FOLD THE REST OF THE APP USES — 2026-09-07.

          The detail is folded because it is read once, by whoever imports a file
          for the first time, and is furniture on every visit after. That much has
          been true since the card was written; what changed is the control. It
          was a `.btn ghost` reading รายละเอียด, in the header row beside
          นำเข้าไฟล์สแกน — a second button, the same weight as the one that does
          the work, for something that only reads. The rest of the app opens its
          explanations on `Disclosure`, and a card that keeps its own word for the
          gesture is a card somebody has to learn twice.

          THAT LAST SENTENCE IS OWED A DEBT SINCE 2026-09-08. It read "Every other
          explanation in the app now opens on อ่านต่อ", which stopped being true
          the day ทะเบียนพนักงาน — the card next to this one, folding a bullet
          list of the same shape for the same reason — was asked to say
          ดูรายละเอียด instead. So the two whole-body folds on ตั้งค่าระบบ now use
          two words for one gesture, which is the exact thing the sentence above
          warns about, and this card is the one that did not change.

          NOT CHANGED HERE ON ITS OWN. The word for a `lines={0}` fold is a
          decision about all three of them — this card, ทะเบียนพนักงาน and
          นโยบายการคำนวณ's nineteen rows — and `Disclosure`'s own header carries
          the argument for making ดูรายละเอียด the default when nothing is
          clamped. One card changing quietly to match another is how a rule ends
          up existing in two places and agreeing in neither.

          ⚠ THE STYLE IS GONE AND NOT MISLAID. It carried `marginTop: 10` for the
          days this sat under the head as a block of its own; the wrapper is
          `display: contents` now, and a margin on a box that draws nothing is a
          margin nobody applies. The gap above the body is the row's own.
        */}
        <Disclosure as="ul" lines={0} className="hint hint-list" of="ไฟล์สแกนนิ้วมือ">
          {/* ⚠ กระชับขึ้น — 2026-09-11, SAID IN THE SAME BREATH AS THE ROW ABOVE:
              *"ปรับคำอธิบายให้กระชับขึ้น แต่ได้ใจความสำคัญครบถ้วน"*.

              FIVE FACTS STAYED FIVE FACTS — not one bullet was dropped, because
              each one answers a different question somebody has asked out loud:
              does importing move my numbers, how many files is a month, how does
              it know which machine, what happens if I import twice, why are there
              no in/out marks. What went is the second telling of each: the two
              clauses that restated the count line above them, the list of what
              "รายงานทุกใบ" means, and the sentence that named the machine and the
              company in a heading and then again in its own body.

              ONE OF THEM MERGED RATHER THAN SHRANK. *ระบบดูออกเองว่าไฟล์ไหนเป็นของ
              เครื่องไหนบริษัทไหน* was the tail of the สี่ไฟล์ bullet and the
              bullet under it was how it does that — a claim and its own proof,
              one line apart, as two bullets. */}
          <li>
            <strong>ไฟล์นี้ถูกเก็บไว้เฉย ๆ ไม่ทำให้ตัวเลขใดขยับ</strong> — ยอดชั่วโมง
            {' '}ใบขออนุมัติ OT และรายงานทุกใบ ยังคิดจากใบที่ยื่นและเซ็นเหมือนเดิม
          </li>
          <li>
            <strong>เดือนหนึ่งมีได้ถึง {grid ? grid.slots.length : 4} ไฟล์</strong> — สองเครื่อง
            {' '}× ไพรมัสกับเดมเทค · อัปโหลดทีละไฟล์ ลำดับไหนก่อนก็ได้
            {' '}· ไม่ต้องครบก็ได้ ระบบเทียบเท่าที่มี
          </li>
          <li>
            <strong>ระบบดูออกเองว่าไฟล์ไหนเครื่องไหน บริษัทไหน</strong> — เครื่องดูจากรูปแบบบรรทัด
            {' '}({SCAN_FORMATS.map((f) => `${f.short}: ${f.example}`).join('  ·  ')})
            {' '}· บริษัทดูจากทะเบียนพนักงานของคนในไฟล์ ไม่ใช่คำนำหน้ารหัส
          </li>
          <li>
            <strong>นำเข้าไฟล์ใหม่ทับของเดิมได้</strong> — ถ้าเครื่อง บริษัท
            {' '}และวันที่ตรงกับของเดิม ระบบจะ<strong>ลบรายการเดิมช่วงวันนั้นแล้วใช้ไฟล์ใหม่แทน</strong>
            {' '}พร้อมบอกว่าทับไปกี่รายการ · ไฟล์เดิมยังเก็บไว้ · ไฟล์ของอีกเครื่องในวันเดียวกันไม่ถูกแตะ
          </li>
          <li>เครื่องสแกนไม่บอกว่าครั้งไหนเข้า ครั้งไหนออก ระบบจึงเก็บตามที่เครื่องบันทึกมา</li>
        </Disclosure>
        <div className="row" style={{ gap: 8 }}>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>
            นำเข้าไฟล์สแกน (.txt)
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              onChange={choose}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      {error && <div style={{ marginTop: 10 }}><Alert kind="error">{error}</Alert></div>}

      {/* ── what the file says, before it is stored ────────────────────────── */}
      {pending && (
        <div style={{ marginTop: 10 }}>
          <Alert kind={!readable ? 'error' : (mismatch || pending.summary.errorCount ? 'warn' : 'ok')}>
            {/* ── ⚠ FOUR LINES BECAME TWO — 2026-09-11 ──────────────────
                *"ปรับการแสดงผลส่วนนี้ให้กระชับ แต่ยังได้รายละเอียดครบถ้วน"*. It was
                a title line, a figures line, a machine-and-encoding line and a
                skipped-lines line, each a clause long, in a panel that is only
                ever on screen for the few seconds between choosing a file and
                pressing ยืนยัน.

                THE SPLIT IS NOW WHAT THE READER IS CHECKING FOR, not what kind
                of datum each is. **The first line is the file's own account of
                itself** — name, scans, people, dates — which is what somebody
                holding four exports reads to know they picked the right one.
                **The second is how it was read** — machine, encoding, and the
                lines that did not become scans — which only matters when the
                first line looks wrong.

                `บรรทัด` MOVED DOWN THERE and is no longer always printed. It
                was beside the filename, one number over from `รายการสแกน`, and
                the two differ only by the header lines a scanner writes; two
                near-identical figures at the top of a panel is a subtraction
                nobody asked the reader to do. It is on the second line now,
                where the skipped count that explains the difference is. */}
            <div className="scan-line">
              <span>
                <strong>ตรวจก่อนนำเข้า</strong> — {pending.file.name}
                {readable && (
                  <>
                    {' · '}<strong>{pending.summary.punchCount}</strong> รายการสแกน ·
                    {' '}<strong>{pending.summary.peopleCount}</strong> คน ·
                    {' '}{scanDateRange(pending.summary)}
                  </>
                )}
              </span>
              {/* THE TWO BUTTONS COME UP ONTO THIS ROW rather than taking a
                  fourth line of their own. `.scan-line` is the same row
                  ผลเทียบ's first state uses — one sentence, its control on the
                  right — and below 640px it hands both of them the full width
                  at 44px, which is the stylesheet's rule and not this panel's. */}
              <span className="row" style={{ gap: 8 }}>
                <button className="btn" disabled={!readable || sending} onClick={confirm}>
                  {sending ? 'กำลังนำเข้า…' : 'ยืนยันนำเข้า'}
                </button>
                <button className="btn ghost" disabled={sending} onClick={() => setPending(null)}>
                  ยกเลิก
                </button>
              </span>
            </div>

            {!readable ? (
              <div style={{ marginTop: 6 }}>
                ไฟล์นี้ไม่มีบรรทัดที่อ่านเป็นการสแกนได้เลย — ตรวจว่าเป็นไฟล์ .txt
                {' '}ที่ส่งออกจากเครื่องสแกนนิ้วมือหรือไม่
              </div>
            ) : (
              <div className="hint" style={{ margin: '4px 0 0' }}>
                {formatLabel(pending.summary.format)} · อ่านเป็น {pending.encoding}
                {' · '}{pending.summary.lineCount} บรรทัด
                {/* Every line that did not become a scan, counted — and the
                    first few of them quoted below, because "3 บรรทัดถูกข้าม" is
                    a number somebody has to open the file to check, while the
                    header line printed here answers itself. */}
                {pending.summary.skippedCount > 0
                  && ` · ข้าม ${pending.summary.skippedCount} บรรทัดที่ไม่ใช่การสแกน (เช่น หัวไฟล์)`}
                {pending.summary.errorCount > 0
                  && ` · อ่านไม่ออก ${pending.summary.errorCount} บรรทัด`}
                {pending.summary.duplicateCount > 0
                  && ` · ซ้ำกันเองในไฟล์ ${pending.summary.duplicateCount} บรรทัด`}
              </div>
            )}

            {/* The month check, and it is a warning rather than a refusal: a
                shift starting on the 31st is scanned out on the 1st, so a file
                that spills into the next month is ordinary. */}
            {mismatch && <div style={{ marginTop: 6 }}><strong>{mismatch}</strong></div>}

            {pending.parsed.errors.length > 0 && (
              <ShowMore
                as="ul"
                style={{ marginTop: 6, marginLeft: 18 }}
                items={pending.parsed.errors}
                unit="บรรทัด"
                render={(e) => <li key={e.line}>บรรทัด {e.line}: “{e.text}” — {e.error}</li>}
              />
            )}
          </Alert>
        </div>
      )}

      {/* ── what was stored ────────────────────────────────────────────────── */}
      {result && (
        <div style={{ marginTop: 10 }}>
          <Alert
            kind={(!result.company || result.company === MIXED_COMPANY) ? 'warn'
              : (result.unknownCodes?.length ? 'warn' : 'ok')}
            onClose={() => setResult(null)}
          >
            <strong>นำเข้าแล้ว</strong> — {result.batch.filename} ·
            {' '}เพิ่มใหม่ <strong>{result.inserted}</strong> รายการ
            {result.already > 0 && ` · มีอยู่แล้ว ${result.already} รายการ`}

            {/* WHICH OF THE FOUR IT TURNED OUT TO BE, on its own line and never
                folded. HR pressed this holding one of four files; the first
                thing to tell them is which one the system decided it was, so a
                file exported from the wrong menu is caught here rather than by
                a slot that never fills. */}
            <div style={{ marginTop: 6 }}>
              <strong>{slotName(result.batch)}</strong>
              {result.companyCounts?.length > 1 && (
                <span className="hint">
                  {' '}— {result.companyCounts
                    .map((c) => `${companyLabel(c.company)} ${c.punches}`)
                    .join(' · ')}
                </span>
              )}
            </div>

            {/* The two verdicts that fill no slot, each said as what it is. */}
            {result.company === MIXED_COMPANY && (
              <div style={{ marginTop: 6 }}>
                คนในไฟล์นี้อยู่กันคนละบริษัท ซึ่งไม่ตรงกับที่ตกลงไว้ว่าหนึ่งไฟล์คือหนึ่งบริษัท —
                {' '}เก็บไว้แล้วครบทุกแถว แต่ยังไม่นับว่าเติมช่องไหนของเดือนนี้
                {' '}· ตรวจว่าส่งออกจากเมนูถูกหรือไม่ ถ้าถูกแล้วแปลว่าเครื่องนี้ใช้ร่วมกันสองบริษัท ให้บอกมา
              </div>
            )}
            {!result.company && (
              <div style={{ marginTop: 6 }}>
                ไม่มีรหัสไหนในไฟล์นี้ตรงกับใครในทะเบียนพนักงานเลย จึงบอกไม่ได้ว่าเป็นไฟล์ของบริษัทไหน —
                {' '}เก็บไว้แล้ว แต่ยังไม่นับว่าเติมช่องไหนของเดือนนี้
              </div>
            )}

            {/* WHAT THIS IMPORT DELETED, AND IT IS NEVER FOLDED AWAY.
                A file over the same machine, company and dates replaces the
                earlier one (HR, 2026-09-04). A replace that shows up only as a
                larger insert count is a deletion nobody can see — so the files
                that were taken over are named, with the number of rows that
                went, in the panel that reports the import. */}
            {result.replaces?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <strong>ทับไฟล์เดิมของช่องนี้แล้ว</strong> — ลบรายการเดิมออก
                {' '}<strong>{result.replacedPunchCount}</strong> รายการ
                {' '}(ช่วง {scanDateRange(result.batch)})
                <div className="hint" style={{ margin: '4px 0 0' }}>
                  {result.replaces
                    .map((r) => `“${r.filename}” (${r.punches} รายการ)`)
                    .join(' · ')}
                  {' '}· ตัวไฟล์เดิมยังเก็บไว้ในระบบ ที่ถูกแทนคือรายการสแกนในช่วงวันนี้
                </div>
              </div>
            )}

            {/* The re-import case, said as what it is. An insert count of zero
                with no explanation beside it reads as a failure. */}
            {result.previousImport && (
              <div className="hint" style={{ margin: '4px 0 0' }}>
                ไฟล์นี้มีเนื้อหาเหมือนกับ “{result.previousImport.filename}” ที่นำเข้าไว้เมื่อ
                {' '}{stamp(result.previousImport.at)}
              </div>
            )}

            {/* NOT AN ERROR. A machine holds fingers of people who have left and
                of whoever was hired since the last roster edit — but it is the
                one number worth looking at after an import, so it is never
                folded away. */}
            {result.unknownCodes?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                มี {result.unknownCodes.length} รหัสในไฟล์ที่ไม่ตรงกับใครในทะเบียนพนักงาน —
                {' '}เก็บไว้แล้วตามที่เครื่องบันทึกมา แต่ควรตรวจว่าเป็นคนที่ลาออกไปแล้ว
                {' '}หรือเป็นคนที่ยังไม่ได้เพิ่มเข้าทะเบียน
                {/* Twelve before anything is held back, as it always was —
                    a row of codes is short — and the rest on request since
                    2026-09-10 rather than a "…และอีก N รหัส" nobody could open. */}
                <ShowMore
                  className="hint"
                  style={{ margin: '4px 0 0' }}
                  items={result.unknownCodes}
                  first={12}
                  unit="รหัส"
                  join=" · "
                  render={(c) => c}
                />
              </div>
            )}
          </Alert>
        </div>
      )}

      {/* ── ผลเทียบ MOVED OUT OF THIS CARD ON 2026-09-10 ──────────────────

          It stood here — the month's counts and the flagged people named, up to
          twelve of them — from the day the comparison shipped. It was in the
          right place for exactly as long as this card could not fold.

          WHAT BROKE IT WAS THE FOLD, NOT THE CONTENT. `scanOpen` opens `false`
          on every visit now, which is right for นำเข้าไฟล์ — a once-a-month
          deed — and wrong for the answer to *"is this month safe to sign"*,
          which every reader of this tab needs before they trust a total. A fact
          that is two presses away is a fact the screen does not state.

          ot-hardening-and-slips CAME AT THE SAME LIST FROM THE OTHER SIDE, and
          the two met here the same evening: it gave the twelve names a
          `ShowMore`, so the rest were one press away instead of a "…และอีก N คน"
          nobody could open. That is a better list — and a list is the thing the
          move decided against. คอลัมน์สแกน on every row and ดูเฉพาะคนที่ต้องตรวจ
          answer the same need without asking a reader to match names off a card
          by eye. Its `ShowMore` over `result.unknownCodes` above IS kept: a row
          of codes has nowhere else to be.

          So the two were split along the line between a DEED and a FACT, and
          the fact went up to components/ScanCompareCard.jsx, above everything
          pressable, beside `MonthAlerts`. THE COMPARISON IS NOT DIMINISHED BY
          THE MOVE — it gained the คอลัมน์สแกน on every row of the table and a
          filter that stands the reader in front of the pile, neither of which a
          twelve-name list inside a folded panel could do.

          THE REQUEST IS STILL ONE REQUEST. `compare` arrives in `scan` with
          everything else this card draws; nothing was added to pay for the move
          — see the note over the prop. */}

      {/* ── the month's four, and which are still missing ──────────────────── */}
      {/*
        A CHECKLIST AND NOT A LIST OF UPLOADS, and the difference is the whole
        point of this block. The flat list this replaces answered "what have I
        imported"; the question somebody standing in front of four exported
        files actually has is **"which one am I still missing"**, and a list of
        three rows does not answer it — the reader has to hold the expected four
        in their head and subtract. A month where one slot was imported twice and
        another not at all reads as "3 ไฟล์" either way, which is exactly the
        case the checklist makes impossible to miss.

        The rows are built by the SERVER (`slots`), because the list of payroll
        entities is the server's; `lib/api.js` mirrors it for the client on
        purpose and a grid assembled here would be a third statement of it.

        `○` AND NOT A RED MARK for a slot with nothing in it. A month in
        progress is the ordinary state of this card — HR upload four files one
        at a time, and three empty rows halfway through the job are not three
        problems. What IS marked is a file that arrived and fits nowhere.
      */}
      {grid && (
        <div style={{ marginTop: 10 }}>
          {/* ── ⚠ TWO COLUMNS, BECAUSE THE THING IT DESCRIBES IS A GRID ──────
              *"ใช้พื้นที่อย่างคุ้มค่าที่สุด"*, 2026-09-11. Four stacked rows down the
              left of a drawer 900px wide spent four lines and about a fifth of
              the width. The thing they describe IS a grid — two machines × two
              companies — so two columns is both half the height and the shape
              of the fact. One column again below 640px, where two would be two
              half-sentences.

              WHAT IT SAYS IS UNCHANGED. `○` for an empty slot and not a red
              mark — a month in progress is the ordinary state of this drawer —
              and every figure a filled slot carried it still carries. What left
              each empty row is `(ไม่บังคับ)`, which is a fact about the month
              and is now said once, beside the count in the head. */}
          <div className="scan-slots">
            {grid.slots.map((s) => (
              <div key={`${s.format}|${s.company}`} className="hint scan-slot">
              {s.batch ? '✓' : '○'} <strong>{s.machineLabel} · {companyLabel(s.company)}</strong>
              {s.batch ? (
                <>
                  {' '}— {s.batch.filename} · {scanDateRange(s.batch)} ·
                  {' '}{s.batch.punchCount} รายการ · {s.batch.peopleCount} คน
                  {/* THE FILE NAMED HERE IS THE LIVE ONE — `buildScanSlots` takes
                      the newest, because a later import over the same dates
                      deleted the earlier one's rows. Saying how many were
                      replaced is what keeps "นำเข้า 3 ครั้ง" from reading as
                      three files' worth of data sitting in the slot. */}
                  {s.imports > 1 && ` · นำเข้า ${s.imports} ครั้ง`}
                  {s.superseded > 0 && ` (ทับไฟล์เดิมไปแล้ว ${s.superseded} ไฟล์)`}
                  <br />
                  {'\u00a0\u00a0'}นำเข้าโดย {s.batch.importedByName || '—'} เมื่อ {stamp(s.batch.createdAt)}
                  {s.batch.unknownCodes?.length > 0
                    && ` · ${s.batch.unknownCodes.length} รหัสไม่อยู่ในทะเบียน`}
                </>
              ) : ' — ยังไม่ได้นำเข้า'}
              </div>
            ))}
          </div>

          {/* Imported and one of the four it is not. `buildScanSlots` refuses to
              count these into a slot, so this is the only place they appear —
              under a heading that says why they are standing apart. */}
          {grid.unplaced?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="hint"><strong>ไฟล์ที่ยังจัดเข้าช่องไหนไม่ได้</strong></div>
              {grid.unplaced.map((b) => (
                <div key={b._id} className="hint" style={{ margin: '4px 0 0' }}>
                  ⚠ <strong>{b.filename}</strong> — {slotName(b)} · {scanDateRange(b)} ·
                  {' '}{b.punchCount} รายการ · {b.peopleCount} คน
                  <br />
                  {'\u00a0\u00a0'}นำเข้าโดย {b.importedByName || '—'} เมื่อ {stamp(b.createdAt)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The flat list, kept for the one case the grid cannot answer: a month
          whose batches were imported before `company` existed on them, where
          every row would otherwise be ⚠ ไม่รู้บริษัท and the card would say
          nothing about files that are plainly there. */}
      {!grid && batches !== null && batches.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {batches.map((b) => (
            <div key={b._id} className="hint" style={{ margin: '4px 0 0' }}>
              · <strong>{b.filename}</strong> — {scanDateRange(b)} ·
              {' '}{b.punchCount} รายการ ({b.insertedCount} ใหม่) · {b.peopleCount} คน ·
              {' '}{formatLabel(b.format)}
              <br />
              {'\u00a0\u00a0'}นำเข้าโดย {b.importedByName || '—'} เมื่อ {stamp(b.createdAt)}
              {b.unknownCodes?.length > 0 && ` · ${b.unknownCodes.length} รหัสไม่อยู่ในทะเบียน`}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
