'use client';

import React, { useEffect, useRef, useState } from 'react';
import { api, periodLabel, companyLabel } from '@/lib/api.js';
import { Alert, stamp } from './common.jsx';
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
export default function ScanImport({ period, status = 'approved' }) {
  const fileRef = useRef(null);
  /** The chosen file and what this module read in it — never uploaded as-is. */
  const [pending, setPending] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [batches, setBatches] = useState(null);
  const [punchCount, setPunchCount] = useState(null);
  /**
   * The month's four expected files and what has filled each — built by the
   * server (see app/api/scans/route.js), never assembled here: the list of
   * payroll entities is the server's, and a grid put together in the browser
   * would be a third statement of who they are.
   */
  const [grid, setGrid] = useState(null);
  /**
   * The month's ใบ OT read against the punches — counts, and the people who
   * have something to look at.
   *
   * THE ANSWER TO "แล้วจะดูการเปรียบเทียบตรงไหน". The marks are on the rows,
   * which are one click deep inside ดู / แก้ไขรายการ for one person; nothing on
   * this screen moved when a file was imported, so without this the comparison
   * was a feature that could only be found by somebody who already knew it was
   * there. The card names the people; the table below is how you reach them.
   */
  const [compare, setCompare] = useState(null);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      /**
       * `compare=1` only when this month HAS scans. On a month with no import
       * there is nothing to compare against and the expensive half of the route
       * would be paid for an answer of all zeroes — and `punchCount` is on the
       * cheap half, so the first load of an empty month asks for neither.
       */
      const first = await api.get(`/scans?period=${period}`);
      const data = first.punchCount
        ? await api.get(`/scans?period=${period}&compare=1&status=${encodeURIComponent(status)}`)
        : first;
      setBatches(data.batches || []);
      setPunchCount(data.punchCount ?? null);
      setCompare(data.compare || null);
      setGrid(data.slots ? { slots: data.slots, missing: data.missing, unplaced: data.unplaced } : null);
    } catch (e) {
      // A list that will not load is not a reason to hide the button: importing
      // still works, and the refusal is shown where it happened.
      setBatches([]);
      setError(e.message);
    }
  }

  /**
   * The month changing empties everything, and that is not tidiness.
   *
   * A preview computed from June's file, still on screen under a heading that
   * now says July, is the exact mistake this card is here to prevent — and the
   * same goes for a result panel reporting an import into a month nobody is
   * looking at any more.
   */
  useEffect(() => {
    setPending(null);
    setResult(null);
    setError('');
    setBatches(null);
    setGrid(null);
    setCompare(null);
    load();
  }, [period, status]);

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
      load();
    } catch (e) {
      setError(e.message);
    } finally { setSending(false); }
  }

  const mismatch = pending && periodMismatchNote(pending.summary, period);
  const readable = pending?.summary.punchCount > 0;

  return (
    <div className="card no-print">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0 }}>ไฟล์สแกนนิ้วมือ</h3>
          <div className="hint" style={{ margin: '2px 0 0' }}>
            {periodLabel(period)}
            {/* HOW MANY OF THE FOUR, NOT HOW MANY FILES. A month brings one file
                per machine per company, so "นำเข้าแล้ว 3 ไฟล์" is a number a
                reader still has to do arithmetic on — and gets wrong the moment
                one slot was imported twice and another not at all, which is
                exactly the case worth catching. The count comes off the grid the
                server built; `batches.length` is the fallback for a month
                answered before the grid existed. */}
            {grid
              ? ` · นำเข้าแล้ว ${grid.slots.length - grid.missing.length} จาก ${grid.slots.length} ไฟล์`
                + ` · ${punchCount ?? 0} รายการสแกน`
              /* "จาก 4" IS A MAP, NOT A TARGET. HR said on 2026-09-04 that a
                 month does not have to have all four — a machine may not have
                 been emptied, a company may have had nobody on it. So the empty
                 rows read ยังไม่ได้นำเข้า (ไม่บังคับ) and nothing on this card
                 counts them as outstanding: the comparison below runs on
                 whatever arrived. */
              : batches !== null && (
                batches.length
                  ? ` · นำเข้าแล้ว ${batches.length} ไฟล์ · ${punchCount ?? 0} รายการสแกน`
                  : ' · ยังไม่มีไฟล์สแกนของเดือนนี้'
              )}
          </div>
        </div>
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
          {/* The detail is folded because it is read once, by whoever imports a
              file for the first time, and is furniture on every visit after. */}
          <button className="btn ghost" onClick={() => setOpen((v) => !v)}>
            {open ? 'ซ่อนรายละเอียด' : 'รายละเอียด'}
          </button>
        </div>
      </div>

      {open && (
        <ul className="hint hint-list" style={{ marginTop: 10 }}>
          <li>
            <strong>ไฟล์นี้ถูกเก็บไว้เฉย ๆ</strong> — ยอดชั่วโมง ใบขออนุมัติ OT
            {' '}และรายงานทุกใบยังคิดจากใบที่ยื่นและเซ็นเหมือนเดิม การนำเข้าไม่ทำให้ตัวเลขใดขยับ
          </li>
          <li>
            <strong>เดือนหนึ่งมีได้ถึง {grid ? grid.slots.length : 4} ไฟล์</strong> — เครื่องละสองไฟล์ แยกไพรมัสกับเดมเทค
            {' '}· อัปโหลดทีละไฟล์ ลำดับไหนก่อนก็ได้ ระบบดูออกเองว่าไฟล์ไหนเป็นของเครื่องไหนบริษัทไหน
            {' '}· <strong>ไม่ต้องนำเข้าครบทุกไฟล์ก็ได้</strong> ระบบเทียบเท่าที่มี
          </li>
          <li>
            <strong>เครื่องไหน</strong> ดูจากรูปแบบบรรทัดในไฟล์ —
            {' '}{SCAN_FORMATS.map((f) => `${f.short}: ${f.example}`).join('  ·  ')}
            {' '}· <strong>บริษัทไหน</strong> ดูจากทะเบียนพนักงานของคนในไฟล์ ไม่ได้ดูจากคำนำหน้ารหัส
          </li>
          <li>
            <strong>นำเข้าไฟล์ใหม่ทับของเดิมได้</strong> — ถ้าเป็นเครื่องเดียวกัน บริษัทเดียวกัน
            {' '}และวันที่ซ้ำกัน ระบบจะ<strong>ลบรายการเดิมในช่วงวันนั้นออกแล้วใช้ไฟล์ใหม่แทน</strong>
            {' '}พร้อมบอกว่าทับไฟล์ไหนไปกี่รายการ · ตัวไฟล์เดิมยังเก็บไว้ในระบบ
            {' '}· ทับเฉพาะเครื่องและบริษัทเดียวกัน ไฟล์ของอีกเครื่องในวันเดียวกันไม่ถูกแตะ
          </li>
          <li>
            เครื่องสแกนไม่ได้บอกว่าครั้งไหนคือเข้าและครั้งไหนคือออก ระบบจึงเก็บไว้ตามที่เครื่องบันทึกมา
          </li>
        </ul>
      )}

      {error && <div style={{ marginTop: 10 }}><Alert kind="error">{error}</Alert></div>}

      {/* ── what the file says, before it is stored ────────────────────────── */}
      {pending && (
        <div style={{ marginTop: 10 }}>
          <Alert kind={!readable ? 'error' : (mismatch || pending.summary.errorCount ? 'warn' : 'ok')}>
            <strong>ตรวจก่อนนำเข้า</strong> — {pending.file.name}
            {' · '}{pending.summary.lineCount} บรรทัด

            {!readable ? (
              <div style={{ marginTop: 6 }}>
                ไฟล์นี้ไม่มีบรรทัดที่อ่านเป็นการสแกนได้เลย — ตรวจว่าเป็นไฟล์ .txt
                {' '}ที่ส่งออกจากเครื่องสแกนนิ้วมือหรือไม่
              </div>
            ) : (
              <>
                <div style={{ marginTop: 6 }}>
                  <strong>{pending.summary.punchCount}</strong> รายการสแกน ·
                  {' '}<strong>{pending.summary.peopleCount}</strong> คน ·
                  {' '}{scanDateRange(pending.summary)}
                </div>
                <div className="hint" style={{ margin: '4px 0 0' }}>
                  {formatLabel(pending.summary.format)} · อ่านเป็น {pending.encoding}
                </div>
              </>
            )}

            {/* The month check, and it is a warning rather than a refusal: a
                shift starting on the 31st is scanned out on the 1st, so a file
                that spills into the next month is ordinary. */}
            {mismatch && <div style={{ marginTop: 6 }}><strong>{mismatch}</strong></div>}

            {/* Every line that did not become a scan, counted — and the first
                few of them quoted, because "3 บรรทัดถูกข้าม" is a number
                somebody has to open the file to check, while the header line
                printed here answers itself. */}
            {(pending.summary.skippedCount > 0 || pending.summary.errorCount > 0
              || pending.summary.duplicateCount > 0) && (
              <div className="hint" style={{ margin: '6px 0 0' }}>
                {pending.summary.skippedCount > 0
                  && `ข้าม ${pending.summary.skippedCount} บรรทัดที่ไม่ใช่การสแกน (เช่น หัวไฟล์) `}
                {pending.summary.errorCount > 0
                  && `· อ่านไม่ออก ${pending.summary.errorCount} บรรทัด `}
                {pending.summary.duplicateCount > 0
                  && `· ซ้ำกันเองในไฟล์ ${pending.summary.duplicateCount} บรรทัด`}
              </div>
            )}
            {pending.parsed.errors.length > 0 && (
              <ul style={{ marginTop: 6, marginLeft: 18 }}>
                {pending.parsed.errors.slice(0, 5).map((e) => (
                  <li key={e.line}>บรรทัด {e.line}: “{e.text}” — {e.error}</li>
                ))}
              </ul>
            )}

            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button className="btn" disabled={!readable || sending} onClick={confirm}>
                {sending ? 'กำลังนำเข้า…' : 'ยืนยันนำเข้า'}
              </button>
              <button className="btn ghost" disabled={sending} onClick={() => setPending(null)}>
                ยกเลิก
              </button>
            </div>
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
                <div className="hint" style={{ margin: '4px 0 0' }}>
                  {result.unknownCodes.slice(0, 12).join(' · ')}
                  {result.unknownCodes.length > 12 && ` … และอีก ${result.unknownCodes.length - 12} รหัส`}
                </div>
              </div>
            )}
          </Alert>
        </div>
      )}

      {/* ── ผลเทียบกับใบ OT ของเดือนนี้ — the answer to "ดูตรงไหน" ─────────── */}
      {/*
        WITHOUT THIS BLOCK THE COMPARISON IS INVISIBLE. The marks are on the
        rows, and the rows are one click deep — inside ดู / แก้ไขรายการ for ONE
        person. HR import a file here and nothing on this screen moves, so the
        only way to reach a warning was to already know it was there and open
        people one at a time. On a roster of a hundred and sixty that is not a
        thing anybody does, and the feature would have been built and unread.

        So: the counts for the month, and THE PEOPLE NAMED. The card says who;
        the table below this card is how you get to them. That pair is the whole
        design — this block deliberately does not link anywhere, because the
        control that opens a person is the one already on their row and a second
        way in would be two controls for one act.
      */}
      {compare && (
        <div style={{ marginTop: 10 }}>
          <Alert kind={compare.counts.mismatch ? 'warn' : 'ok'} mark={false}>
            <strong>ผลเทียบกับใบ OT ของเดือนนี้</strong>
            <span className="hint">{' '}({compare.entryCount} ใบ · ตาม “สถานะที่นับ” ที่เลือกไว้ด้านบน)</span>
            {/* THE SAME FOUR WORDS AS ตรวจสอบรายเดือน, in the same order —
                HR's own vocabulary of 2026-09-07. Two screens naming one
                comparison differently is how a reader ends up believing they
                are two comparisons. */}
            <div style={{ marginTop: 6 }}>
              <strong>{compare.counts.short}</strong> แถวไม่ครบ ·
              {' '}<strong>{compare.counts.startOff}</strong> แถวเวลาเริ่มไม่ตรง ·
              {' '}<strong>{compare.counts.noScan}</strong> แถวไม่ตรง (ไม่มีสแกนนิ้ว) ·
              {' '}<strong>{compare.counts.overTime}</strong> แถวเกินเวลา ·
              {' '}<strong>{compare.counts.flatDaily}</strong> แถวเป็นใบเหมารายวัน
            </div>

            {compare.people.length > 0 ? (
              <>
                {/* NAMES, NOT A NUMBER — this is the line that turns "this month
                    has three mismatches" into somewhere to go. Capped at twelve
                    because a card is not a report; past that the count above is
                    the honest summary and the table below is the way through. */}
                <div style={{ marginTop: 6 }}>
                  ดูได้ที่ปุ่ม <strong>ดู / แก้ไขรายการ</strong> ของคนเหล่านี้ในตารางด้านล่าง —
                  {' '}แถวที่ไม่ตรงจะมีป้ายกำกับไว้ในช่อง จาก–ถึง
                </div>
                <div className="hint" style={{ margin: '4px 0 0' }}>
                  {compare.people.slice(0, 12).map((p) => (
                    `${p.name || p.code}${p.code ? ` (${p.code})` : ''}`
                    + ` — ${[
                      p.mismatch ? `เวลาไม่ตรง ${p.mismatch}` : null,
                      p.noScan ? `ไม่มีสแกน ${p.noScan}` : null,
                    ].filter(Boolean).join(' · ')}`
                  )).join('  ·  ')}
                  {compare.people.length > 12 && `  …และอีก ${compare.people.length - 12} คน`}
                </div>
              </>
            ) : (
              <div className="hint" style={{ margin: '6px 0 0' }}>
                ทุกแถวที่เทียบได้ตรงกับไฟล์สแกน — ไม่มีใครต้องตรวจเพิ่ม
              </div>
            )}

            {/* Said on the card as well as on the row, because this is the
                sentence somebody might otherwise take the numbers above to mean. */}
            <div className="hint" style={{ margin: '6px 0 0' }}>
              <strong>ตัวเลขชั่วโมงไม่ได้ถูกแก้จากไฟล์สแกน</strong> — นี่เป็นการชี้ให้ดู
              {' '}ไม่ใช่การคิดใหม่ · ใบเหมารายวันไม่นับเป็นเวลาไม่ตรง
            </div>
          </Alert>
        </div>
      )}

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
          {grid.slots.map((s) => (
            <div key={`${s.format}|${s.company}`} className="hint" style={{ margin: '4px 0 0' }}>
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
              ) : ' — ยังไม่ได้นำเข้า (ไม่บังคับ)'}
            </div>
          ))}

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
    </div>
  );
}
