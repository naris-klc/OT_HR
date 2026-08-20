'use client';

import React, { useEffect, useState } from 'react';
import { api, thaiDate } from '@/lib/api.js';
import { Alert, Empty, PrintChrome, SheetScroll } from './common.jsx';
import { f027Chrome, F027Sheet, narrowedByPolicy, sheetQuery } from './PrintForm.jsx';

/**
 * Every F-HR-027 in a month as one document — one person to a side of paper.
 *
 * The sheets are the same element one person's print uses (`F027Sheet`), built
 * from the same route, one request per employee. That is deliberate and is
 * worth the requests: F-HR-027 is a controlled form, and a bundle assembled by
 * a second endpoint would be a second reading of the month — the day the two
 * disagreed, the printed page and the screen it was printed from would be
 * quoting different totals for the same signature.
 *
 * WHO IS IN THE BUNDLE is decided by the caller, not here, and in practice it
 * is exactly the rows of ตรวจสอบรายเดือน as they stand — so what prints is
 * what was on the screen. Somebody with no OT this month has no row there and
 * gets no sheet: a blank F-HR-027 is a page nobody signs. Somebody whose only
 * hours are still in a queue is in or out according to สถานะที่นับ, which is
 * the same lever that decided whether their row was on the screen at all.
 *
 * สถานะที่นับ IS PASSED TO THE SHEETS, and what it is worth there is not this
 * component's decision. It used to be dropped on the way — every sheet was
 * fetched with the queue statuses included, whatever the screen was filtered
 * to, so a bundle printed under อนุมัติแล้วเท่านั้น carried totals larger than
 * the table it was pressed from with nothing on the paper saying which rows the
 * difference was. The route now weighs the request against `formPrintScope` and
 * ignores it under two of the three answers — see `formPrintStatuses` in
 * lib/reports.js. The bundle's job is only to ask the same question the
 * per-person button asks, which `sheetQuery` is what guarantees.
 *
 * ONE CONSEQUENCE IS A BLANK SHEET, and it is left in rather than filtered out.
 * Under the strict answer with สถานะที่นับ set wide, somebody whose only hours
 * are still in a queue has a row on the screen — so a sheet in the bundle — and
 * that sheet comes back with nothing on it. Dropping it here would quietly make
 * the bundle a different list from the table it was pressed from, which is the
 * one property this component is not allowed to decide. `NoticeDigest` below
 * says why the sheet is empty, with their name in it.
 */

/**
 * How many sheets are fetched at once.
 *
 * Four rather than all of them: a department of forty would otherwise open
 * forty connections, each re-reading the policy and the holiday calendar, to
 * produce a document nobody can read faster than the printer feeds it.
 */
const CONCURRENCY = 4;

export default function PrintFormBatch({ employees, period, status = '', onClose }) {
  const [forms, setForms] = useState(null);
  const [failed, setFailed] = useState([]);
  const [done, setDone] = useState(0);

  useEffect(() => {
    let live = true;
    setForms(null);
    setFailed([]);
    setDone(0);

    const out = new Array(employees.length).fill(null);
    const bad = [];
    let next = 0;

    async function worker() {
      for (;;) {
        const i = next++;
        if (i >= employees.length || !live) return;
        const employee = employees[i];
        try {
          const res = await api.get(
            `/reports/form/${period}${sheetQuery({ employeeId: employee._id, status })}`,
          );
          out[i] = res.form;
        } catch (err) {
          // One employee's sheet failing is not the bundle failing. The rest
          // still print and the missing names are listed above them, because a
          // stack that is quietly one sheet short is the one failure mode that
          // survives all the way to somebody's payslip.
          bad.push({ employee, message: err.message });
        }
        if (live) setDone((n) => n + 1);
      }
    }

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, employees.length) },
      () => worker(),
    );
    Promise.all(workers).then(() => {
      if (!live) return;
      setForms(out.filter(Boolean));
      setFailed(bad);
    });

    return () => { live = false; };
  }, [employees, period, status]);

  if (!employees.length) return <Empty>ไม่มีพนักงานที่ต้องพิมพ์ในเดือนนี้</Empty>;

  const loading = forms === null;
  // The basis is policy-wide, so any sheet answers for all of them — and it is
  // blank until the first one lands rather than guessed at and corrected. What
  // this document IS goes above it: the bundle's own line first, then the one
  // every F-HR-027 carries.
  const chrome = f027Chrome(forms?.[0]);

  return (
    <>
      <PrintChrome
        onClose={onClose}
        disabled={loading}
        graphics={chrome.graphics}
        footer={chrome.footer}
        hints={[{
          label: 'หมายเหตุ',
          text: `รวม ${employees.length} คนในเอกสารเดียว (1 คนต่อ 1 หน้า) เรียงตามลำดับตารางตรวจรายเดือน`,
        }]}
      />

      {loading && (
        <div className="box no-print">
          กำลังเตรียมใบ {done} / {employees.length} …
        </div>
      )}

      {failed.length > 0 && (
        <div className="no-print" style={{ marginBottom: 12 }}>
          <Alert kind="error">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              เตรียมใบไม่สำเร็จ {failed.length} คน — ไม่มีใบของคนเหล่านี้ในชุดที่พิมพ์
            </div>
            {failed.map((f) => (
              <div key={f.employee._id} style={{ fontSize: 12.5 }}>
                {f.employee.code} · {f.employee.name} — {f.message}
              </div>
            ))}
            <div style={{ fontSize: 12, marginTop: 4 }}>
              ให้พิมพ์ทีละคนจากปุ่ม “พิมพ์ F-HR-027” ในแถวของพนักงาน หรือลองใหม่อีกครั้ง
            </div>
          </Alert>
        </div>
      )}

      {/* Collected above the stack rather than left beside the sheet each one
          belongs to. In a bundle nobody scrolls forty pages looking for the
          warnings, and a warning between two sheets reads as though it belongs
          to the sheet below it. A month with nothing to say renders nothing. */}
      <NoticeDigest forms={forms || []} asked={status} />

      <SheetScroll className="f027-screen">
        {(forms || []).map((form, i) => (
          // Keyed by position: two people can share a name, and a roster with
          // two shapes of employee code (PM-0620 / PM00511) is not something to
          // build a react key out of.
          <F027Sheet key={`${form.employee.code}-${i}`} form={form} />
        ))}
      </SheetScroll>
    </>
  );
}

/**
 * What the whole bundle has to say, as ONE box — never one box per person.
 *
 * The notices used to be `FormNotices` rendered once per sheet, which is right for
 * a single print and wrong for forty. Each person can raise up to four of them;
 * a department of forty filled the screen with amber above a preview nobody
 * could see, and the one fact somebody actually needed — how many sheets this
 * is about — was the one thing no box on the screen said, because each box only
 * ever knew about its own page.
 *
 * So the digest counts SHEETS first and names people second. The counts are
 * always visible; the names sit behind ดูรายละเอียด, because "which 3 of 40" is
 * a question you ask after you know there are 3. `<details>` rather than state:
 * the list reloads underneath this whenever the month or สถานะที่นับ changes,
 * and an open/closed flag in state is a thing that can end up describing a list
 * that no longer exists.
 *
 * NOT gone from the app — a single print still shows the per-sheet blocks in
 * full beside the one sheet they belong to, where there is room and no question
 * about whose page it is. This is the same information for the case where there
 * are forty of them.
 */
const DIGEST_KINDS = [
  {
    key: 'pending',
    level: 'warn',
    label: 'ยังไม่อนุมัติ',
    rows: (form) => form.pending || [],
    title: (sheets, rows) => `พบใบที่มีรายการยังไม่อนุมัติ ${sheets} ใบ · ${rows} รายการ`,
  },
  {
    key: 'hidden',
    level: 'warn',
    label: 'ซ่อนรายการที่ซ้ำช่วงเวลาเดิม',
    rows: (form) => form.hidden || [],
    title: (sheets, rows) => `พบใบที่มีรายการซ้ำช่วงเวลาเดิมถูกซ่อน ${sheets} ใบ · ${rows} รายการ`,
  },
  {
    key: 'unmarked',
    level: 'info',
    label: 'รอ HR ยืนยัน',
    rows: (form) => form.unmarked || [],
    title: (sheets, rows) => `พบเอกสารรอ HR ยืนยันทั้งหมด ${sheets} ใบ · ${rows} รายการ`,
  },
  {
    key: 'acting',
    level: 'info',
    label: 'ผู้บันทึกหรือผู้อนุมัติแทน',
    rows: (form) => form.acting || [],
    title: (sheets, rows) => `พบใบที่มีผู้บันทึกหรือผู้อนุมัติแทน ${sheets} ใบ · ${rows} รายการ`,
  },
];

/**
 * The days one kind of notice falls on, in date order, one entry per date.
 *
 * The same rule the per-sheet block follows: full `thaiDate`, because an overnight
 * session started on the last day of the previous month is on this sheet with a
 * workDate belonging to the month before, and a bare day number would name the
 * wrong day exactly on the rows that are hardest to find.
 */
const datesOf = (rows) => [...new Set(rows.map((r) => r.workDate))]
  .sort()
  .map(thaiDate)
  .join(' · ');

function NoticeDigest({ forms, asked = '' }) {
  const groups = DIGEST_KINDS
    .map((kind) => ({
      kind,
      sheets: forms
        .map((form) => ({ form, rows: kind.rows(form) }))
        .filter(({ rows }) => rows.length > 0),
    }))
    .filter(({ sheets }) => sheets.length > 0);

  /**
   * Bundle-wide, and so NOT one of the groups: `printScope` is policy and `asked` is
   * the screen, so this is true of every sheet in a printing or of none. Forty
   * names under it would be the same sentence forty times.
   */
  const narrowed = forms.some((form) => narrowedByPolicy(form, asked));
  if (!groups.length && !narrowed) return null;

  // The box takes the loudest tone in it. An amber notice quietened to blue
  // because a blue one was counted beside it would be a downgrade nobody asked
  // for, on the two kinds that bear on whether a sheet may be signed at all.
  const level = groups.some(({ kind }) => kind.level === 'warn') ? 'warn' : 'info';

  return (
    <div className="no-print notice-digest">
      <Alert kind={level}>
        {groups.map(({ kind, sheets }) => (
          <div key={kind.key} style={{ fontWeight: 600 }}>
            {kind.title(sheets.length, sheets.reduce((n, s) => n + s.rows.length, 0))}
          </div>
        ))}

        {narrowed && (
          <div style={{ fontSize: 12.5, marginTop: groups.length ? 4 : 0 }}>
            ทั้งชุดพิมพ์เฉพาะรายการที่อนุมัติแล้ว ตามนโยบายการพิมพ์ใบขออนุมัติ OT ในตั้งค่าระบบ
            — ไม่ได้ใช้ “สถานะที่นับ” ที่เลือกไว้ ยอดบนใบจึงน้อยกว่ายอดในตารางได้
          </div>
        )}

        {groups.length > 0 && (
          <details className="notice-fold">
            <summary>ดูรายละเอียด</summary>
            {groups.map(({ kind, sheets }) => (
              <div key={kind.key} className="notice-fold-group">
                <div className="k">{kind.label}</div>
                {sheets.map(({ form, rows }, i) => (
                  // Keyed by position: two people can share a name, and a roster
                  // with two shapes of employee code (PM-0620 / PM00511) is not
                  // something to build a react key out of.
                  <div key={`${kind.key}-${i}`} className="l">
                    {form.employee.code} · {form.employee.name} — {rows.length} รายการ
                    {' · '}{datesOf(rows)}
                  </div>
                ))}
              </div>
            ))}
          </details>
        )}
      </Alert>
    </div>
  );
}
