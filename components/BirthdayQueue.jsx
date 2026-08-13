'use client';

import React, { useEffect, useState } from 'react';
import { api, thaiDate, dayName, companyLabel, periodLabel } from '@/lib/api.js';
import { UNCHECKABLE } from '@/lib/birthdayCheck.js';
import { Alert, Empty, AddBirthDateHint } from './common.jsx';
import { AbsentModal, BirthdayFileForm, useRetractCheck } from './birthdayActions.jsx';
import { useBackHandler } from './nav.jsx';

/**
 * วันเกิดรอตรวจ — a queue, and everything about it follows from that word.
 *
 * WHAT IT IS FOR. A birthday falling Mon–Fri is a holiday for one person, and the
 * day looks exactly like a working day: same shift, same colleagues, nothing on
 * any calendar. So the request goes unfiled — unlike a Saturday, which announces
 * itself. Somebody has to go and ask, and the asking is answered from here: HR
 * opens the fingerprint scanner's export, reads the in and out times for that
 * date, and presses one of two buttons.
 *
 * WHY IT MOVED. It used to sit at the foot of ตรวจสอบรายเดือน, below a long
 * report, and it followed that screen's month picker. Both were wrong. A queue at
 * the bottom of a report is a queue you have to remember to scroll to; a queue
 * scoped to a month empties itself when somebody changes a dropdown, so a
 * birthday overlooked in August disappeared the moment anybody looked at
 * September — the rows waiting longest were the ones hardest to see. This list is
 * NOT scoped to a month. It is everything outstanding, oldest first, with the
 * age on every row.
 *
 * WHAT IS NOT IN IT. "กำลังจะถึง" — a birthday whose date has not arrived — is
 * folded away at the foot rather than listed, and counted nowhere. There is no
 * scan record for a shift that has not happened, so there is nothing to press and
 * nothing to decide; a queue whose count includes rows nobody can act on is a
 * count that stops meaning anything. It is kept rather than cut because it is the
 * only forward view there is: a roster gap ("ไม่มีข้อมูลวันเกิด") is worth fixing
 * BEFORE the day arrives, and folded it costs one line.
 *
 * It is still a list, not a warning. Not working on your birthday is the ordinary
 * case, and most names here will have a perfectly good reason to be there.
 */
export default function BirthdayQueue({ onCountChange, onOpenRoster = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [marking, setMarking] = useState(null);
  /** A row being turned into a ใบ — replaces the screen, like HrView's sub-views. */
  const [filing, setFiling] = useState(null);
  const [showUpcoming, setShowUpcoming] = useState(false);

  async function load() {
    try {
      const res = await api.get('/birthday/queue');
      setData(res);
      setError('');
      onCountChange?.(res.needsEntry.length);
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, []);
  useBackHandler(Boolean(filing), () => setFiling(null));

  // Both actions come from components/birthdayActions.jsx — the month table on
  // ตรวจสอบรายเดือน offers the same pair, and a dialog explaining a stored record
  // must not have two wordings on two screens.
  const retract = useRetractCheck(() => load(), setError);

  if (filing) {
    return (
      <BirthdayFileForm
        birthday={filing}
        onCancel={() => setFiling(null)}
        onSaved={() => { setFiling(null); load(); }}
      />
    );
  }

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Empty>กำลังโหลด…</Empty>;

  if (!data.ruleEnabled) {
    return (
      <Empty>
        กฎวันหยุดวันเกิดปิดอยู่ — วันเกิดนับเป็นวันทำงานปกติ จึงไม่มีอะไรต้องตรวจ
      </Empty>
    );
  }

  const { needsEntry, upcoming, absent, uncheckable, window } = data;

  return (
    <div className="card flush">
      <div className="card-head">
        <div>
          <div className="t">วันเกิดรอตรวจ</div>
          <div className="hint" style={{ margin: '3px 0 0' }}>
            วันเกิดที่ตรงจันทร์–ศุกร์ นับเป็นวันหยุดเฉพาะคนนั้น แต่วันนั้นดูเหมือนวันทำงานปกติ
            {' '}พนักงานจึงลืมยื่นได้ง่าย — <strong>คิวนี้ไม่ผูกกับเดือน</strong>
            {' '}ค้างจากเดือนไหนก็ยังอยู่ตรงนี้ เรียงเก่าสุดขึ้นก่อน
          </div>
        </div>
        {needsEntry.length > 0 && (
          <span className="chip muted">{needsEntry.length} รายการ</span>
        )}
      </div>

      <div style={{ padding: '0 18px' }}>
        <div className="hint">
          เปิดโปรแกรมสแกนนิ้วดูเวลาเข้า-ออกของวันนั้น แล้วตอบได้เลยจากหน้านี้ —
          {' '}<strong>“บันทึก OT ให้”</strong> ถ้าเขามาทำงาน (กรอกเวลาที่อ่านได้ ระบบคำนวณชั่วโมงเอง)
          {' '}หรือ <strong>“ไม่ได้มาทำงาน”</strong> ถ้าไม่มีการสแกน ·
          {' '}หัวหน้าแผนกบันทึกแทนลูกทีมของตนเองได้เช่นกัน ทั้งจากหน้านี้และจากหน้าคิวของหัวหน้า
        </div>
        {/*
          The window, printed rather than assumed.

          A queue that quietly stops at some date reads as "you are up to date",
          which is the one thing a queue must never say falsely. Almost always
          the bound is the birthday rule's own start — before it was turned on no
          holiday was owed, so those months hold nothing to answer.
        */}
        {window && (
          <div className="hint" style={{ marginTop: 4 }}>
            แสดงย้อนหลังถึง {periodLabel(window.from)}
            {window.bound === 'rule' && ' — เท่าที่กฎวันหยุดวันเกิดเริ่มมีผล (ก่อนหน้านั้นไม่มีวันหยุดวันเกิดให้ตรวจ)'}
            {window.bound === 'cap' && ' — ย้อนหลังได้สูงสุด 12 เดือน อาจมีเก่ากว่านี้ที่ไม่ได้แสดง'}
            {window.bound === 'unversioned' && ' — ยังไม่มีบันทึกเวอร์ชันนโยบาย จึงแสดงได้เฉพาะเดือนปัจจุบัน (รัน migrate:policy-version เพื่อดูย้อนหลัง)'}
          </div>
        )}
        {error && <Alert kind="error">{error}</Alert>}
      </div>

      {needsEntry.length === 0 ? (
        <div className="empty cleared">
          <div className="tick">✓</div>
          <strong>ตรวจวันเกิดครบทุกรายการแล้ว</strong>
          <div className="hint" style={{ marginTop: 4 }}>
            ไม่มีวันเกิดที่ผ่านมาแล้วและยังไม่ได้ตอบ — รวมทุกเดือนในช่วงที่แสดง
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>พนักงาน</th>
                <th>แผนก</th>
                <th>วันหยุดวันเกิด</th>
                <th>ค้างมาแล้ว</th>
                <th>บริษัท</th>
                <th>หัวหน้าที่บันทึกแทนได้</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {needsEntry.map((r) => (
                <tr key={r.employeeId + r.date}>
                  <td>
                    {r.name}
                    <div className="cell-sub">{r.code}</div>
                  </td>
                  <td>{r.department || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {thaiDate(r.date)}
                    <div className="cell-sub">วัน{dayName(r.date)}</div>
                  </td>
                  {/*
                    The number that makes a backlog visible without anybody
                    subtracting dates. Amber past a fortnight — not because
                    anything is wrong (nothing here is), but because a month is
                    closed at the end of it and an unanswered birthday is what
                    stops สรุป OT ส่งบัญชี being final.
                  */}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ color: r.ageDays >= 14 ? 'var(--amber)' : 'inherit' }}>
                      {r.ageDays === 0 ? 'วันนี้' : `ค้าง ${r.ageDays} วัน`}
                    </span>
                  </td>
                  <td>{companyLabel(r.company)}</td>
                  <td>
                    {/* Who to ring to find out whether they came in — not who
                        may settle the row, which is ฝ่ายบุคคล on every row. */}
                    {r.managers.length > 0
                      ? r.managers.map((m) => m.name).join(' · ')
                      : <span style={{ color: 'var(--muted)' }}>ยังไม่มีหัวหน้าในแผนกนี้</span>}
                  </td>
                  <td>
                    {/* `canAct` is the server's answer, over the same rule the
                        write routes enforce — not a role test made here. */}
                    {r.canAct ? (
                      <div className="row-actions">
                        <button
                          className="btn sm"
                          onClick={() => setFiling({
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
                      <span className="cell-sub">ไม่ใช่แผนกของคุณ</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Already answered — and the ONLY place the answer can be taken back. A
          checked row leaves the queue by design; if it left the screen as well,
          an append-only record would be one nobody could append the retraction
          to. */}
      {absent.length > 0 && (
        <Fold
          title={`ตรวจแล้ว · ไม่ได้มาทำงาน — ${absent.length} รายการ`}
          hint="ไม่ใช่ใบ OT · ไม่มีชั่วโมง ไม่เข้ารายงานใด และไม่นับรวมในเพดานแผนก"
        >
          <div className="table-wrap">
            <table className="mini">
              <thead>
                <tr>
                  <th>พนักงาน</th>
                  <th>วันหยุดวันเกิด</th>
                  <th>ผู้บันทึก</th>
                  <th>หมายเหตุ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {absent.map((r) => (
                  <tr key={r.employeeId + r.date}>
                    <td>
                      {r.name}
                      <div className="cell-sub">{r.code}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{thaiDate(r.date)}</td>
                    <td>
                      {r.checkedByName || '—'}
                      <div className="cell-sub">
                        {r.checkedAt ? new Date(r.checkedAt).toLocaleString('th-TH') : ''}
                      </div>
                    </td>
                    <td>{r.note || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td>
                      {r.canAct && (
                        <button
                          className="btn ghost sm"
                          onClick={() => retract(r)}
                          title="เขียนแถวใหม่ทับความหมายเดิม ไม่ลบของเดิม — ชื่อจะกลับมาขึ้นคิว"
                        >
                          ยกเลิกการตรวจ
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
      )}

      {/* Nothing to press: the shift has not happened, so there is no scan record
          to compare against. Folded, and counted nowhere. */}
      {upcoming.length > 0 && (
        <Fold
          title={`กำลังจะถึง — ${upcoming.length} รายการ`}
          hint="วันเกิดยังไม่ถึง จึงยังไม่มีบันทึกเวลาเข้า-ออกงานให้เทียบ — ดูอย่างเดียว ไม่นับรวมในคิว"
          open={showUpcoming}
          onToggle={setShowUpcoming}
        >
          <div style={{ fontSize: 12.5 }}>
            {upcoming.map((r) => (
              <div key={r.employeeId + r.date}>
                {thaiDate(r.date)} (วัน{dayName(r.date)}) · {r.code} {r.name}
                <span style={{ color: 'var(--muted)' }}>
                  {' '}· {r.department || '—'} · {companyLabel(r.company)}
                </span>
              </div>
            ))}
          </div>
        </Fold>
      )}

      {/* "ตรวจไม่ได้" is a different answer from "nothing outstanding", and a
          roster that is still mostly empty must not read as a clean queue. Not
          folded: it is the one thing here somebody has to go and fix. */}
      {uncheckable.length > 0 && (
        <div style={{ padding: '0 18px 18px' }}>
          <div className="kicker-sm" style={{ marginTop: 12 }}>
            ไม่มีข้อมูลวันเกิด ตรวจไม่ได้ — {uncheckable.length} คน
          </div>
          <div className="hint" style={{ marginTop: 2 }}>
            คนเหล่านี้ยังไม่ถูกตรวจว่ามีวันเกิดตรงวันทำงานหรือไม่ ·
            {' '}<AddBirthDateHint onOpen={onOpenRoster} />
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5 }}>
            {uncheckable.map((r) => (
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

      {marking && (
        <AbsentModal
          row={marking}
          onClose={() => setMarking(null)}
          onDone={() => { setMarking(null); load(); }}
        />
      )}
    </div>
  );
}

/**
 * A section that is present but out of the way.
 *
 * Used for the two lists that are not work: what has already been answered, and
 * what cannot be answered yet. Folded rather than deleted because both have a
 * real use and neither should cost a row in a queue — and `<details>` keeps that
 * true with no state to get out of step when the list reloads underneath it.
 */
function Fold({ title, hint, children, open, onToggle }) {
  const controlled = typeof open === 'boolean';
  return (
    <details
      className="queue-fold"
      {...(controlled ? { open, onToggle: (e) => onToggle?.(e.currentTarget.open) } : {})}
    >
      <summary>{title}</summary>
      {hint && <div className="hint" style={{ margin: '2px 0 8px' }}>{hint}</div>}
      {children}
    </details>
  );
}
