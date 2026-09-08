'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, firstName, BUCKETS } from '@/lib/api.js';
import { printName } from '@/lib/printFile.js';
import { formPrintStatuses, FORM_PRINT_SCOPE_SAY } from '@/lib/reports.js';
import { Alert, PrintChrome, SheetScroll } from './common.jsx';

/**
 * The query string one sheet is asked for with — whose month, and สถานะที่นับ
 * as the screen has it set.
 *
 * ONE FUNCTION FOR BOTH PATHS. A sheet printed on its own and the same sheet
 * inside a bundle have to be the same request, or the bundle stops being the
 * document it says it is — and "same route, different parameters" is the way
 * that happens quietly. Both callers build their URL here.
 *
 * What the status parameter is WORTH is not decided here and cannot be: the
 * route weighs it against `formPrintScope` and ignores it under three of the
 * four answers (see `formPrintStatuses` in lib/reports.js). This is a screen
 * saying what it is looking at, never a screen choosing what may be printed.
 */
export function sheetQuery({ employeeId = '', status = '' } = {}) {
  const parts = [];
  if (employeeId) parts.push(`employee=${employeeId}`);
  if (status) parts.push(`status=${encodeURIComponent(status)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * F-HR-027 Rev.4 rendered for print — one employee, one month (§10).
 *
 * The layout follows the paper form cell for cell: วันที่ 1–31 down the left,
 * เวลาทำ OT (จาก/ถึง), the three จำนวนชั่วโมง columns, รายละเอียดงานที่ทำ, and
 * two ลงชื่อ columns.
 *
 * THE TWO ลงชื่อ COLUMNS ARE FILLED IN, and read "stayed empty for hand
 * signing" until 2026-09-02. HR asked for the names to be printed and asked for
 * them AS the signature — the sheet is not signed by hand after it comes off
 * the printer. Nothing new is recorded to do it: `byName` on the entry's own
 * history rows is what prints, so the paper says exactly what การอนุมัติ in the
 * pop-up says, from the same rows. See `Signed` at the foot of this file and
 * `managerSignature` in lib/approverLine.js.
 *
 * The เฉพาะฝ่ายบุคคล box at the foot is NOT one of the two. It is a rule to
 * sign by hand, it stayed as it was, and a name in the ลงชื่อหัวหน้างาน column
 * never fills it in — that box is the SECOND signature on an entry that has
 * two. Since 2026-09-07 the ลงชื่อหัวหน้างาน column can carry a ฝ่ายบุคคล name
 * even so, on the rows that reach อนุมัติ with no หัวหน้า step to sign at all.
 *
 * Rows come from the server already segmented, so a session that ran from
 * Friday evening into Saturday morning appears on both dates with its hours in
 * the correct column. That is the whole reason the paper form has three hour
 * columns rather than one.
 *
 * The sheet, the notices above it and the bar above those are three exported
 * parts rather than one block, because the whole month prints as one document
 * too — see components/PrintFormBatch.jsx. One person's sheet and one of forty
 * are then the same element and cannot drift apart, which matters more here
 * than anywhere else in the app: this is a controlled form, and a bundle whose
 * pages were laid out by a second copy of this markup would be a second form.
 *
 * `status` is สถานะที่นับ as the caller has it set, passed through untouched and
 * decided by the route. Absent — a พนักงาน printing their own month — the route
 * answers with the strict list under every `formPrintScope` setting, which is
 * the right way for a missing filter to be wrong on a sheet that gets signed.
 */
export default function PrintForm({ employeeId, period, status = '', onClose }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/reports/form/${period}${sheetQuery({ employeeId, status })}`)
      .then((res) => setForm(res.form))
      .catch((err) => setError(err.message));
  }, [employeeId, period, status]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!form) return <div className="empty">กำลังโหลด…</div>;

  return (
    <>
      <PrintChrome
        onClose={onClose}
        filename={printName.form({ code: form.employee.code, period })}
        {...f027Chrome(form)}
      />
      <FormNotices form={form} asked={status} />
      <SheetScroll className="f027-screen">
        <F027Sheet form={form} />
      </SheetScroll>
    </>
  );
}

/**
 * What PrintChrome (components/common.jsx) has to be told about an F-HR-027 —
 * the yellow band the “กราฟิกพื้นหลัง” box carries, and what the ฝ่ายบุคคล
 * column on this print means.
 *
 * ONE FUNCTION FOR BOTH PATHS, for the same reason `sheetQuery` above is one:
 * a sheet printed alone and the same sheet inside a bundle must say the same
 * thing about its own figures. `form` is undefined until the first sheet of a
 * bundle lands, and the basis line is then left out rather than guessed at —
 * the wrong answer sits above a signed document for as long as the paper lasts.
 *
 * It is the `footer` and not a bullet: it is not a printer setting and nobody
 * acts on it. It is what the column MEANS, read off the paper afterwards by
 * whoever is checking the figures.
 */
export function f027Chrome(form) {
  const basis = form?.hrSection.basis;
  return {
    graphics: 'แถบสีเหลือง',
    footer: basis && `ช่องเฉพาะฝ่ายบุคคล: ${basis === 'multiplied'
      ? 'คูณอัตราแล้ว'
      : 'เป็นชั่วโมงดิบ ยังไม่คูณอัตรา'}`,
  };
}

/**
 * The screen asked for rows the policy would not print — so an ordinary print
 * says nothing, and the one print whose total will not match the table it was
 * pressed from explains itself.
 *
 * ASKED OF `formPrintStatuses` RATHER THAN OF THE SCOPE'S NAME, since
 * 2026-09-07. It read `printScope === 'approved'` against the literal
 * `'approved'`, which was the whole table while the strict answer was the only
 * one that ignored `?status=` and printed one status. With ตั้งแต่หัวหน้าอนุมัติ
 * shipping — two statuses, `?status=` ignored just the same — that spelling
 * answers `false` on every sheet it was written for, and a print narrowed from
 * a wide สถานะที่นับ would go back to being silent about it.
 *
 * The pure resolver is the rule and it is one import away, so the question is
 * put to it: what would this policy print, and did the screen ask for anything
 * outside that. A second reading of the table in a component is exactly how the
 * paper and the route came to disagree in the first place.
 *
 * Exported because the bundle asks it of forty sheets at once and answers for
 * the whole document rather than one page (see components/PrintFormBatch.jsx).
 * The answer is the same for every sheet in one printing — `printScope` is
 * policy and `asked` is the screen — but "the same question, read twice, in
 * two files" is how the two stop agreeing.
 */
export function narrowedByPolicy(form, asked = '') {
  const { scope, statuses } = formPrintStatuses({ formPrintScope: form?.printScope }, asked);
  if (scope === 'screen') return false;
  return String(asked).split(',').some((s) => s.trim() && !statuses.includes(s.trim()));
}

/**
 * What this month has that the paper does not — said on the screen, never on
 * the sheet.
 *
 * `who` is the name the notice belongs to, and is passed only when more than
 * one person's sheet is on the page: in a bundle these blocks are collected
 * above the stack, where “ซ่อน 2 รายการ” with no name attached would send HR
 * hunting through forty sheets for the one it means.
 */
export function FormNotices({ form, who = null, asked = '' }) {
  const of = who ? `${who} · ` : '';
  const narrowed = narrowedByPolicy(form, asked);
  /**
   * What the unmarked rows' status is CALLED, read off the rows rather than
   * written in — today that is รอ HR and only รอ HR, and a sentence naming it
   * in prose would quietly become false the day a fourth status can print.
   */
  const unmarkedLabels = [...new Set((form.unmarked || []).map((u) => u.statusLabel))].join(' · ');
  /**
   * WHICH DAYS they are, in date order, one entry per date however many rows
   * that date has. A count alone says how much of the sheet is unconfirmed; it
   * does not say where to look, and the whole reason this line exists is that
   * the paper beside it is silent.
   *
   * THE MONTH IS PART OF THE DATE HERE, and that is not a style choice: the
   * route widens its query by one period so an overnight session started on the
   * 31st is on this sheet, and its workDate belongs to the month before. A day
   * number with no month would name the wrong day exactly on the rows that are
   * hardest to find. `thaiDate` carries it — and since 2026-09-04 there is no
   * abbreviated form left that could drop it.
   */
  const unmarkedDates = [...new Set((form.unmarked || []).map((u) => u.workDate))]
    .sort()
    .map(thaiDate)
    .join(' · ');
  return (
    <>
      {/* Hours that ARE on the paper and are not settled — the mirror of the
          ซ่อน block below, which is hours that are settled and are not on the
          paper. First, because it is the only one of the three that bears on
          whether the sheet should be signed at all. */}
      {form.pending?.length > 0 && (
        <div className="no-print" style={{ marginBottom: 12 }}>
          <Alert kind="warn">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {of}ใบนี้มี {form.pending.length} รายการที่ยังไม่อนุมัติ และถูกนับรวมใน สรุปรวม แล้ว
            </div>
            {form.pending.map((p) => (
              <div key={p.id} style={{ fontSize: 12.5 }}>
                {thaiDate(p.workDate)} {p.from}–{p.to} · {hours(p.otHours)} ชม. ·
                {' '}{p.statusLabel} · {p.description}
              </div>
            ))}
            <div style={{ fontSize: 12, marginTop: 4 }}>
              รายการเหล่านี้พิมพ์ลงใบพร้อมเครื่องหมาย (รออนุมัติ) ในช่องรายละเอียดงาน ·
              ยอดบนใบจึงยังไม่ใช่ยอดที่จะส่งบัญชี — หากต้องการใบสำหรับลงลายเซ็น
              ให้ตัดสินรายการที่ค้างให้ครบก่อนพิมพ์ หรือเปลี่ยน
              “นโยบายการพิมพ์ใบขออนุมัติ OT” ในตั้งค่าระบบเป็น
              “เฉพาะรายการที่อนุมัติแล้ว”
            </div>
          </Alert>
        </div>
      )}

      {/* THE HOURS AFTER A MIDNIGHT, which this sheet no longer has a line for.

          SECOND, behind ยังไม่อนุมัติ and ahead of everything else. The block
          above decides whether the sheet should be signed at all, which nothing
          outranks; this one decides whether the total on it can be believed
          against any other document for the month, which everything below it
          does outrank. ซ่อน at the foot is its near neighbour and the opposite
          case — those are a duplicate filing no report counts, these are hours
          every other report DOES count, so the paper is the short one.

          The total leads, because that figure IS the difference between this
          sheet and ตรวจสอบประจำเดือน; then the nights, because "which one" is
          the next question and the paper cannot answer it either. */}
      {form.notPrinted?.length > 0 && (
        <div className="no-print" style={{ marginBottom: 12 }}>
          <Alert kind="warn">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {of}ใบนี้ไม่ได้พิมพ์ชั่วโมงหลังเที่ยงคืน {hours(form.notPrintedHours)} ชม.
              {' '}จาก {form.notPrinted.length} ช่วง — ยอดบนใบจึงน้อยกว่ายอดจริงเท่ากับจำนวนนี้
            </div>
            {form.notPrinted.map((n, i) => (
              <div key={`${n.id}-${i}`} style={{ fontSize: 12.5 }}>
                คืนวันที่ {thaiDate(n.workDate)} · ต่อเข้า {thaiDate(n.onDate)}
                {' '}{n.from}–{n.to} · {hours(n.hours)} ชม. · {n.statusLabel} · {n.description}
              </div>
            ))}
            <div style={{ fontSize: 12, marginTop: 4 }}>
              ใบ F-HR-027 ให้หนึ่งวันหนึ่งบรรทัด ชั่วโมงที่ข้ามเที่ยงคืนไปวันถัดไปจึงไม่มีบรรทัดจะลง ·
              {' '}ชั่วโมงเหล่านี้ยังอยู่ครบในระบบ และยังถูกนับใน ตรวจสอบประจำเดือน ·
              {' '}สรุป OT ส่งบัญชี และไฟล์ CSV ทั้งสอง — <strong>ใบนี้กับรายงานเหล่านั้นจะไม่ตรงกัน</strong>
              {' '}เท่ากับจำนวนข้างต้น หากต้องการให้ตรงกัน ต้องแยกยื่นเป็นสองใบคนละวัน
            </div>
          </Alert>
        </div>
      )}

      {/* Hours on the paper that ฝ่ายบุคคล has not confirmed yet and that the
          paper does not mark — รอ HR under a filter that counts it as signed.
          INFO rather than the warning above it: this is the state the filter was
          chosen to print, so it is a fact to have, not a problem to fix. It is
          still said — and said with its dates — because the sheet's own silence
          about these rows is what somebody would otherwise have to already
          know, and a count with no days does not say where to look. */}
      {form.unmarked?.length > 0 && (
        <div className="no-print" style={{ marginBottom: 12 }}>
          <Alert kind="info">
            <div>
              {of}ใบนี้รวม {form.unmarked.length} รายการที่สถานะยังเป็น
              “{unmarkedLabels}” — {unmarkedDates}
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              รายการเหล่านี้พิมพ์ลงใบโดยไม่มีเครื่องหมายกำกับ · หัวหน้างานอนุมัติแล้ว
              ขั้นที่เหลือคือช่อง “เฉพาะฝ่ายบุคคล” ท้ายใบนี้
            </div>
          </Alert>
        </div>
      )}

      {/* The opposite surprise: HR set สถานะที่นับ wide, the policy is strict,
          and the sheet is narrower than the table it was printed from. Said
          here because the paper cannot carry it and the total is the thing
          somebody is about to compare. */}
      {narrowed && (
        <div className="no-print" style={{ marginBottom: 12 }}>
          <Alert kind="info">
            {of}ใบนี้พิมพ์เฉพาะรายการ{FORM_PRINT_SCOPE_SAY[form.printScope] || 'ตามนโยบาย'}
            {' '}ตามนโยบายการพิมพ์ใบขออนุมัติ OT ในตั้งค่าระบบ — ไม่ได้ใช้ “สถานะที่นับ”
            ที่เลือกไว้บนหน้าตรวจสอบประจำเดือน ยอดบนใบจึงน้อยกว่ายอดในตารางได้
          </Alert>
        </div>
      )}

      {/*
        The same facts, on the screen, always — whatever the paper is set to
        carry. Whoever pressed print is the person who can still do something
        about a row that was filed by the wrong person, and while
        `proxyNoteOnForm` is off this is the only place the month's proxy
        filings and stand-in approvals are named together.
      */}
      {form.acting?.length > 0 && (
        <div className="no-print" style={{ marginBottom: 12 }}>
          <Alert kind="info">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {of}เดือนนี้มี {form.acting.length} รายการที่บันทึกหรืออนุมัติโดยผู้ทำแทน
            </div>
            {form.acting.map((a, i) => (
              <div key={i} style={{ fontSize: 12.5 }}>{actingLine(a)}</div>
            ))}
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {form.actingOnPaper
                ? 'ข้อความนี้พิมพ์ลงในใบด้วย (ตั้งค่า proxyNoteOnForm เปิดอยู่)'
                : 'ใบพิมพ์จะแสดงเฉพาะเครื่องหมาย (แทน) ในช่องรายละเอียดงาน '
                  + '· เปิด proxyNoteOnForm ในนโยบายการคำนวณ หากต้องการให้พิมพ์รายชื่อผู้ทำแทนลงในใบด้วย'}
            </div>
          </Alert>
        </div>
      )}

      {/* Inside no-print, deliberately. The sheet shows the latest filing of a
          session and nothing else — that is what was asked of it — but hours
          that exist in the database and not on the paper cannot go unsaid to
          the person holding both. */}
      {form.hidden?.length > 0 && (
        <div className="no-print" style={{ marginBottom: 12 }}>
          <Alert kind="warn">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {of}ซ่อน {form.hidden.length} รายการที่ซ้ำช่วงเวลาเดิม — ใบฟอร์มแสดงเฉพาะรายการที่กรอกล่าสุดของแต่ละช่วงเวลา
            </div>
            {form.hidden.map((h) => (
              <div key={h.id} style={{ fontSize: 12.5 }}>
                {thaiDate(h.workDate)} {h.from}–{h.to} · {hours(h.otHours)} ชม. ·
                {' '}{h.statusLabel} · {h.description}
              </div>
            ))}
            <div style={{ fontSize: 12, marginTop: 4 }}>
              ชั่วโมงเหล่านี้ไม่ถูกนับใน สรุปรวม ของใบนี้ แต่ยังคงอยู่ในรายงานรายเดือนและไฟล์ส่งบัญชี ·
              หากเป็นรายการที่กรอกผิด ให้ยกเลิกรายการนั้นเพื่อให้ยอดทั้งสองฝั่งตรงกัน
            </div>
          </Alert>
        </div>
      )}
    </>
  );
}

/**
 * The paper itself — one person, one month, one side of A4.
 *
 * Rendered inside a `.f027-screen`, which is what puts it on a grey page on
 * the screen and takes the grey away on the paper. A second sheet in the same
 * wrapper starts a new page (see `.f027 + .f027` in app/print.css).
 *
 * `sheet` IS THE PREVIEW'S LABEL AND NOTHING ELSE — `{ no, of }`, drawn in the
 * white band above the title and carried by `no-print`. It is passed by the
 * bundle (PrintFormBatch.jsx), where forty sheets in one scroller had no way of
 * saying which one you were looking at; a single person's print passes nothing
 * and gets no label, because "ใบที่ 1 / 1" over one sheet is furniture.
 *
 * ⚠ IT SAYS ใบที่ AND NOT หน้า, deliberately, and สรุป OT ส่งบัญชี's label says
 * หน้า. There the element IS a side of paper — the rows are cut to fit one, so
 * the count is exact. Here the element is one person's FORM, which is a side of
 * paper in every ordinary month and runs onto a second one when a month has
 * enough split sessions (see the note above `.f027` in app/print.css, which
 * lets it run rather than shrinking the grid). Counting forms is true either
 * way; counting pages would be a number this component cannot promise.
 */
export function F027Sheet({ form, sheet = null }) {
  const cell = (v) => (v ? hours(v) : '');
  /**
   * Which sessions carry (รออนุมัติ) — READ OFF `form.pending`, the same list
   * the legend under the grid counts and the warning above the sheet prints.
   *
   * It used to be `status !== 'approved'` here and the whole list there, which
   * was two readings of one rule in two files, and they have to agree: a mark
   * with no legend is an unexplained abbreviation on a document somebody signs,
   * and a legend with no mark is a line about rows the reader cannot find. Now
   * neither can move without the other. Which statuses are in the list is the
   * server's decision — `formPendingStatuses` in lib/reports.js.
   */
  const pendingIds = new Set((form.pending || []).map((p) => p.id));

  return (
    <div className="f027">
      {sheet && (
        <div className="sheet-tag no-print">
          ใบที่ {sheet.no} / {sheet.of} ({form.employee.name})
        </div>
      )}
      <div className="f027-title">
        ใบขออนุมัติทำงานล่วงเวลา/ทำงานในวันหยุด (Overtime&nbsp;&nbsp;Work&nbsp;&nbsp;Authorization)
      </div>

      <div className="f027-meta">
        <div className="fld">
          <span className="label">ชื่อ-สกุล</span>
          <span className="value">{form.employee.name}</span>
        </div>
        <div className="fld">
          <span className="label">แผนก</span>
          <span className="value">{form.employee.department}</span>
        </div>
        <div className="fld">
          <span className="label">ประจำเดือน</span>
          <span className="value">{form.periodLabel}</span>
        </div>
      </div>

      <table>
        <colgroup>
          <col style={{ width: '9mm' }} />
          <col style={{ width: '15mm' }} />
          <col style={{ width: '15mm' }} />
          <col style={{ width: '22mm' }} />
          <col style={{ width: '22mm' }} />
          <col style={{ width: '22mm' }} />
          <col />
          <col style={{ width: '19mm' }} />
          <col style={{ width: '19mm' }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={3} className="dateh">
              <span className="t">วันที่</span>
              <span className="b">Date</span>
            </th>
            <th colSpan={2}>เวลาทำ OT</th>
            <th colSpan={3}>จำนวนชั่วโมง</th>
            <th rowSpan={3}>รายละเอียดงานที่ทำ</th>
            <th rowSpan={3}>ลงชื่อ<br />พนักงาน</th>
            <th rowSpan={3}>ลงชื่อ<br />หัวหน้างาน</th>
          </tr>
          <tr>
            <th colSpan={2}>00.00-23.59</th>
            <th className="hl">เริ่ม 17.01-07.59<br />(วันจ.-ศ.)</th>
            <th className="hl">เริ่ม 8.00-17.00<br />(วันหยุด)</th>
            <th className="hl">เริ่ม 17.01-07.59<br />(วันหยุด)</th>
          </tr>
          <tr>
            <th>จาก/From</th>
            <th>ถึง/To</th>
            <th>OT วันปกติ</th>
            <th colSpan={2}>OT วันหยุด</th>
          </tr>
        </thead>
        <tbody>
          {form.rows.map((row) => {
            // A date with no OT still prints its row — the paper form is a
            // full month and HR reads the blanks as "no OT that day". Since
            // 2026-09-08 the grid is 31 rows in every month, so on the short
            // months the last one to three rows are days the year does not
            // have: `row.date` is null there and they can never hold a
            // session. See `formGridDays` in lib/reports.js.
            const sessions = row.sessions.length ? row.sessions : [null];
            /**
             * WHETHER THE DATE'S TWO SESSIONS WERE SIGNED BY THE SAME หัวหน้า.
             *
             * The two ลงชื่อ cells have spanned the date's rows since the sheet
             * was written, because the paper merges them and because the person
             * signing was signing the day. Now that the name is printed rather
             * than written, the merge can hide a real difference: a date worked
             * in two sessions is two requests, they can reach two different
             * queues, and a stand-in may have signed one of them.
             *
             * So the merge stays wherever it is true — which is every ordinary
             * date, and every date with no OT at all — and gives way only on
             * the date where it would be a claim rather than a layout. An
             * ordinary sheet is the sheet it always was, cell for cell.
             *
             * The พนักงาน cell never splits: one sheet is one person, and their
             * name is the same on every row of it.
             */
            const oneApprover = new Set(sessions.map((s) => s?.approverName || '')).size === 1;
            return sessions.map((s, i) => (
              // Keyed by the DAY NUMBER, which every row has: the three rows a
              // February sheet ends with have no date, and `${row.date}-${i}`
              // would give all three the key `null-0`.
              <tr key={`${row.day}-${i}`}>
                {/* The day number and nothing under it. A birthday note
                    used to sit here to explain a Tuesday in the วันหยุด
                    column; HR asked for it off the controlled form, and the
                    remark now goes on สรุป OT ส่งบัญชี beside the row —
                    see components/AccountingPrint.jsx. */}
                {i === 0 && (
                  <td className="c day" rowSpan={sessions.length}>{row.day}</td>
                )}
                <td className="c">{s?.from || ''}</td>
                <td className="c">{s?.to || ''}</td>
                <td className="n">{cell(s?.[BUCKETS.OT15_WEEKDAY])}</td>
                <td className="n">{cell(s?.[BUCKETS.OT15_HOLIDAY])}</td>
                <td className="n">{cell(s?.[BUCKETS.OT3_HOLIDAY])}</td>
                <td className="desc" title={s?.description}>
                  {s?.description || ''}
                  {/* FIRST OF THE FOUR MARKS, because it is the only one that
                      bears on whether the row should be signed. Rarer than it
                      looks: under เฉพาะรายการที่อนุมัติแล้ว no session here can
                      carry another status at all, and under อนุมัติแล้ว + รอ HR
                      the รอ HR rows are not marked either — the step they are
                      waiting on is the เฉพาะฝ่ายบุคคล box at the foot of this
                      sheet. In the description cell for the same reason (แทน)
                      is: F-HR-027 Rev.4 is a controlled form measured in
                      millimetres, and a remark where HR already reads three
                      others is not a revision of it. What it means is spelt out
                      under the grid. */}
                  {s && pendingIds.has(s.entryId) ? ' (รออนุมัติ)' : ''}
                  {/* (ต่อจากคืนก่อน) WAS THE THIRD MARK and came off on
                      2026-09-02 with the row it belonged to. It labelled the
                      line an overnight session drew on the date it ran INTO;
                      the sheet gives each date one line now and that line is
                      not drawn, so the mark had nothing left to qualify. The
                      hours it used to head are on `form.notPrinted` and are
                      named on the screen above the sheet. */}
                  {s?.noBreakTaken ? ' [ไม่พักเที่ยง]' : ''}
                  {/* Six characters, in the cell that already carries the
                      other per-row remarks. Not a new column and not a
                      new row: this sheet is a fixed month of 31 and its
                      columns are measured in millimetres against the
                      paper. What (แทน) means is spelt out under the grid. */}
                  {s?.filedByProxy ? ' (แทน)' : ''}
                </td>
                {/* THE TWO SIGNATURES, TYPED. HR asked for this on 2026-09-02
                    and asked for it as a replacement: the printed name IS the
                    signature and the sheet is not signed by hand afterwards.
                    What stands behind it is the trail the app already kept —
                    who pressed which button, at which minute, under whose
                    authority — which is why nothing new is recorded for this
                    and only `byName` is read.

                    THE NAME ALONE, NO TIMESTAMP. Also asked for, and the
                    column is why: 19mm at 6pt holds a Thai name and not a name
                    over a date. The minute each signature was made is not lost
                    — it is on การอนุมัติ in the entry's own pop-up, from the
                    same history rows this reads. */}
                {i === 0 && (
                  <td className="sig" rowSpan={sessions.length}>
                    {/* The person the sheet is for, on every row that has hours
                        and on none that has not. A blank date is a day they did
                        no OT, and a name against it would be a declaration
                        about a day nobody claimed.

                        A row filed by a หัวหน้า on their behalf carries their
                        name too — asked for explicitly, and the row is not
                        silent about it either way: (แทน) is already in the
                        รายละเอียดงานที่ทำ cell beside it. */}
                    <Signed name={row.sessions.length ? form.employee.name : null} />
                  </td>
                )}
                {/* WHOEVER PRESSED อนุมัติ — the หัวหน้า who signed the first
                    step, and on a row that never had one (ฝ่ายบุคคล's own OT,
                    the other บทบาท that file straight to them, a row filed and
                    approved off the fingerprint scanner) the ฝ่ายบุคคล who
                    approved it. Asked for in those words on 2026-09-07; see
                    `managerSignature`, which is where the order is written.

                    Blank on a row nobody has approved yet, and on one whose
                    approval predates `byName`. An unsigned box is what an
                    unsigned form looks like. */}
                {(i === 0 || !oneApprover) && (
                  <td className="sig" rowSpan={oneApprover ? sessions.length : 1}>
                    <Signed name={s?.approverName} />
                  </td>
                )}
              </tr>
            ));
          })}
          <tr className="total">
            <td className="blank" />
            <td className="c" colSpan={2}>สรุปรวม</td>
            <td className="n">{cell(form.summary[BUCKETS.OT15_WEEKDAY])}</td>
            <td className="n">{cell(form.summary[BUCKETS.OT15_HOLIDAY])}</td>
            <td className="n">{cell(form.summary[BUCKETS.OT3_HOLIDAY])}</td>
            <td className="blank" colSpan={3} />
          </tr>
        </tbody>
      </table>

      {/* NO LEGEND FOR (รออนุมัติ) — there used to be a หมายเหตุ block here
          naming what the mark meant, how many rows carried it, and that the
          สรุปรวม above was therefore not the figure to send to accounting. HR
          asked for it off the sheet (2026-08-20), and the sheet is theirs: this
          is a controlled form measured in millimetres against A4, and three
          lines that grow under the grid are three lines the form does not have.

          THE MARK ITSELF STAYS. It is the one remark in the description cell
          that bears on whether a row should be signed, and unlike (แทน) it
          needs no gloss — it is the word รออนุมัติ, in Thai, in the cell beside
          the work it belongs to. What the legend added over that was the count
          and the warning about สรุปรวม, and both of those are on the screen
          above the sheet, in front of the person who pressed print and can
          still do something about them (see `FormNotices`). */}

      {/* Who filled a row in, and who signed one, when that was not the
          obvious person.

          Between the grid and the ฝ่ายบุคคล box, and rendered ONLY when
          the month has something to say — a month with nothing produces
          no element at all, so the sheet stays byte for byte what it was.
          That is the same rule the ไม่ถูกนับ flags follow on the other two
          printed sheets, and for the same reason: F-HR-027 is a controlled
          form whose spacing is measured against the paper, and anything
          added unconditionally is added to every sheet forever.

          Behind `proxyNoteOnForm`, default off. The (แทน) mark inside the
          description cell is not — it sits where HR already reads two other
          remarks. This block is a line the form does not have today, so it
          waits for somebody in HR to look at a printed sample and say yes. */}
      <ActingNote form={form} />

      {/* The tail of the paper form. เฉพาะฝ่ายบุคคล is boxed in solid rule;
          everything HR writes in is dashed. The OT × 1.5 row has two boxes
          — วันปกติ above, วันหยุด below — and the รวม box beside them adds
          those two up. OT × 3 has one box and no รวม. */}
      <div className="f027-foot">
        <div className="f027-hr">
          <div className="who">เฉพาะ<br />ฝ่าย<br />บุคคล</div>
          {/* Cells carry no borders of their own; each rule below is a
              single element spanning its whole run, so a dashed line never
              restarts its pattern part-way and every corner meets. */}
          <div className="grid">
            <div className="cell lbl15">OT * 1.5</div>
            <div className="cell lbl3">OT * 3</div>
            <div className="cell v15a">{hours(form.hrSection.ot15Weekday)}</div>
            <div className="cell v15b">{hours(form.hrSection.ot15Holiday)}</div>
            <div className="cell v3">{hours(form.hrSection.ot3)}</div>
            <div className="cell tot">
              <span className="cap">รวม</span>
              <span className="amt">{hours(form.hrSection.ot15)}</span>
            </div>

            <i className="rule h1" />
            <i className="rule h2" />
            <i className="rule h3" />
            <i className="rule h4" />
            <i className="rule c1" />
            <i className="rule c2" />
            <i className="rule c3" />
          </div>
        </div>

        <div className="f027-check">
          <div className="line" />
          <div className="role">ฝ่ายบุคคล</div>
          <div className="by">ผู้ตรวจสอบ/ Cheak by</div>
        </div>

        <div className="f027-code">{form.code}</div>
      </div>
    </div>
  );
}

/**
 * One acting note as a sentence, used on the screen and on the paper alike.
 *
 * Both halves are named — who acted and whose authority they used — because
 * either alone is the half that produces the question rather than the one that
 * answers it. A missing name prints "—" rather than being dropped: that a row
 * was signed by a stand-in stays true after the stand-in has left.
 */
function actingLine(a) {
  const when = thaiDate(a.workDate);
  if (a.kind === 'filed') return `${when} · หัวหน้างานบันทึกแทน — ${a.by || '—'}`;
  // The one line here that is about an approval as much as a filing: it says
  // what happened AND what did not, because a sheet naming only the person who
  // typed it would leave the missing manager's signature looking like an
  // omission on the paper rather than a fact about the row.
  if (a.kind === 'hr_verified') {
    return `${when} · ฝ่ายบุคคลบันทึกและอนุมัติเอง (ตรวจจากบันทึกเวลาสแกนนิ้ว) — ${a.by || '—'}`
      + ' · ไม่ได้ผ่านการอนุมัติของหัวหน้างาน';
  }
  const verb = a.kind === 'refused' ? 'ไม่อนุมัติ' : 'อนุมัติ';
  return `${when} · ${a.by || '—'} ${verb}แทน ${a.onBehalfOf || '—'}`;
}

/**
 * The block under the grid, on the paper.
 *
 * Returns null — not an empty element, not a zero-height rule — when the month
 * has nothing to say or the flag is off, so an ordinary sheet is unchanged.
 */
function ActingNote({ form }) {
  if (!form.actingOnPaper || !form.acting?.length) return null;
  return (
    <div className="f027-acting">
      <div className="t">หมายเหตุ · ผู้บันทึก / ผู้อนุมัติแทน</div>
      {form.acting.map((a, i) => <div className="l" key={i}>{actingLine(a)}</div>)}
      <div className="l">(แทน) ในช่องรายละเอียดงาน = หัวหน้างานเป็นผู้บันทึกรายการแทนพนักงาน</div>
    </div>
  );
}

/**
 * One typed signature — the given name and nothing else. `นางสาวสมหญิง ใจงาม`
 * signs as `สมหญิง`.
 *
 * THE TITLE AND THE SURNAME BOTH COME OFF, and `firstName` in lib/api.js is
 * where both cuts are made and where the roster they were measured against is
 * written down. The surname went on 2026-09-02 — it was what put a second line
 * in a 19mm column and a 25-row month onto two sides of A4 — and the คำนำหน้า
 * on 2026-09-08, when HR read `นายไพฑูร` in a box headed ลงชื่อ.
 *
 * RETURNS NULL, NOT AN EMPTY SPAN, when there is no name. The two ลงชื่อ
 * columns are blank on most of the 31 rows of most sheets, and an element with
 * a line-height in every one of them would set a floor under the row height on
 * a sheet whose whole layout is the 31 rows fitting one side of A4. Nothing is
 * added to a row that has nothing to say — the same rule `ActingNote` follows
 * below, and for the same reason.
 *
 * NO BRACKETS, NO PUNCTUATION OF ANY KIND. It read `( ชื่อ นามสกุล )` for one
 * afternoon on 2026-09-02, on the reasoning that brackets under a ลงชื่อ
 * heading are what make a name read as a signature rather than a label; HR
 * asked for the name alone the same day, and the box carries a name alone.
 */
function Signed({ name }) {
  const only = firstName(name);
  if (!only) return null;
  return <span className="nm">{only}</span>;
}

