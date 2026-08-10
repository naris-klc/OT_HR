'use client';

import React, { useEffect, useState } from 'react';
import {
  api, hours, thaiDate, dayName, currentPeriod, periodLabel, BUCKETS, companyLabel,
} from '@/lib/api.js';
import { UNCHECKABLE, OUTCOME } from '@/lib/birthdayCheck.js';
import { Alert, Empty, Modal } from './common.jsx';
import { PolicyVersionBanner, PolicyVersionSummaryCell } from './PolicyVersion.jsx';
import PrintForm from './PrintForm.jsx';
import HrEntries from './HrEntries.jsx';
import HrEdits from './HrEdits.jsx';
import OtForm from './OtForm.jsx';
import { useToast } from './Toast.jsx';
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
  /**
   * A row of วันเกิดที่ยังไม่มีใบ being turned into a ใบ.
   *
   * Held here rather than inside the section it is opened from, so that it
   * replaces the page through the same early return the other three sub-views
   * use — and so it gets the same hardware-back handling. A form this
   * consequential inside a pop-up inside a section at the foot of a long table
   * is a form somebody fills in without seeing what else is on screen.
   */
  const [filingBirthday, setFilingBirthday] = useState(null);
  /** Bumped to make the birthday section reload after either button. */
  const [birthdaySignal, setBirthdaySignal] = useState(0);
  const toast = useToast();

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
  useBackHandler(Boolean(filingBirthday), () => setFilingBirthday(null));

  if (filingBirthday) {
    return (
      <OtForm
        mode="birthday"
        birthday={filingBirthday}
        onCancel={() => setFilingBirthday(null)}
        onSaved={(res) => {
          const who = filingBirthday.name;
          setFilingBirthday(null);
          setBirthdaySignal((n) => n + 1);
          load();
          toast(res?.direct
            ? `บันทึกและอนุมัติ OT วันเกิดของ ${who} แล้ว — บันทึกไว้ว่าคุณเป็นทั้งผู้กรอกและผู้อนุมัติ`
            : `บันทึก OT วันเกิดของ ${who} แล้ว — รออนุมัติตามคิวปกติ`);
        }}
      />
    );
  }

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
                        {/* Hours nobody in this department approved. On a
                            หัวหน้า's สรุปทีม this is the whole explanation for a
                            total that moved while their queue stayed empty; on
                            HR's it says which rows carry a single signature.
                            Absent from every ordinary month. */}
                        {row.hrVerified > 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
                            HR อนุมัติชั้นเดียว {row.hrVerified}
                          </div>
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

            {/*
              Said once, above the marks it explains, and worded for whoever is
              reading it.

              A หัวหน้า opening สรุปทีม is the reason this exists: their team's
              hours went up and their queue never rang, because ฝ่ายบุคคล settled
              a birthday from the scan record in one act. Left unexplained that
              is a discrepancy they cannot resolve from any screen they have —
              the entry is `approved` and was never in their queue to remember.
              Nothing here is wrong, which is why it is neutral rather than a
              warning; what it is, is the one thing on the page they could not
              have known.
            */}
            {data.hrVerifiedCount > 0 && (
              <div className="hint" style={{ marginTop: 6 }}>
                {`เดือนนี้มี ${data.hrVerifiedCount} รายการที่ฝ่ายบุคคลบันทึกและอนุมัติในขั้นตอนเดียว`}
                {' '}จากรายการวันเกิดด้านล่าง โดยตรวจเวลาเข้า-ออกจากบันทึกสแกนนิ้ว ·
                {' '}<strong>ไม่ได้ผ่านการอนุมัติของหัวหน้างาน</strong> และช่องลายเซ็นหัวหน้าในประวัติรายการจะว่างไว้ตามจริง ·
                {' '}เปิด “ดู / แก้ไขรายการ” ของพนักงานเพื่อดูว่าเป็นรายการใด — จะมีป้าย “HR ตรวจสแกนนิ้ว” กำกับ
              </div>
            )}

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

          </>
        )}

        {/*
          วันเกิดที่ยังไม่มีใบ — at the foot of the month it is about, and now a
          list that can be settled rather than only read.

          OUTSIDE the "does this month have entries" branch, deliberately. It
          used to sit inside it, which meant a month where nobody filed any OT
          printed "ไม่มีรายการในเดือนนี้" and nothing else — and that is exactly
          the month where an unclaimed birthday holiday is most likely and least
          visible. The section has its own silence rule (nothing to show, or the
          rule off) and does not need a second one imposed by the table above it.

          ฝ่ายบุคคล for everybody; a หัวหน้า, or their stand-in, for their own
          team — the same scope the rest of this screen already has.
        */}
        {data && (
          <BirthdayCheck
            period={period}
            signal={birthdaySignal}
            onFile={setFilingBirthday}
            onChanged={() => { setBirthdaySignal((n) => n + 1); load(); }}
          />
        )}
      </div>
    </>
  );
}

/**
 * วันเกิดที่ยังไม่มีใบ — the month's unanswered birthday holidays, settled here.
 *
 * A LIST, NOT A WARNING. Nothing here is an error: not working on your birthday
 * is the ordinary case, and most names on this list will have a perfectly good
 * reason to be there. So it is drawn in the neutral `box`, with no red and no
 * count in a badge — the tone the screen takes is part of what it says. What the
 * section is for is the asymmetry the rule creates: a birthday on a Tuesday is a
 * holiday that looks exactly like a working day, so it is the one kind of holiday
 * an employee forgets to claim. A Saturday announces itself.
 *
 * IT USED TO SAY THE OPPOSITE OF WHAT IS TRUE. The old copy told the reader to
 * send this to the หัวหน้า "เพราะฝ่ายบุคคลไม่ทราบว่าเขามาทำงานถึงกี่โมง". That
 * was never the situation in this office: HR opens the fingerprint scanner's own
 * export and reads the in and out times for that person on that date — the same
 * times a หัวหน้า would be repeating down the phone. So the sentence is gone and
 * both answers are here, one press each. The หัวหน้า can still settle their own
 * team's rows, and still file through the ordinary proxy path when they prefer.
 *
 * TWO GROUPS, AND ONLY THE FIRST HAS BUTTONS. A birthday that has not arrived
 * has no scan record to check against, so there is nothing to compare and
 * nothing to press — those rows are shown and left alone. The split is the
 * server's (`birthdayCheck` against Asia/Bangkok's date), not a comparison made
 * in the browser against whatever the laptop's clock says.
 *
 * Silent when there is nothing to say, and silent when the rule is off — a
 * section that renders "0 คน" every month is a section nobody reads. The one
 * thing it will not do is stay silent about a roster it cannot check: that is the
 * third list.
 */
function BirthdayCheck({ period, signal = 0, onFile, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  /** The row a "ไม่ได้มาทำงาน" is being recorded against. */
  const [marking, setMarking] = useState(null);
  const toast = useToast();

  /**
   * No role test here, deliberately.
   *
   * Who may read this list is the server's decision — ฝ่ายบุคคล for everybody, a
   * หัวหน้า and their stand-in for their own team — and it is made by the same
   * function the two write routes refuse with. A second copy of it in the
   * browser is how a screen ends up hiding a section somebody is entitled to, or
   * showing one that 403s. A caller with no claim gets an error, which is drawn.
   */
  useEffect(() => {
    let live = true;
    setData(null);
    api.get(`/reports/birthday-check/${period}`)
      .then((res) => { if (live) { setData(res); setError(''); } })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [period, signal]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data || !data.ruleEnabled) return null;
  const nothing = data.needsEntry.length === 0
    && data.upcoming.length === 0
    && data.absent.length === 0
    && data.uncheckable.length === 0;
  if (nothing) return null;

  async function retract(r) {
    try {
      await api.post('/birthday/checks', {
        employeeId: r.employeeId, workDate: r.date, outcome: OUTCOME.CANCELLED,
      });
      toast(`ยกเลิกการบันทึกของ ${r.name} แล้ว — ชื่อกลับมาอยู่ในรายการที่ต้องตรวจ`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="box" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600 }}>วันเกิดที่ยังไม่มีใบ</div>
      <div className="hint" style={{ marginTop: 2 }}>
        วันเกิดที่ตรงจันทร์–ศุกร์ นับเป็นวันหยุดเฉพาะคนนั้น แต่วันนั้นดูเหมือนวันทำงานปกติ
        {' '}พนักงานจึงลืมยื่นได้ง่าย — <strong>รายการนี้ไว้ตรวจ ไม่ใช่ข้อผิดพลาด</strong>
        {' '}(ไม่มาทำงานวันเกิดก็เป็นเรื่องปกติ)
        <div style={{ marginTop: 4 }}>
          เปิดโปรแกรมสแกนนิ้วดูเวลาเข้า-ออกของวันนั้น แล้วตอบได้เลยจากหน้านี้ —
          {' '}<strong>“บันทึก OT ให้”</strong> ถ้าเขามาทำงาน (กรอกเวลาที่อ่านได้ ระบบคำนวณชั่วโมงเอง)
          {' '}หรือ <strong>“ไม่ได้มาทำงาน”</strong> ถ้าไม่มีการสแกน ·
          {' '}หัวหน้าแผนกบันทึกแทนลูกทีมของตนเองได้เช่นกัน ทั้งจากหน้านี้และจากหน้าคิวของหัวหน้า
        </div>
      </div>

      {data.needsEntry.length > 0 && (
        <>
          <div className="kicker-sm" style={{ marginTop: 12 }}>
            ต้องตรวจ — {data.needsEntry.length} รายการ
          </div>
          <div className="table-wrap" style={{ marginTop: 6 }}>
            <table className="mini">
              <thead>
                <tr>
                  <th>พนักงาน</th>
                  <th>แผนก</th>
                  <th>วันเกิด (วันหยุดของเขา)</th>
                  <th>บริษัท</th>
                  <th>หัวหน้าที่บันทึกแทนได้</th>
                  <th />
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
                    </td>
                    <td>{companyLabel(r.company)}</td>
                    <td>
                      {r.managers.length > 0
                        ? r.managers.map((m) => m.name).join(' · ')
                        : <span style={{ color: 'var(--muted)' }}>ยังไม่มีหัวหน้าในแผนกนี้</span>}
                    </td>
                    <td>
                      {/* `canAct` is the server's answer, over the same rule the
                          write routes enforce — not a role test made here. */}
                      {r.canAct ? (
                        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          <button
                            className="btn ghost sm"
                            onClick={() => onFile?.({
                              employeeId: r.employeeId, name: r.name, code: r.code, date: r.date,
                            })}
                            title="กรอกเวลาเข้า-ออกที่อ่านจากบันทึกสแกนนิ้ว — ระบบคำนวณชั่วโมงและอัตราให้เอง"
                          >
                            บันทึก OT ให้
                          </button>
                          <button
                            className="btn ghost sm"
                            onClick={() => setMarking(r)}
                            title="บันทึกว่าวันนั้นเขาไม่ได้มาทำงาน — ไม่ใช่ใบ OT ไม่มีชั่วโมง ไม่เข้ารายงานใด และยกเลิกได้"
                          >
                            ไม่ได้มาทำงาน
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่ใช่แผนกของคุณ</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Nothing to press: the shift has not happened, so there is no scan
          record to compare against and no honest answer to give yet. Shown
          anyway — HR reads the month ahead, and a name that appears out of
          nowhere on the 30th is a name nobody planned for. */}
      {data.upcoming.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="kicker-sm">กำลังจะถึง — {data.upcoming.length} รายการ</div>
          <div className="hint" style={{ marginTop: 2 }}>
            วันเกิดยังไม่ถึง จึงยังไม่มีบันทึกเวลาเข้า-ออกงานให้เทียบ — ดูอย่างเดียว
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5 }}>
            {data.upcoming.map((r) => (
              <div key={r.employeeId + r.date}>
                {thaiDate(r.date)} (วัน{dayName(r.date)}) · {r.code} {r.name}
                <span style={{ color: 'var(--muted)' }}>
                  {' '}· {r.department || '—'} · {companyLabel(r.company)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Already answered — and the ONLY place the answer can be taken back.
          A checked row leaves the three lists above by design; if it left the
          screen as well, an append-only record would be one nobody could
          append the retraction to. */}
      {data.absent.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="kicker-sm">ตรวจแล้ว · ไม่ได้มาทำงาน — {data.absent.length} รายการ</div>
          <div className="hint" style={{ marginTop: 2 }}>
            ไม่ใช่ใบ OT · ไม่มีชั่วโมง ไม่เข้ารายงานใด และไม่นับรวมในเพดานแผนก
          </div>
          <div className="table-wrap" style={{ marginTop: 6 }}>
            <table className="mini">
              <thead>
                <tr>
                  <th>พนักงาน</th>
                  <th>วันเกิด</th>
                  <th>ผู้บันทึก</th>
                  <th>หมายเหตุ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.absent.map((r) => (
                  <tr key={r.employeeId + r.date}>
                    <td>
                      {r.name}
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.code}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{thaiDate(r.date)}</td>
                    <td>
                      {r.checkedByName || '—'}
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {r.checkedAt ? new Date(r.checkedAt).toLocaleString('th-TH') : ''}
                      </div>
                    </td>
                    <td>{r.note || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td>
                      {r.canAct && (
                        <button
                          className="btn ghost sm"
                          onClick={() => retract(r)}
                          title="เขียนแถวใหม่ทับความหมายเดิม ไม่ลบของเดิม — ชื่อจะกลับมาขึ้นรายการที่ต้องตรวจ"
                        >
                          ยกเลิกการบันทึก
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {marking && (
        <AbsentModal
          row={marking}
          onClose={() => setMarking(null)}
          onDone={() => { setMarking(null); onChanged?.(); }}
        />
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

/**
 * ไม่ได้มาทำงาน — the second answer, with a stop in front of it.
 *
 * A stop, and a short one. What is being recorded is not a refusal and costs
 * nobody anything: it says the scan record shows no attendance that day, which
 * is the ordinary case. But it takes a name off a list other people are working
 * from, so it names who is about to be marked and for which date, and it says in
 * one line what the record is and is not — because "ไม่ได้มาทำงาน" beside an OT
 * screen reads, at a glance, like something that might affect somebody's pay.
 *
 * The note is optional on purpose, matching `cancelPermission`'s reasoning about
 * withdrawing a generated row: a reason is owed for changing what somebody else
 * established, and this establishes nothing about anybody's hours. Requiring one
 * buys a field full of "ไม่มา" and a slower check.
 */
function AbsentModal({ row, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.post('/birthday/checks', {
        employeeId: row.employeeId,
        workDate: row.date,
        outcome: OUTCOME.ABSENT,
        note: note.trim(),
      });
      toast(`บันทึกแล้วว่า ${row.name} ไม่ได้มาทำงานวันที่ ${thaiDate(row.date)} — ยกเลิกได้ภายหลัง`);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="บันทึกว่าไม่ได้มาทำงาน"
      subtitle={`${row.name} · ${row.code} · ${thaiDate(row.date)} (วัน${dayName(row.date)})`}
      onClose={onClose}
      dirty={note.trim().length > 0}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button className="btn" disabled={busy} onClick={save}>บันทึก</button>
        </>
      )}
    >
      <Alert kind="info">
        รายการนี้<strong>ไม่ใช่ใบ OT</strong> — ไม่มีชั่วโมง ไม่มีสถานะอนุมัติ
        {' '}ไม่เข้ารายงานใด ๆ และไม่นับรวมในเพดานแผนก ·
        {' '}ผลของมันคือชื่อนี้จะหายไปจากรายการวันเกิดของเดือนนี้ เพื่อไม่ให้คนอื่นตรวจซ้ำ
        <div style={{ marginTop: 4, fontSize: 12.5 }}>
          ระบบเก็บไว้ว่า<strong>ใครเป็นผู้บันทึกและบันทึกเมื่อใด</strong> ·
          {' '}ถ้าบันทึกผิด กด “ยกเลิกการบันทึก” ได้ — ระบบจะเขียนแถวใหม่ทับความหมายเดิม
          {' '}โดยไม่ลบของเดิมทิ้ง และชื่อจะกลับมาขึ้นรายการอีกครั้ง
        </div>
      </Alert>

      <div className="field">
        <label>หมายเหตุ</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="เช่น ลาพักร้อน · ไม่มีการสแกนเข้า-ออกในวันนั้น"
        />
        <span className="field-note">ไม่บังคับ — ถ้ากรอก จะเก็บไว้คู่กับชื่อผู้บันทึก</span>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
    </Modal>
  );
}

