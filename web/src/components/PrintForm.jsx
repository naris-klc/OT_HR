import React, { useEffect, useState } from 'react';
import { api, hours, BUCKETS } from '../api.js';
import { Alert } from './common.jsx';

/**
 * F-HR-027 Rev.4 rendered for print — one employee, one month (§10).
 *
 * The layout follows the paper form cell for cell: วันที่ 1–31 down the left,
 * เวลาทำ OT (จาก/ถึง), the three จำนวนชั่วโมง columns, รายละเอียดงานที่ทำ, and
 * two signature columns that stay empty for hand signing.
 *
 * Rows come from the server already segmented, so a session that ran from
 * Friday evening into Saturday morning appears on both dates with its hours in
 * the correct column. That is the whole reason the paper form has three hour
 * columns rather than one.
 */
export default function PrintForm({ employeeId, period, onClose }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = employeeId ? `?employee=${employeeId}` : '';
    api.get(`/reports/form/${period}${q}`)
      .then((res) => setForm(res.form))
      .catch((err) => setError(err.message));
  }, [employeeId, period]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!form) return <div className="empty">กำลังโหลด…</div>;

  const cell = (v) => (v ? hours(v) : '');

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => window.print()}>พิมพ์ / บันทึกเป็น PDF</button>
        {onClose && <button className="btn ghost" onClick={onClose}>ปิด</button>}
        <div style={{ flex: 1 }} />
        {/* The sheet itself carries nothing the paper form does not, so what
            the ฝ่ายบุคคล figures mean is said here instead of on the form. */}
        <div style={{ fontSize: 12.5, color: 'var(--muted)', alignSelf: 'center', textAlign: 'right' }}>
          ตั้งค่าการพิมพ์: A4 แนวตั้ง · ขอบกระดาษ “ค่าเริ่มต้น” · ไม่ต้องปรับขนาด · เปิด “กราฟิกพื้นหลัง” ให้แถบสีเหลืองติดมาด้วย
          <br />
          {form.hrSection.basis === 'multiplied'
            ? 'ช่องเฉพาะฝ่ายบุคคล: คูณอัตราแล้ว'
            : 'ช่องเฉพาะฝ่ายบุคคล: เป็นชั่วโมงดิบ ยังไม่คูณอัตรา'}
        </div>
      </div>

      <div className="f027-screen">
        <div className="f027">
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
                // full month and HR reads the blanks as "no OT that day".
                const sessions = row.sessions.length ? row.sessions : [null];
                return sessions.map((s, i) => (
                  <tr key={`${row.date}-${i}`}>
                    {i === 0 && <td className="c day" rowSpan={sessions.length}>{row.day}</td>}
                    <td className="c">{s?.from || ''}</td>
                    <td className="c">{s?.to || ''}</td>
                    <td className="n">{cell(s?.[BUCKETS.OT15_WEEKDAY])}</td>
                    <td className="n">{cell(s?.[BUCKETS.OT15_HOLIDAY])}</td>
                    <td className="n">{cell(s?.[BUCKETS.OT3_HOLIDAY])}</td>
                    <td className="desc" title={s?.description}>
                      {s?.description || ''}
                      {s?.continuedFromPreviousDay ? ' (ต่อจากคืนก่อน)' : ''}
                      {s?.noBreakTaken ? ' [ไม่พักเที่ยง]' : ''}
                    </td>
                    {i === 0 && <td className="sig" rowSpan={sessions.length} />}
                    {i === 0 && <td className="sig" rowSpan={sessions.length} />}
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
      </div>
    </>
  );
}
