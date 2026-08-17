'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { api, thaiDate } from '@/lib/api.js';
import { Alert, Empty, Field, Modal } from './common.jsx';
import { companyLabel } from '@/src/config/companies.js';
import { useToast } from './Toast.jsx';

/**
 * ผู้รับช่วงอนุมัติแทน — setting up, reading and ending a stand-in.
 *
 * One component, two placements, because the two callers are asking the same
 * question about different people. A หัวหน้า opens it on ข้อมูลส่วนตัว to
 * arrange their own cover; ฝ่ายบุคคล opens it under ตั้งค่าระบบ to arrange it
 * for a หัวหน้า who is already away — which is the case the whole feature is
 * for, and the reason `scope="all"` exists at all. Two screens would be two
 * versions of the same form, and the one used less often is the one that would
 * end up missing the rule that matters.
 */
export default function Delegation({ user, scope = 'mine' }) {
  const all = scope === 'all';
  const toast = useToast();

  const [rows, setRows] = useState(null);
  const [today, setToday] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** Whether มอบหมายผู้รับช่วง is open — the only way this screen creates one. */
  const [adding, setAdding] = useState(false);

  async function load() {
    try {
      const res = await api.get(`/delegations${all ? '?all=1' : ''}`);
      setRows(res.delegations);
      setToday(res.today);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [scope]);

  /**
   * Live first, then what has not started, then what is over.
   *
   * The order is the order the questions get asked: "who is covering my queue
   * right now" is answered by looking at the top of the list, and the expired
   * ones are kept because they are the evidence behind approvals already on
   * the record — a delegation that vanished when it lapsed would take the
   * answer to "why was B allowed to sign that" with it.
   */
  const groups = useMemo(() => {
    const order = { active: 0, scheduled: 1, expired: 2, revoked: 3 };
    return [...(rows || [])].sort((a, b) => (
      order[a.state] - order[b.state] || b.fromDate.localeCompare(a.fromDate)
    ));
  }, [rows]);

  async function revoke(row) {
    setBusy(true);
    try {
      await api.del(`/delegations/${row._id}`);
      await load();
      toast(`ยกเลิกการมอบหมายให้ ${row.to?.name} แล้ว`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const active = groups.filter((d) => d.state === 'active');

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h2>ผู้รับช่วงอนุมัติแทน</h2>
          <div className="hint" style={{ margin: 0 }}>
            {all
              ? 'ตั้งผู้รับช่วงอนุมัติแทนหัวหน้างานคนใดก็ได้ — ใช้เมื่อหัวหน้างานลากะทันหันจนตั้งเองไม่ได้'
              : 'ให้คนอื่นอนุมัติคิวของคุณแทนได้ชั่วคราว ระหว่างที่คุณไม่อยู่'}
          </div>
        </div>
        {/* One label, not two. The button used to say ปิดฟอร์ม while the form
            was open, which is a second way of closing something that already
            has a × and an Escape — and it was the one that threw away what had
            been typed without asking. */}
        <button className="btn" onClick={() => setAdding(true)}>มอบหมายผู้รับช่วง</button>
      </div>

      {/*
        On the card rather than in the dialog, because it is not about the form:
        it answers the two questions that come AFTER a delegation exists — "did
        I remember to turn it off" (there is nothing to turn off) and "can I
        still approve things myself" (yes, always). Both are asked by somebody
        looking at the table, with no form open.
      */}
      <Alert kind="info">
        การมอบหมาย<strong>หมดอายุเองตามวันที่กำหนด</strong> ไม่มีสวิตช์เปิด/ปิดที่ต้องกลับมาปิด ·
        {' '}และเป็นการ<strong>เพิ่ม</strong>สิทธิ์ ไม่ใช่ย้าย —
        {' '}หัวหน้างานเจ้าของคิวยังอนุมัติเองได้ตลอด ถ้ากลับมาก่อนกำหนดก็ไม่ต้องทำอะไร
        <div style={{ fontSize: 12.5, marginTop: 4 }}>
          ทุกการอนุมัติของผู้รับช่วงจะถูกบันทึกว่า “<strong>ทำแทน</strong>” พร้อมชื่อหัวหน้างานเจ้าของคิว
          {' '}ทั้งในประวัติรายการและบนใบพิมพ์ · ผู้รับช่วง<strong>มอบหมายต่อเป็นทอดไม่ได้</strong>
        </div>
      </Alert>

      {error && <Alert kind="error">{error}</Alert>}

      {!rows ? <Empty>กำลังโหลด…</Empty> : groups.length === 0 ? (
        <Empty>{all ? 'ยังไม่มีการมอบหมายในระบบ' : 'ยังไม่เคยมอบหมายผู้รับช่วง'}</Empty>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>สถานะ</th>
                <th>คิวของ</th>
                <th>ผู้รับช่วง</th>
                <th>ช่วงเวลา</th>
                <th>เหตุผล</th>
                <th>ผู้ตั้ง</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map((d) => (
                <tr key={d._id}>
                  <td><StateChip state={d.state} /></td>
                  <td>
                    {d.from?.name || '—'}
                    <div className="cell-sub">
                      {d.from?.code}
                      {d.from?.approvesCompany
                        ? ` · เฉพาะ${companyLabel(d.from.approvesCompany)}`
                        : ''}
                    </div>
                  </td>
                  <td>
                    {d.to?.name || '—'}
                    <div className="cell-sub">{d.to?.code} · {ROLE[d.to?.role] || d.to?.role}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {thaiDate(d.fromDate)} – {thaiDate(d.toDate)}
                    {d.state === 'active' && (
                      <div className="cell-sub">เหลืออีก {daysLeft(d.toDate, today)} วัน</div>
                    )}
                  </td>
                  <td style={{ maxWidth: 220 }}>{d.reason || '—'}</td>
                  <td>
                    {d.createdByName || '—'}
                    {d.revokedAt && (
                      <div className="cell-sub">ยกเลิกโดย {d.revokedByName || '—'}</div>
                    )}
                  </td>
                  <td>
                    {/* Only what is still going forward can be called off, and
                        only by the granter or ฝ่ายบุคคล — which the server
                        enforces; this just does not offer it. */}
                    {['active', 'scheduled'].includes(d.state)
                      && (all || d.from?.id === String(user.id || user._id)) && (
                      <button className="btn ghost sm" disabled={busy} onClick={() => revoke(d)}>
                        ยกเลิก
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active.length === 0 && rows?.length > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          ไม่มีการมอบหมายที่มีผลอยู่ในขณะนี้ — รายการด้านบนหมดอายุหรือถูกยกเลิกไปแล้ว
          {' '}และยังเก็บไว้เพราะเป็นหลักฐานของรายการที่อนุมัติไปภายใต้การมอบหมายนั้น
        </div>
      )}

      {adding && (
        <DelegationForm
          user={user}
          all={all}
          onClose={() => setAdding(false)}
          onSaved={async (row) => {
            setAdding(false);
            await load();
            toast(`มอบหมายให้ ${row.to?.name} อนุมัติแทน ${thaiDate(row.fromDate)} – ${thaiDate(row.toDate)} แล้ว`);
          }}
        />
      )}
    </div>
  );
}

// ── the form ────────────────────────────────────────────────────────────────

const BLANK_DELEGATION = { from: '', to: '', fromDate: '', toDate: '', reason: '' };

/**
 * มอบหมายผู้รับช่วง — the form, in a dialog.
 *
 * WHY A DIALOG, and it is the answer เพิ่มพนักงาน and เพิ่มแผนก already gave.
 * As a panel unfolding under the button it shared a card with the table of
 * existing delegations, so on a phone the two dates were typed with the card's
 * own hint, an info box and a table all still on screen — and the button that
 * opened it turned into ปิดฟอร์ม, a second way out that discarded everything
 * typed without asking. The dialog asks (`dirty`), and × / Escape / ยกเลิก all
 * go through the same question.
 *
 * The refusal stays in here too, rather than being handed up to the card
 * behind: หัวหน้างานคนนี้มีผู้รับช่วงอยู่แล้วในช่วงวันที่นี้ is a message about
 * the dates in the boxes, and it is no use next to a form that has closed.
 */
/**
 * WHAT IS BEING HANDED OVER, in words, before anybody presses บันทึก.
 *
 * A delegation is named after a PERSON — "somebody covers คุณวิชัย's queue" —
 * and for as long as a หัวหน้า covered their whole department those two readings
 * were the same thing. They are not the same once a signature can be scoped to
 * one payroll: the person picking a stand-in believes they have handed over
 * แผนกวิศวกรรม and has handed over half of it, and the half that was not covered
 * is a queue nobody is watching for the length of the leave.
 *
 * So the sentence is drawn from the granter's OWN scope, which is the same fact
 * `delegatedClaims` builds the borrowed queue from — one source, so the promise
 * on the screen and the rows the server will accept cannot come apart.
 */
function Handover({ granter, receiver }) {
  if (!granter) return null;
  const team = granter.department?.nameTh || granter.department?.name || 'แผนกของหัวหน้าคนนี้';
  const scope = granter.approvesCompany
    ? `เฉพาะพนักงาน${companyLabel(granter.approvesCompany)}`
    : 'พนักงานทุกบริษัท';

  return (
    <div className="hint" style={{ marginTop: 4 }}>
      สิทธิ์ที่กำลังมอบ: <strong>{team} · {scope}</strong>
      {receiver ? <> ให้ {receiver.name}</> : null}
      {granter.approvesCompany ? (
        <div style={{ marginTop: 4 }}>
          หัวหน้าคนนี้เซ็นให้เฉพาะ{companyLabel(granter.approvesCompany)} ผู้รับช่วงจึงได้เท่านั้นด้วย
          {' '}— คนของอีกบริษัทในแผนกเดียวกันไม่ได้รวมอยู่ในนี้
        </div>
      ) : null}
    </div>
  );
}

function DelegationForm({ user, all, onClose, onSaved }) {
  const [pool, setPool] = useState({ managers: [], candidates: [] });
  const [form, setForm] = useState(BLANK_DELEGATION);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * Its own endpoint, not the roster.
   *
   * A หัวหน้า is normally covered by a หัวหน้า from another department, and
   * `GET /employees` hands a manager their own team and nobody else — the
   * person they actually want would never be in the list.
   */
  useEffect(() => {
    api.get('/delegations/candidates')
      .then(setPool)
      .catch((err) => setError(err.message));
  }, []);

  const granter = all ? form.from : String(user.id || user._id);
  const managers = pool.managers;
  // Nobody stands in for themselves — taken off the list rather than left in
  // to be refused after the dates have been typed.
  const candidates = pool.candidates.filter((p) => String(p._id) !== String(granter));

  /**
   * The granter as the picker knows them — department and signing scope.
   *
   * Read off `pool.managers` rather than off `user`, so both modes of this form
   * get the answer from one place: ฝ่ายบุคคล picks a หัวหน้า from that list, and
   * a หัวหน้า setting up their own cover is in it too.
   */
  const granterInfo = managers.find((p) => String(p._id) === String(granter)) || null;
  const receiverInfo = pool.candidates.find((p) => String(p._id) === String(form.to)) || null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const ready = form.to && form.fromDate && form.toDate && (!all || form.from);
  const dirty = Object.keys(BLANK_DELEGATION).some((k) => form[k] !== BLANK_DELEGATION[k]);

  async function save() {
    setError('');
    setBusy(true);
    try {
      const res = await api.post('/delegations', {
        from: all ? form.from : undefined,
        to: form.to,
        fromDate: form.fromDate,
        toDate: form.toDate,
        reason: form.reason.trim() || undefined,
      });
      onSaved(res.delegation);
    } catch (err) {
      // Stays open, with both dates still in it — see the note on the component.
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="มอบหมายผู้รับช่วง"
      subtitle={all ? 'ตั้งผู้รับช่วงอนุมัติแทนหัวหน้างานหนึ่งคน' : 'ให้คนอื่นอนุมัติคิวของคุณแทนชั่วคราว'}
      onClose={onClose}
      dirty={dirty && !busy}
      footer={(requestClose) => (
        <>
          <button className="btn ghost" onClick={requestClose} disabled={busy}>ยกเลิก</button>
          <button className="btn" onClick={save} disabled={!ready || busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึกการมอบหมาย'}
          </button>
        </>
      )}
    >
      {error && <Alert kind="error">{error}</Alert>}

      <div className="edit-form">
        <section className="form-group">
          <div className="gh">ใคร</div>
          <div className="form-grid">
            {all && (
              <Field
                label="คิวของหัวหน้างาน"
                tip="คิวที่จะถูกอนุมัติแทน — หัวหน้างานคนนี้ยังอนุมัติเองได้ตามปกติ"
              >
                <select value={form.from} onChange={(e) => set('from', e.target.value)} disabled={busy}>
                  <option value="">— เลือกหัวหน้างาน —</option>
                  {managers.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name} · {p.department?.nameTh || p.department?.name || '—'}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="ผู้รับช่วง" note="เลือกได้เฉพาะหัวหน้างานหรือฝ่ายบุคคล">
              <select value={form.to} onChange={(e) => set('to', e.target.value)} disabled={busy}>
                <option value="">— เลือกผู้รับช่วง —</option>
                {candidates.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} · {ROLE[p.role]} · {p.department?.nameTh || p.department?.name || '—'}
                    {p.approvesCompany ? ` · เซ็นให้${companyLabel(p.approvesCompany)}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {/* Out of the grid and full width: it is a sentence, and a sentence in
              a 1fr column wraps four times. */}
          <Handover granter={granterInfo} receiver={receiverInfo} />
        </section>

        {/*
          The two dates in one `.form-grid`, which is the whole of the
          alignment fix.

          They were a `.row`, and `.row` is `align-items: flex-end` — so the
          two boxes were hung from the BOTTOM of their fields, and ถึงวันที่
          carries a note that ตั้งแต่วันที่ does not. The note's two lines
          pushed that box and its label upward, leaving a pair of date boxes
          that are the same size and the same kind of thing sitting at two
          different heights. `.form-grid` starts them together instead
          (`align-items: start`) and gives each an equal 1fr column, so the
          boxes line up at the top whatever is written underneath either of
          them — the same fix already made for วันเกิด/อีเมล in เพิ่มพนักงาน.
        */}
        <section className="form-group">
          <div className="gh">ช่วงเวลา</div>
          <div className="form-grid">
            <Field label="ตั้งแต่วันที่">
              <input
                type="date"
                value={form.fromDate}
                onChange={(e) => set('fromDate', e.target.value)}
                disabled={busy}
              />
            </Field>
            <Field label="ถึงวันที่" note="นับรวมวันสุดท้าย · หมดอายุเองหลังจากนั้น">
              <input
                type="date"
                value={form.toDate}
                onChange={(e) => set('toDate', e.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
        </section>

        <section className="form-group">
          <div className="gh">เหตุผล</div>
          <div className="form-grid">
            <Field label="เหตุผล" tip="ไม่บังคับ · แสดงในตารางด้านหลัง เพื่อให้คนอื่นรู้ว่าการมอบหมายนี้มาจากอะไร">
              <input
                value={form.reason}
                onChange={(e) => set('reason', e.target.value)}
                maxLength={200}
                placeholder="เช่น ลาป่วย · ไปราชการต่างจังหวัด"
                disabled={busy}
              />
            </Field>
          </div>
        </section>
      </div>
    </Modal>
  );
}

// ── small parts ─────────────────────────────────────────────────────────────

const ROLE = { manager: 'หัวหน้างาน', hr: 'ฝ่ายบุคคล', admin: 'ผู้ดูแลระบบ', employee: 'พนักงาน' };

/**
 * Four states, not two. "ยังไม่เริ่ม" and "หมดอายุแล้ว" both mean "not in
 * force" and call for opposite reactions — wait until Monday, or the dates
 * were typed backwards — so a single inactive badge would leave the person
 * guessing which mistake they made.
 */
const STATE = {
  active: ['มีผลอยู่', '#1F7A4D', '#E4F3EA'],
  scheduled: ['ยังไม่เริ่ม', '#8A5A00', '#FDF3DF'],
  expired: ['หมดอายุแล้ว', '#5A5A5A', '#EFEFEF'],
  revoked: ['ยกเลิกแล้ว', '#8A2B2B', '#F7E5E5'],
};

function StateChip({ state }) {
  const [label, fg, bg] = STATE[state] || [state, '#555', '#eee'];
  return <span className="chip" style={{ background: bg, color: fg }}>{label}</span>;
}

function daysLeft(toDate, today) {
  if (!toDate || !today) return '—';
  const days = Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return Math.max(0, days) + 1; // inclusive of the last day
}
