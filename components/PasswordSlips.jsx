'use client';

import React from 'react';
import { PrintChrome } from './PrintForm.jsx';

/**
 * รหัสผ่านชั่วคราว ตัดแจกทีละใบ.
 *
 * WHAT THIS REPLACES. After a CSV import the temporary passwords come back as
 * one table on one screen — copyable, downloadable, and correct. Handing them
 * out from it is not: sixty people means reading sixty passwords off a screen
 * one at a time, and the fallback everybody reaches for is downloading the CSV,
 * which puts every new account's password in a file in Downloads. That file is
 * the same risk that took the `password` column out of the import template
 * (app/api/employees/import/route.js) — this is the way of not creating it.
 *
 * TEN TO A SIDE, not one. F-HR-027 is one person to a page because it is a
 * controlled form that gets signed; a slip is a thing you cut out and hand
 * over, and sixty of them on sixty sheets is a ream for nothing. Two columns of
 * five fit A4 with room to cut.
 *
 * NO SORTING, DELIBERATELY. The rows arrive in the order the import created
 * them, which is the order of the file HR uploaded — so the stack of slips
 * comes off the printer in the same order as the spreadsheet they are ticking
 * names off. Sorting by name here would be tidier and would make that job
 * harder.
 */

/** Ten to an A4 side — see `.slips` in app/print.css, which sets the geometry. */
const PER_PAGE = 10;

export default function PasswordSlips({ rows, onClose }) {
  const pages = [];
  for (let i = 0; i < rows.length; i += PER_PAGE) pages.push(rows.slice(i, i + PER_PAGE));

  /**
   * Where to log in, read off the browser rather than written down.
   *
   * This app is served from whatever address the office network gives it, and
   * a hard-coded one would be wrong the day it moves to the company server —
   * printed on paper, in somebody's hand, saying the wrong thing. Whatever
   * address HR reached this screen on is the address the slip should carry.
   */
  const where = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <>
      <PrintChrome
        onClose={onClose}
        basis="raw"
        note={`${rows.length} ใบ · ${pages.length} แผ่น — ตัดตามเส้นประแล้วแจกให้เจ้าของแต่ละใบ`}
      />

      {/* Said on the screen and never on the paper: the slip a person is handed
          should carry what they need and nothing about how it was made. */}
      <div className="no-print" style={{ marginBottom: 12, fontSize: 13, color: 'var(--muted)' }}>
        แต่ละใบมีรหัสผ่านของคนเดียว — ตัดแล้วแจกได้เลย ไม่ต้องดาวน์โหลดไฟล์
        {' '}และไม่ต้องอ่านรหัสของคนอื่นให้ใครฟัง
      </div>

      <div className="slips-screen">
        {pages.map((page, p) => (
          <div className="slips" key={p}>
            {page.map((r) => (
              <div className="slip" key={r.code}>
                <div className="slip-head">ระบบขออนุมัติทำงานล่วงเวลา · PRIMUS</div>
                <div className="slip-name">{r.name}</div>
                <dl className="slip-fields">
                  <dt>รหัสพนักงาน</dt>
                  <dd className="slip-mono">{r.code}</dd>
                  <dt>รหัสผ่านชั่วคราว</dt>
                  <dd className="slip-mono slip-secret">{r.password}</dd>
                </dl>
                <div className="slip-foot">
                  เข้าระบบที่ {where}
                  <br />
                  ระบบจะให้ตั้งรหัสผ่านของตัวเองทันทีที่เข้าครั้งแรก — อย่าให้ผู้อื่นใช้ใบนี้
                </div>
              </div>
            ))}
            {/* An odd last page keeps its grid: without the fillers the two
                remaining slips stretch to half a sheet each and stop looking
                like the things on the pages before them. */}
            {Array.from({ length: PER_PAGE - page.length }, (_, i) => (
              <div className="slip slip-blank" key={`blank${i}`} aria-hidden="true" />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
