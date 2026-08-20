'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { Alert, Empty, SheetScroll } from './common.jsx';
import { PrintChrome, FormNotices, F027Sheet, sheetQuery } from './PrintForm.jsx';

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
 * one property this component is not allowed to decide. Their `FormNotices`
 * block says why the sheet is empty, with their name on it.
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

  return (
    <>
      <PrintChrome
        onClose={onClose}
        // Policy-wide, so any sheet answers for all of them. Blank until the
        // first one lands, rather than guessing and correcting itself.
        basis={forms?.[0]?.hrSection.basis}
        disabled={loading}
        note={`รวม ${employees.length} คนในเอกสารเดียว · หนึ่งคนต่อหนึ่งหน้า · เรียงตามลำดับในตารางตรวจสอบรายเดือน`}
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
          to the sheet below it. Each carries its own name — see `FormNotices`.
          A month with nothing to say renders nothing at all. */}
      {(forms || []).map((form) => (
        <FormNotices
          key={`notice-${form.employee.code}-${form.employee.name}`}
          form={form}
          who={`${form.employee.code} · ${form.employee.name}`}
          asked={status}
        />
      ))}

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
