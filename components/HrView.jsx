'use client';

import React, { useEffect, useState } from 'react';
import {
  api, hours, thaiDate, dayName, currentPeriod, periodLabel, BUCKETS, companyLabel,
} from '@/lib/api.js';
import { UNCHECKABLE } from '@/lib/birthdayCheck.js';
import { Alert, Empty } from './common.jsx';
import { PolicyVersionBanner, PolicyVersionSummaryCell } from './PolicyVersion.jsx';
import PrintForm from './PrintForm.jsx';
import HrEntries from './HrEntries.jsx';
import HrEdits from './HrEdits.jsx';
import { useBackHandler } from './nav.jsx';

/** HR's monthly review (§2): one row per employee, then correct, export or print. */
export default function HrView({ user }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState(null);
  const [statusFilter, setStatusFilter] = useState('approved');
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(null);
  const [opened, setOpened] = useState(null); // employee whose entries HR is in
  const [auditing, setAuditing] = useState(null); // employee whose edits HR is reading

  async function load() {
    try {
      setData(null);
      const res = await api.get(`/reports/monthly/${period}?status=${statusFilter}`);
      setData(res);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [period, statusFilter]);

  // Three sub-views, all reached from this table and all closed the same
  // way. Mutually exclusive by the early returns below, so registering each
  // separately cannot stack them.
  useBackHandler(Boolean(printing), () => setPrinting(null));
  useBackHandler(Boolean(auditing), () => setAuditing(null));
  useBackHandler(Boolean(opened), () => setOpened(null));

  if (printing) {
    return (
      <PrintForm
        employeeId={printing.employeeId}
        period={period}
        onClose={() => setPrinting(null)}
      />
    );
  }

  if (auditing) {
    return (
      <HrEdits
        employee={auditing}
        period={period}
        status={statusFilter}
        onClose={() => setAuditing(null)}
      />
    );
  }

  if (opened) {
    return (
      <HrEntries
        employee={opened}
        period={period}
        onClose={() => setOpened(null)}
        onChanged={load}
      />
    );
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <h2>ตรวจสอบรายเดือน</h2>
            <div className="hint" style={{ margin: 0 }}>{periodLabel(period)}</div>
          </div>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>ประจำเดือน</label>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 220 }}>
            <label>สถานะที่นับ</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="approved">อนุมัติแล้วเท่านั้น</option>
              <option value="approved,pending_hr">อนุมัติแล้ว + รอ HR</option>
              <option value="approved,pending_hr,pending_mgr">ทั้งหมดที่ยังไม่ถูกปฏิเสธ</option>
            </select>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn ghost"
            onClick={() => api.download(
              `/exports/entries.csv?period=${period}&status=${statusFilter}`,
              `OT-${period}.csv`,
            )}
          >
            ส่งออกรายรายการ (CSV)
          </button>
          <button
            className="btn ghost"
            onClick={() => api.download(
              `/exports/monthly.csv?period=${period}&status=${statusFilter}`,
              `OT-monthly-${period}.csv`,
            )}
          >
            ส่งออกสรุปรายเดือน (CSV)
          </button>
          <div style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
            ไฟล์ CSV บันทึกด้วย UTF-8 BOM เปิดใน Excel ภาษาไทยได้ทันที
          </div>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="card">
        {!data ? (
          <Empty>กำลังโหลด…</Empty>
        ) : data.employees.length === 0 ? (
          <Empty>ไม่มีรายการในเดือนนี้</Empty>
        ) : (
          <>
            {/* Above the table, not beside a row: what it warns about is the
                total at the bottom of it, and a reviewer who has started
                reading rows has already begun trusting them. */}
            <PolicyVersionBanner spread={data.policy} />

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>พนักงาน</th>
                    <th>แผนก</th>
                    <th className="num">×1.5 ปกติ</th>
                    <th className="num">×1.5 วันหยุด</th>
                    <th className="num">×3</th>
                    <th className="num">รวม ชม.</th>
                    <th className="num">รายการ</th>
                    <th className="num">แก้ไข</th>
                    <th>กฎที่ใช้</th>
                    <th>เพดาน</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((row) => (
                    <tr key={row.employee._id}>
                      <td>
                        {row.employee.name}
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{row.employee.code}</div>
                      </td>
                      <td>{row.department?.nameTh || row.department?.name}</td>
                      <td className="num">{hours(row.summary.buckets[BUCKETS.OT15_WEEKDAY])}</td>
                      <td className="num">{hours(row.summary.buckets[BUCKETS.OT15_HOLIDAY])}</td>
                      <td className="num">{hours(row.summary.buckets[BUCKETS.OT3_HOLIDAY])}</td>
                      <td className="num"><strong>{hours(row.summary.otHours)}</strong></td>
                      <td className="num">
                        {row.entryCount}
                        {row.pendingCount > 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>ค้าง {row.pendingCount}</div>
                        )}
                      </td>
                      {/* A row of hours says nothing about whether they are the
                          ones the employee filed. This is where a month that
                          was corrected after the fact announces itself, before
                          HR signs anything off. */}
                      <td className="num">
                        {row.edits?.count ? (
                          <button
                            className="btn ghost sm"
                            onClick={() => setAuditing(row.employee)}
                            title="ดูว่าแก้ไขอะไร โดยใคร และค่าเดิมคืออะไร"
                          >
                            {row.edits.count} ครั้ง
                          </button>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                        {row.edits?.hrCount > 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                            ฝ่ายบุคคล {row.edits.hrCount}
                          </div>
                        )}
                      </td>
                      {/* Per person as well as per month: the month banner says
                          the sheet is not uniform, this says whose rows to open.
                          A version that spans one employee's own total is the
                          case HR can actually do something about. */}
                      <td><PolicyVersionSummaryCell spread={row.policy} /></td>
                      <td>
                        {row.cap.capHours == null ? (
                          <span style={{ color: 'var(--muted)' }}>ไม่กำหนด</span>
                        ) : (
                          <span style={{ color: row.cap.exceeded ? 'var(--danger-ink)' : 'inherit' }}>
                            {hours(row.cap.usedHours)} / {row.cap.capHours}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          <button
                            className="btn ghost sm"
                            onClick={() => setOpened(row.employee)}
                          >
                            ดู / แก้ไขรายการ
                          </button>
                          <button
                            className="btn ghost sm"
                            onClick={() => setPrinting({ employeeId: row.employee._id })}
                          >
                            พิมพ์ F-HR-027
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2}><strong>รวมทั้งหมด</strong></td>
                    <td className="num"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT15_WEEKDAY])}</strong></td>
                    <td className="num"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT15_HOLIDAY])}</strong></td>
                    <td className="num"><strong>{hours(data.grandTotal.buckets[BUCKETS.OT3_HOLIDAY])}</strong></td>
                    <td className="num"><strong>{hours(data.grandTotal.otHours)}</strong></td>
                    <td colSpan={5} />
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="hint" style={{ marginTop: 12 }}>
              สรุปสำหรับฝ่ายบุคคล — OT × 1.5 = {hours(data.hrSection.ot15)} ชม. ·
              {' '}OT × 3 = {hours(data.hrSection.ot3)} ชม. ·
              {' '}รวม {hours(data.hrSection.total)} ชม.
              {data.hrSection.basis === 'raw' ? ' (ชั่วโมงดิบ ยังไม่คูณอัตรา)' : ' (คูณอัตราแล้ว)'}
            </div>

            {/* Same rule as the printed form, said on the screen the form is
                reached from — so a total here and a total there never differ
                without an explanation attached to both. */}
            {data.supersededCount > 0 && (
              <div className="hint" style={{ marginTop: 6 }}>
                ไม่นับ {data.supersededCount} รายการที่ซ้ำช่วงเวลาเดิม ·
                {' '}เมื่อกรอกวันและเวลาเดียวกันซ้ำ ระบบนับเฉพาะรายการที่กรอกล่าสุด ·
                {' '}เปิดใบ F-HR-027 ของพนักงานเพื่อดูว่าเป็นรายการใด
              </div>
            )}

            {/* An employee with no วันเกิด on record is computed as though no
                weekday of theirs was ever a holiday, which looks identical to
                an employee whose birthday fell on a Sunday.

                Only while the rule is OFF. Once it is on, the same gap is said
                by the birthday check below — in the list of people whose month
                cannot be checked — and saying it twice on one screen makes both
                copies easier to skip. */}
            {data.birthDates?.missing > 0 && !data.birthDates.ruleEnabled && (
              <Alert kind="info">
                {`ยังไม่มีวันเกิดของพนักงาน ${data.birthDates.missing} คนในระบบ — กรอกให้ครบก่อนเปิดกฎวันหยุดวันเกิด จะได้ไม่ต้องคำนวณย้อนหลัง`}
                <div style={{ marginTop: 4 }}>
                  {data.birthDates.missingFor.map((e) => `${e.code} ${e.name}`).join(' · ')}
                </div>
                <div style={{ marginTop: 4, fontSize: 11.5 }}>
                  เพิ่มวันเกิดได้ที่หน้า ผู้ดูแลระบบ › พนักงาน (เฉพาะ Admin)
                </div>
              </Alert>
            )}

            {/* วันเกิดที่ยังไม่มีใบ — a list to read, at the foot of the month
                it is about. HR and Admin only; the endpoint refuses หัวหน้า, who
                may open this screen for their own team. */}
            <BirthdayCheck period={period} user={user} />
          </>
        )}
      </div>
    </>
  );
}

/**
 * วันเกิดที่ยังไม่มีใบ — the month's unclaimed birthday holidays, and the people
 * whose month cannot be checked at all.
 *
 * A LIST, NOT A WARNING. Nothing here is an error: not working on your birthday
 * is the ordinary case, and most names on this list will have a perfectly good
 * reason to be there. So it is drawn in the neutral `box`, with no red, no amber
 * and no count in a badge — the tone the screen takes is part of what it says.
 * What the section is for is the asymmetry the rule creates: a birthday on a
 * Tuesday is a holiday that looks exactly like a working day, so it is the one
 * kind of holiday an employee forgets to claim. A Saturday announces itself.
 *
 * NO BUTTON TO FILE. ฝ่ายบุคคล cannot know whether somebody was at work or until
 * what hour, and hours invented from a calendar are precisely what this system
 * must not contain. Each row names the หัวหน้า of that person's department
 * instead — they can answer both questions and they already have the path in
 * (บันทึก OT แทนลูกทีม, on their own queue).
 *
 * Silent when there is nothing to say, and silent when the rule is off — a
 * section that renders "0 คน" every month is a section nobody reads. The one
 * thing it will not do is stay silent about a roster it cannot check: that is the
 * second list.
 */
function BirthdayCheck({ period, user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const mayRead = ['hr', 'admin'].includes(user?.role);

  useEffect(() => {
    if (!mayRead) return undefined;
    let live = true;
    setData(null);
    api.get(`/reports/birthday-check/${period}`)
      .then((res) => { if (live) { setData(res); setError(''); } })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [period, mayRead]);

  if (!mayRead) return null;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data || !data.ruleEnabled) return null;
  if (data.needsEntry.length === 0 && data.uncheckable.length === 0) return null;

  return (
    <div className="box" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600 }}>วันเกิดที่ยังไม่มีใบ</div>
      <div className="hint" style={{ marginTop: 2 }}>
        วันเกิดที่ตรงจันทร์–ศุกร์ นับเป็นวันหยุดเฉพาะคนนั้น แต่วันนั้นดูเหมือนวันทำงานปกติ
        {' '}พนักงานจึงลืมยื่นได้ง่าย — <strong>รายการนี้ไว้ตรวจ ไม่ใช่ข้อผิดพลาด</strong>
        {' '}(ไม่มาทำงานวันเกิดก็เป็นเรื่องปกติ) · ถ้าเขามาทำงานจริง
        {' '}ให้หัวหน้าแผนกเป็นผู้บันทึกแทนจากหน้าคิวของหัวหน้า — ฝ่ายบุคคลไม่ทราบว่าเขามาทำงานถึงกี่โมง
      </div>

      {data.needsEntry.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="mini">
            <thead>
              <tr>
                <th>พนักงาน</th>
                <th>แผนก</th>
                <th>วันเกิด (วันหยุดของเขา)</th>
                <th>บริษัท</th>
                <th>หัวหน้าที่บันทึกแทนได้</th>
              </tr>
            </thead>
            <tbody>
              {data.needsEntry.map((r) => (
                <tr key={r.employeeId + r.date}>
                  <td>
                    {r.name}
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.code}</div>
                  </td>
                  <td>{r.department || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {thaiDate(r.date)} (วัน{dayName(r.date)})
                    {/* A day that has not arrived is on the list to see, not to
                        ring anybody about. */}
                    {r.upcoming && (
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ยังไม่ถึงวัน</div>
                    )}
                  </td>
                  <td>{companyLabel(r.company)}</td>
                  <td>
                    {r.managers.length > 0
                      ? r.managers.map((m) => m.name).join(' · ')
                      : <span style={{ color: 'var(--muted)' }}>ยังไม่มีหัวหน้าในแผนกนี้</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* "ตรวจไม่ได้" is a different answer from "nothing missing", and a roster
          that is still mostly empty must not read as a clean month. */}
      {data.uncheckable.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            ไม่มีข้อมูลวันเกิด ตรวจไม่ได้ — {data.uncheckable.length} คน
          </div>
          <div className="hint" style={{ marginTop: 2 }}>
            คนเหล่านี้ยังไม่ถูกตรวจว่ามีวันเกิดตรงวันทำงานหรือไม่ ·
            {' '}เพิ่มวันเกิดได้ที่หน้า ผู้ดูแลระบบ › พนักงาน (เฉพาะ Admin)
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5 }}>
            {data.uncheckable.map((r) => (
              <div key={r.employeeId}>
                {r.code} {r.name}
                <span style={{ color: 'var(--muted)' }}>
                  {' '}· {r.department || '—'} · {companyLabel(r.company)}
                  {r.reason === 'invalid' ? ` · ${UNCHECKABLE.invalid}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

