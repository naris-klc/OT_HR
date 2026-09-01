'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api.js';
import { PickDate } from './PickDate.jsx';
import {
  EVENT_LABEL, FAILED_LOGIN_ALERT, STATUS_CLASS_LABEL,
} from '@/lib/accessLog.js';
import {
  Alert, Empty, Field, Modal, ClearButton, useScrollEdge,
} from './common.jsx';

/**
 * บันทึกระบบ — who has been in this system, from where, and what they touched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR TABS BECAUSE THERE ARE FOUR QUESTIONS, NOT FOUR FILTERS
 *
 * They read the same collection and they are not interchangeable. The order is
 * the order somebody arrives at them:
 *
 *   ภาพรวม            — "is there anything here I should look at?", asked
 *                        before anybody knows what they are looking for. A log
 *                        is unreadable by scrolling; this is what makes it
 *                        openable at all.
 *   การเข้าใช้งาน      — logins, failures and logouts. The events พ.ร.บ.
 *                        คอมพิวเตอร์ is actually written about, and the ones a
 *                        person recognises trouble in.
 *   การแก้ไขข้อมูล     — every request that set out to CHANGE something.
 *                        Nothing here says what changed — that is in the entry's
 *                        own ประวัติ and in ประวัติการแก้ทะเบียน, and this
 *                        screen links to neither because it is answering a
 *                        different question: not "what did this figure used to
 *                        be" but "who has been making changes, and when".
 *   ทั้งหมด            — the traffic itself, reads included. The tab nobody
 *                        opens until they need it, and the only one that can
 *                        answer "what did this account look at on Tuesday".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SCREEN CANNOT DO, ON PURPOSE
 *
 * There is no delete, no edit, and no "clear log". Every field on the model is
 * immutable and no route offers a write; the screen simply has nothing to draw.
 * A traffic log an administrator can tidy is worth less than no log, because
 * its existence is what somebody would be relying on.
 */

const TABS = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'auth', label: 'การเข้าใช้งาน' },
  { key: 'edits', label: 'การแก้ไขข้อมูล' },
  { key: 'all', label: 'ทั้งหมด' },
  /**
   * A FIFTH QUESTION, AND THE ONLY TAB HERE THAT DOES NOT READ `otAccessLogs`.
   *
   *   การใช้สิทธิ์พิเศษ — "what was done that the rules would ordinarily have
   *                        refused, and why was it allowed?"
   *
   * The four above are traffic: every request, sliced four ways. This one reads
   * four OTHER collections and keeps six kinds of event — see
   * lib/complianceExport.js for the test that decides which six. It is here
   * rather than under ตั้งค่าระบบ because it has the same audience and the same
   * rule as its neighbours (ผู้ดูแลระบบ only, and never ฝ่ายบุคคล, who appear in
   * it), and because somebody arriving to audit opens this screen.
   *
   * LAST, because it is the answer to a question asked deliberately — an
   * internal auditor asking for a quarter — rather than one somebody stumbles
   * into. ภาพรวม stays first for the same reason it always was.
   */
  { key: 'compliance', label: 'การใช้สิทธิ์พิเศษ' },
];

/** What each tab asks the endpoint for, beyond the filters somebody sets. */
const TAB_QUERY = {
  overview: {},
  // Not `event=login_failed` — the tab is the whole story of getting in and out,
  // and a screen showing only failures would let a successful login at 03:00
  // pass without comment. The dropdown narrows it further for anybody who wants.
  auth: { events: ['login', 'login_failed', 'logout'] },
  edits: { write: '1' },
  all: {},
};

const ROLE_LABEL = {
  employee: 'พนักงาน', manager: 'หัวหน้างาน', hr: 'ฝ่ายบุคคล', admin: 'ผู้ดูแลระบบ',
};

/** Bangkok, spelled out — see the timezone comments on the two endpoints. */
const at = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'medium' }) : '—');
const atShort = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** `2026-08-24`, local — what the two date inputs speak. */
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LogSystem() {
  const [tab, setTab] = useState('overview');
  const [tabsRef, tabsEdge] = useScrollEdge(null);

  /**
   * The filters, shared across the three list tabs.
   *
   * ONE OBJECT AND ONE COPY OF IT, so moving from การแก้ไขข้อมูล to ทั้งหมด
   * keeps the person and the dates somebody just typed. The tabs are four
   * questions about the same evening; making each one forget the evening would
   * be four searches to answer one question.
   */
  const [filters, setFilters] = useState({
    q: '', actor: '', event: '', status: '', from: '', to: '', ip: '',
  });
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const clearFilters = () => setFilters({
    q: '', actor: '', event: '', status: '', from: '', to: '', ip: '',
  });

  return (
    <>
      <div className="card">
        <div className="tabs-view" data-edge={tabsEdge}>
          <div className="row section-tabs" ref={tabsRef}>
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`btn ${tab === t.key ? '' : 'ghost'}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'overview' && <Overview onOpenTab={setTab} onFilter={setFilters} />}
      {tab === 'compliance' && <Compliance />}
      {tab !== 'overview' && tab !== 'compliance' && (
        <LogList
          key={tab}
          tab={tab}
          filters={filters}
          setFilter={setFilter}
          onClearFilters={clearFilters}
        />
      )}
    </>
  );
}

// ── ภาพรวม ──────────────────────────────────────────────────────────────────

function Overview({ onOpenTab, onFilter }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/logs/summary')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="card"><Alert kind="error">{error}</Alert></div>;
  if (!data) return <div className="card"><Empty>กำลังโหลด…</Empty></div>;

  const busiest = Math.max(1, ...data.days.map((d) => d.n));
  const noisyLogins = data.failedLogins >= (data.failedLoginAlert ?? FAILED_LOGIN_ALERT);

  /** Jump to a list tab with one filter already set — the point of a tile. */
  const drill = (tab, patch) => {
    onFilter((f) => ({ ...f, ...patch }));
    onOpenTab(tab);
  };

  return (
    <>
      <div className="card">
        <h2>ภาพรวม {data.windowDays} วันล่าสุด</h2>

        {/* THE FIGURES START AT THE HEADING. What stood here was four lines
            about what a traffic log is and what this one does not keep — true,
            and read once. It is standing context, so it moved to where this
            screen keeps standing context now: the ⓘ beside the page heading,
            one tap away on every tab rather than four lines down on one of
            them. See `PAGE.logs` in App.jsx.

            10px, not the 4 it was: `.card h2` leaves 4 of its own, and 14 is
            the gap `.card .hint` used to put between this heading and the
            first thing under it.

            `.grid` — the same auto-fit row of `.stat` boxes the landing
            screens use, so these four read as the app's own tiles rather than
            as a widget belonging to this page. */}
        <div className="grid" style={{ marginTop: 10 }}>
          <Tile
            label="REQUESTS"
            value={data.requests}
            unit="ครั้ง"
            /* The footer used to say how far back this goes. It is one clause
               and it belongs to the count it qualifies — 371 rows means one
               thing if the oldest is from March and another if it is from
               Tuesday — so it moved here rather than being lost with the rest
               of the footer. */
            note={`ทั้งหมดในระบบ ${data.total.toLocaleString('th-TH')} รายการ${data.oldest ? ` · เก่าสุด ${atShort(data.oldest)}` : ''}`}
            onClick={() => drill('all', {})}
          />
          <Tile
            label="CHANGES"
            value={data.writes}
            unit="ครั้ง"
            note="คำสั่งที่ตั้งใจแก้ไขข้อมูล"
            onClick={() => drill('edits', {})}
          />
          <Tile
            label="SIGN-INS"
            value={data.logins}
            unit="ครั้ง"
            note="เข้าสู่ระบบสำเร็จ"
            onClick={() => drill('auth', { event: 'login' })}
          />
          <Tile
            label="FAILED SIGN-INS"
            value={data.failedLogins}
            unit="ครั้ง"
            tone={noisyLogins ? 'warn' : undefined}
            note={noisyLogins
              ? 'สูงกว่าปกติ — ดูรหัสที่ถูกลองด้านล่าง'
              : 'กรอกรหัสผ่านผิด'}
            onClick={() => drill('auth', { event: 'login_failed' })}
          />
        </div>

        {noisyLogins && (
          <Alert kind="warn">
            มีการเข้าสู่ระบบไม่สำเร็จ {data.failedLogins} ครั้งใน {data.windowDays} วันที่ผ่านมา
            {' '}— ตรวจสอบรายการ “รหัสที่ถูกลองแล้วไม่ผ่าน” ด้านล่างว่าเป็นคนในบริษัทลืมรหัสผ่าน
            {' '}หรือเป็นการไล่เดารหัสจากเครื่องที่ไม่รู้จัก
            {' '}· ระบบไม่ได้ล็อกบัญชี แต่จะหน่วงเวลาให้ช้าลงเรื่อย ๆ เมื่อกรอกผิดซ้ำ
          </Alert>
        )}
      </div>

      <div className="card">
        <h2>ปริมาณการใช้งานรายวัน</h2>
        <div className="hint">
          แท่งสีเข้มคือคำสั่งที่แก้ไขข้อมูล · ขีดสีแดงคือการเข้าสู่ระบบไม่สำเร็จ
        </div>
        {/*
          A chart of divs rather than a library. Fourteen numbers on one axis is
          the whole requirement, and the shapes that matter — a quiet weekend, a
          spike on the evening somebody was working through codes — are legible
          at this fidelity. A charting dependency for this would be the largest
          thing in the bundle and would still need the same explanation of what
          the two colours mean.
        */}
        <div className="log-chart">
          {data.days.map((d) => (
            <div className="log-bar" key={d.date} title={`${d.date} · ${d.n} ครั้ง · แก้ไข ${d.writes} · เข้าระบบไม่สำเร็จ ${d.failedLogins}`}>
              <div className="col">
                <div className="fill" style={{ height: `${Math.round((d.n / busiest) * 100)}%` }}>
                  {/* Only on the days that have one. The height is the share of
                      the bar the writes are, which on real traffic rounds to 0 —
                      `.log-bar .writes` carries a min-height for exactly that, and
                      it must not be allowed to paint a foot on a day with none. */}
                  {d.writes > 0 && (
                    <div className="writes" style={{ height: `${Math.round((d.writes / d.n) * 100)}%` }} />
                  )}
                </div>
                {d.failedLogins > 0 && <div className="failed" />}
              </div>
              <div className="tick">{d.date.slice(8)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="log-columns">
        <Panel
          title="บัญชีที่ใช้งานมากที่สุด"
          note="3 อันดับแรก · นับเป็นบัญชี ไม่ใช่คน — บัญชีฝ่ายบุคคลใช้ร่วมกันทั้งแผนก"
          rows={data.accounts}
          empty="ยังไม่มีการใช้งานในช่วงนี้"
          render={(a) => ({
            key: a.id,
            main: `${a.code || '—'} · ${a.name || '—'}`,
            sub: `${ROLE_LABEL[a.role] || a.role || '—'} · ล่าสุด ${atShort(a.last)}`,
            n: a.n,
            onClick: () => drill('all', { actor: a.id }),
          })}
        />
        <Panel
          title="หมายเลขไอพีที่เข้ามา"
          note="ในวงแลนคือเครื่องที่ได้รับไอพีจากเราเตอร์ — ตัวเลขอาจเปลี่ยนเมื่อเครื่องต่อใหม่"
          rows={data.addresses}
          empty="ยังไม่มีการเชื่อมต่อในช่วงนี้"
          render={(a) => ({
            key: a.ip,
            main: a.ip,
            sub: `ล่าสุด ${atShort(a.last)}`,
            n: a.n,
            onClick: () => drill('all', { ip: a.ip }),
          })}
        />
        <Panel
          title="คำสั่งแก้ไขข้อมูลที่ใช้บ่อย"
          note="รวมทุกใบและทุกคน — นับตามชนิดของคำสั่ง"
          rows={data.actions}
          empty="ยังไม่มีการแก้ไขข้อมูลในช่วงนี้"
          render={(a) => ({
            key: `${a.method} ${a.template}`,
            main: a.label,
            sub: `${a.method} ${a.template}`,
            n: a.n,
          })}
        />
        <Panel
          title="รหัสที่ถูกลองแล้วไม่ผ่าน"
          note="รหัสพนักงานที่กรอกเข้ามาพร้อมรหัสผ่านที่ไม่ถูกต้อง · ระบบไม่เก็บรหัสผ่านที่กรอก"
          rows={data.failedCodes}
          empty="ไม่มีการเข้าสู่ระบบไม่สำเร็จในช่วงนี้"
          render={(f) => ({
            key: `${f.code}-${f.ip}`,
            main: f.code || '(ไม่ได้กรอกรหัส)',
            sub: `จาก ${f.ip || 'ไม่ทราบ'} · ล่าสุด ${atShort(f.last)}`,
            n: f.n,
            tone: f.n >= 5 ? 'warn' : undefined,
            onClick: () => drill('auth', { event: 'login_failed', q: f.code || '' }),
          })}
        />
      </div>
    </>
  );
}

function Tile({ label, value, unit, note, tone, onClick }) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div className="value">
        <span>{Number(value || 0).toLocaleString('th-TH')}</span>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {note && <div className="note">{note}</div>}
    </>
  );
  if (!onClick) return <div className={`stat${tone ? ` ${tone}` : ''}`}>{body}</div>;
  return (
    <button type="button" className={`stat as-button${tone ? ` ${tone}` : ''}`} onClick={onClick}>
      {body}
    </button>
  );
}

/**
 * How many rows each of the four cards opens with — THE SAME NUMBER ON ALL FOUR.
 *
 * The endpoint does not return the same number of rows to each of them: 3
 * accounts, 15 addresses, 10 of each of the other two. Those are sensible caps
 * for what each list is worth fetching and they were four different card
 * heights on the screen — and the four sit in a grid, where a row is as tall as
 * its tallest cell, so the fifteen-row card left the three-row one beside it
 * under a hand's width of empty card. What each list is worth FETCHING and what
 * a card opens SHOWING turn out to be two different questions.
 *
 * Three, not ten: it is the smallest of the four caps, so it is the only figure
 * every card can actually meet. บัญชีที่ใช้งานมากที่สุด has no fourth row to
 * offer — `TOP_ACCOUNTS` in app/api/logs/summary/route.js, deliberate and for
 * its own reasons — and a standard one of the four cannot keep is not one.
 */
const PANEL_ROWS = 3;

/** One of the four counted lists under the chart. */
function Panel({ title, note, rows, empty, render }) {
  /**
   * ดูทั้งหมด opens the rest INSIDE the card, not underneath it.
   *
   * Growing the card is what this whole change is undoing: the four are one
   * grid row, so a card that grows by twelve rows drags the three beside it
   * along and hands each of them twelve rows of whitespace. Opened, the list
   * scrolls within the height it already had — the card changes what it shows
   * and not how tall it is, and nothing beside it moves.
   */
  const [all, setAll] = useState(false);
  /**
   * The collapsed list's own height, measured the moment before it opens.
   *
   * A number in the stylesheet would be three rows of arithmetic — 9px of
   * padding twice, a 13.5px line and an 11.5px line 2px apart — and wrong on
   * exactly the cards where it matters, the ones where a long account name or a
   * Thai action wraps to a second line. Too small and pressing ดูทั้งหมด makes
   * the card SHORTER, which is a worse surprise than the growth it was written
   * to prevent. So it is measured rather than predicted.
   */
  const [cap, setCap] = useState(0);
  /**
   * And the fade that says the rest is down there.
   *
   * A card that does not change height when you press ดูทั้งหมด is a card that
   * looks like it did nothing: the fourth row is real, the list scrolls to it,
   * and none of that is visible from where somebody is sitting — walked on the
   * verify build and the button read as inert. `useScrollEdge` is the answer
   * this app already gives to "is there more this way" in two other places, on
   * the other axis; the third caller is what put an `axis` on it.
   */
  const [listRef, edge] = useScrollEdge(all, 'y');
  const toggle = () => {
    if (!all) setCap(listRef.current?.offsetHeight || 0);
    setAll((v) => !v);
  };

  const list = rows || [];
  const shown = all ? list : list.slice(0, PANEL_ROWS);
  const hidden = list.length - PANEL_ROWS;

  return (
    <div className="card">
      {/* The heading and its control on one line, so the head costs no more
          height than the `h2` alone did — see `.log-panel-head`. */}
      <div className="log-panel-head">
        <h2>{title}</h2>
        {hidden > 0 && (
          <button type="button" className="btn quiet sm log-more" onClick={toggle}>
            {all ? 'ย่อ' : `ดูทั้งหมด (${list.length.toLocaleString('th-TH')})`}
          </button>
        )}
      </div>
      <div className="hint">{note}</div>
      {!list.length && <Empty>{empty}</Empty>}
      {list.length > 0 && (
        // The fade hangs on the wrapper, not the list: anything painted inside
        // a scroll container is content and scrolls away with it.
        <div className="log-tally-view" data-edge={all ? edge : 'none'}>
          <ul
            ref={listRef}
            className={`log-tally${all ? ' all' : ''}`}
            style={all && cap ? { maxHeight: cap } : undefined}
          >
            {shown.map((raw) => {
              const r = render(raw);
              const inner = (
                <>
                  <span className="t">
                    <span className="main">{r.main}</span>
                    <span className="sub">{r.sub}</span>
                  </span>
                  <span className={`n${r.tone ? ` ${r.tone}` : ''}`}>{r.n.toLocaleString('th-TH')}</span>
                </>
              );
              return (
                <li key={r.key}>
                  {r.onClick
                    ? <button type="button" onClick={r.onClick}>{inner}</button>
                    : <span className="static">{inner}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── การใช้สิทธิ์พิเศษ ────────────────────────────────────────────────────────

/**
 * The tone each kind of exception is drawn in.
 *
 * THREE LEVELS, NOT FIVE COLOURS. A palette with one entry per kind is a legend
 * to memorise; what the eye needs is "which of these moved money, which moved
 * access, which moved a label".
 *
 *   danger — a figure somebody had signed for can have changed. คำนวณใหม่รวมใบ
 *            ที่อนุมัติแล้ว is the only event in this system that can restate a
 *            number already sent to payroll. เปิดงวด was the other until
 *            2026-08-31; ปิดงวด was withdrawn (lib/periodStatus.js) and the kind
 *            went with it, having never once been recorded.
 *   warn   — somebody's access changed hands: a new password, or a บทบาท that
 *            crossed into ฝ่ายบุคคล / ผู้ดูแลระบบ.
 *   muted  — the two that are neither, and are here because they are refused
 *            for everybody but one role: the หัวหน้า signature an administrator
 *            supplied, and a รหัสพนักงาน that changed. Grey is already this
 *            app's word for "orientation rather than something to act on".
 */
const KIND_TONE = {
  replay_approved: 'danger',
  password_reset: 'warn',
  role_change: 'warn',
  admin_override: 'muted',
  code_change: 'muted',
};

/**
 * รายงานการใช้สิทธิ์พิเศษ — six kinds of exception, on one timeline.
 *
 * ITS OWN STATE AND ITS OWN FILTERS, not the ones the four traffic tabs share.
 * Those filter `otAccessLogs` by ip, event, status and actor — none of which
 * exists here. Reusing the bar would offer four boxes that do nothing and
 * silently carry a leftover ip filter into a compliance report, which is the
 * worst possible place for a filter somebody has forgotten about.
 */
function Compliance() {
  const [range, setRange] = useState({ from: '', to: '' });
  const [only, setOnly] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    if (only) p.set('kinds', only);
    return p.toString();
  }, [range, only]);

  useEffect(() => {
    setData(null);
    api.get(`/logs/compliance?${params}`)
      .then((res) => { setData(res); setError(''); })
      .catch((err) => setError(err.message));
  }, [params]);

  const download = () => {
    const name = `การใช้สิทธิ์พิเศษ_${range.from || 'เริ่มต้น'}_${range.to || 'ล่าสุด'}.csv`;
    api.download(`/exports/compliance.csv?${params}`, name).catch((err) => setError(err.message));
  };

  const today = ymd(new Date());
  const labels = data?.labels || {};

  return (
    <div className="card">
      <h2>การใช้สิทธิ์พิเศษ</h2>
      <div className="hint">
        ทุกครั้งที่มีการใช้สิทธิ์ที่ระบบปกติจะปฏิเสธ — ตั้งรหัสผ่านใหม่ · ผู้ดูแลระบบเซ็นแทนหัวหน้า
        {' '}· เปลี่ยนบทบาทเป็นฝ่ายบุคคลหรือผู้ดูแลระบบ · เปลี่ยนรหัสพนักงาน
        {' '}· คำนวณใหม่รวมใบที่อนุมัติแล้ว
        {' · '}เรียงจากเก่าไปใหม่ เพราะไฟล์นี้อ่านเป็นลำดับเหตุการณ์ ไม่ใช่กวาดหาของล่าสุด
        {' · '}ไม่รวมงานประจำวันปกติ — งานเหล่านั้นอยู่ในสามแท็บก่อนหน้าและในประวัติของใบแต่ละใบ
      </div>

      <div className="form-grid">
        <Field label="ตั้งแต่วันที่">
          <PickDate label="ตั้งแต่วันที่" max={today} value={range.from} clearable
            onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
        </Field>
        <Field label="ถึงวันที่" note="รวมวันที่เลือกด้วย">
          <PickDate label="ถึงวันที่" max={today} value={range.to} clearable
            onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
        </Field>
        <Field label="เฉพาะประเภท" note="เว้นว่าง = ทุกประเภท">
          <select value={only} onChange={(e) => setOnly(e.target.value)}>
            <option value="">ทุกประเภท</option>
            {Object.entries(labels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}{data?.counts?.[k] != null ? ` (${data.counts[k]})` : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        {(range.from || range.to || only) && (
          <button className="btn ghost sm" onClick={() => { setRange({ from: '', to: '' }); setOnly(''); }}>
            ล้างตัวกรองทั้งหมด
          </button>
        )}
        <button className="btn ghost sm" onClick={download} disabled={!data?.total}>
          ดาวน์โหลด CSV ตามตัวกรอง
        </button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {!data && !error && <Empty>กำลังโหลด…</Empty>}

      {/* A quarter with no exceptions is the ordinary outcome and has to READ
          like one. An empty table with no sentence under it looks like a screen
          that failed to load, which is the reading that gets somebody to stop
          checking. */}
      {data && !data.total && (
        <Empty>
          ไม่มีการใช้สิทธิ์พิเศษในช่วงเวลานี้
          {(range.from || range.to || only) ? ' — ลองขยายช่วงวันที่หรือเลือก “ทุกประเภท”' : ''}
        </Empty>
      )}

      {data?.total > 0 && (
        <>
          {/* A row with no reason on it is a finding, and it is stated before
              the table rather than left to be spotted while scrolling one. Four
              of the six kinds cannot be performed without a reason, so this is
              normally zero. */}
          {data.withoutReason > 0 && (
            <Alert kind="warn">
              {data.withoutReason} รายการไม่มีเหตุผลบันทึกไว้
              {' — '}อาจเป็นรายการที่เกิดก่อนระบบจะบังคับให้ระบุเหตุผล
              หรือเป็นประเภทที่ไม่ได้บังคับ (ตั้งรหัสผ่านใหม่ · เซ็นแทนหัวหน้าจากสคริปต์)
            </Alert>
          )}

          {/* `card-list` says what this wrap holds below 860px: cards, not a
              table pushed sideways. Six columns, two of them whole sentences,
              do not go on a 360px screen in any arrangement — see `.cmp-table`
              in styles for what the card keeps and in what order. */}
          <div className="table-wrap card-list">
            <table className="log-table cmp-table">
              <thead>
                <tr>
                  <th>วันเวลา</th>
                  <th>ประเภท</th>
                  <th>ผู้กระทำ</th>
                  <th>เป้าหมาย</th>
                  <th>รายละเอียด</th>
                  <th>เหตุผล</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.at}-${r.kind}-${i}`}>
                    <td data-label="วันเวลา" className="nb cmp-when">{at(r.at)}</td>
                    <td data-label="ประเภท" className="cmp-kind">
                      <span className={`chip ${KIND_TONE[r.kind] || ''}`}>
                        {labels[r.kind] || r.kind}
                      </span>
                      {/* Where it came from, and only when it was not a person
                          on a screen. Printed on every row it would be noise;
                          `สคริปต์บนเซิร์ฟเวอร์` on one row is the whole story of
                          that row. */}
                      {r.source && r.source !== 'หน้าจอ' && (
                        <div className="cell-sub">{r.source}</div>
                      )}
                    </td>
                    <td data-label="ผู้กระทำ" className="cmp-actor">{r.actor}</td>
                    {/* The arrow between the two is drawn by the card and not
                        printed here: on a wide screen these are two columns
                        under two headings, and an arrow inside one of them
                        would be a stray character in the เป้าหมาย column. */}
                    <td data-label="เป้าหมาย" className="cmp-target">{r.target}</td>
                    <td data-label="รายละเอียด" className="cmp-detail">{r.detail}</td>
                    <td data-label="เหตุผล" className="cmp-reason">
                      {r.reason
                        ? <span className="note">“{r.reason}”</span>
                        : <span className="cell-sub">— ไม่ได้ระบุ</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="hint" style={{ marginTop: 10 }}>
            ทั้งหมด {data.total.toLocaleString('th-TH')} รายการ
            {' · '}หน้านี้แสดงครบทุกรายการในช่วงที่เลือก ไม่มีการตัดท้าย
          </div>
        </>
      )}
    </div>
  );
}

// ── the three list tabs ─────────────────────────────────────────────────────

function LogList({
  tab, filters, setFilter, onClearFilters,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState(null);

  const narrowed = useMemo(
    () => Object.entries(filters).some(([, v]) => v),
    [filters],
  );

  /**
   * The request, built from the tab AND the filters.
   *
   * `event` from the dropdown wins over the tab's own list, which is why
   * การเข้าใช้งาน can be narrowed to just the failures without a second tab
   * for it. Everything is sent to the server; nothing is narrowed in the
   * browser, for the reason ประวัติการแก้ทะเบียน spells out — the endpoint
   * answers with the newest `limit` rows, so filtering those here would search
   * the last hundred records and report "never happened" for anything older.
   */
  const params = useMemo(() => {
    const p = new URLSearchParams();
    const preset = TAB_QUERY[tab] || {};
    if (preset.write) p.set('write', preset.write);
    if (filters.event) p.set('event', filters.event);
    else if (preset.events && tab === 'auth') p.set('authOnly', '1');
    if (filters.q) p.set('q', filters.q);
    if (filters.actor) p.set('actor', filters.actor);
    if (filters.status) p.set('status', filters.status);
    if (filters.ip) p.set('ip', filters.ip);
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    p.set('limit', String(limit));
    return p.toString();
  }, [tab, filters, limit]);

  const load = useCallback(() => {
    setData(null);
    api.get(`/logs?${params}`)
      .then((res) => { setData(res); setError(''); })
      .catch((err) => setError(err.message));
  }, [params]);

  useEffect(load, [load]);

  // Paging by growing the window rather than by a cursor: the log is read
  // newest-first and "ดูเพิ่ม" means "go further back", which is one number.
  useEffect(() => { setLimit(100); }, [tab, filters]);

  const download = () => {
    const p = new URLSearchParams();
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    if (filters.actor) p.set('actor', filters.actor);
    if (filters.event) p.set('event', filters.event);
    if (tab === 'edits') p.set('write', '1');
    const name = `บันทึกระบบ_${filters.from || 'เริ่มต้น'}_${filters.to || 'ล่าสุด'}.csv`;
    api.download(`/exports/logs.csv?${p.toString()}`, name).catch((err) => setError(err.message));
  };

  const today = ymd(new Date());

  return (
    <div className="card">
      <h2>{TABS.find((t) => t.key === tab)?.label}</h2>
      <div className="hint">
        {tab === 'auth' && 'ทุกครั้งที่มีการเข้าสู่ระบบ ออกจากระบบ และทุกครั้งที่กรอกรหัสผ่านไม่ถูกต้อง เรียงจากใหม่ไปเก่า'}
        {tab === 'edits' && 'ทุกคำสั่งที่ตั้งใจแก้ไขข้อมูล รวมทั้งคำสั่งที่ระบบปฏิเสธ · หน้านี้บอกว่าใครสั่งอะไรเมื่อไหร่ ส่วนค่าที่เปลี่ยนไปดูได้ที่ประวัติของใบนั้นหรือประวัติการแก้ทะเบียน'}
        {tab === 'all' && 'ทุกการเรียกใช้ API รวมทั้งการเปิดดูข้อมูลที่ไม่ได้แก้อะไร — ใช้ตอบคำถามว่าบัญชีไหนเปิดดูอะไรเมื่อไหร่'}
      </div>

      <div className="form-grid" style={{ marginBottom: 12 }}>
        <Field label="ค้นหา" note="ค้นได้จากเส้นทาง ชื่อ รหัสพนักงาน และหมายเลขไอพี">
          <div className="searchbox">
            <input
              type="text"
              className={filters.q ? 'has-clear' : undefined}
              value={filters.q}
              placeholder="เช่น PM-0620 หรือ 192.168.109."
              aria-label="ค้นหาในบันทึกประวัติระบบ"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setFilter('q', e.target.value)}
            />
            {filters.q && <ClearButton onClear={() => setFilter('q', '')} />}
          </div>
        </Field>
        <Field label="กรองตามบัญชี" note="รายชื่อมาจากบันทึกเอง — ไม่ใช่ทะเบียนวันนี้">
          <select value={filters.actor} onChange={(e) => setFilter('actor', e.target.value)}>
            <option value="">— ทุกบัญชี —</option>
            {/* The rows nobody's session is attached to: refused logins, and
                requests turned away before a session existed. Its own choice
                because it is the one somebody scanning for trouble wants. */}
            <option value="none">— ไม่มีบัญชี (ยังไม่ได้เข้าระบบ) —</option>
            {(data?.actors || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code || '—'} · {a.name || '—'}{a.role ? ` · ${ROLE_LABEL[a.role] || a.role}` : ''}
              </option>
            ))}
          </select>
        </Field>
        {tab === 'auth' && (
          <Field label="กรองตามเหตุการณ์">
            <select value={filters.event} onChange={(e) => setFilter('event', e.target.value)}>
              <option value="">— ทั้งหมด —</option>
              <option value="login">{EVENT_LABEL.login}</option>
              <option value="login_failed">{EVENT_LABEL.login_failed}</option>
              <option value="logout">{EVENT_LABEL.logout}</option>
            </select>
          </Field>
        )}
        <Field label="กรองตามผลลัพธ์">
          <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">— ทุกผลลัพธ์ —</option>
            {Object.entries(STATUS_CLASS_LABEL)
              .filter(([k]) => k !== 'unknown')
              .map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </Field>
        <Field label="ตั้งแต่วันที่">
          <PickDate label="ตั้งแต่วันที่" max={today} value={filters.from} clearable onChange={(v) => setFilter('from', v)} />
        </Field>
        <Field label="ถึงวันที่" note="รวมวันที่เลือกด้วย">
          <PickDate label="ถึงวันที่" max={today} value={filters.to} clearable onChange={(v) => setFilter('to', v)} />
        </Field>
      </div>

      {/* The spacing is in `.log-actions` rather than inline, because it is not
          one number: on a phone these stack and the gap to the list below has
          to be bigger than the gap between the two buttons. */}
      <div className="row log-actions">
        {narrowed && (
          <button className="btn ghost sm" onClick={onClearFilters}>ล้างตัวกรองทั้งหมด</button>
        )}
        {/* The reason this screen has an export at all: the request comes from
            somebody who will never be given a login. See the route.

            `.outline` and not a third ghost. Of the two buttons here this is
            the one that DOES something — the other undoes a filter — and two
            grey cards side by side say neither. Not the filled green either:
            that voice belongs to the action a screen is for, and this screen is
            for reading. See the note at `.btn.outline`. */}
        <button className="btn outline sm" onClick={download}>ดาวน์โหลด CSV ตามตัวกรอง</button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {!data && !error && <Empty>กำลังโหลด…</Empty>}

      {data && !data.records.length && (
        <Empty>
          {narrowed
            ? 'ไม่มีรายการที่ตรงกับตัวกรองนี้ — ลองล้างตัวกรองบางข้อออก'
            : 'ยังไม่มีบันทึกในช่วงนี้'}
        </Empty>
      )}

      {data && data.records.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="stack-table log-table">
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>บัญชีผู้ใช้งาน</th>
                  <th>การกระทำ</th>
                  <th>ผลลัพธ์</th>
                  <th>ที่มา</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((r) => (
                  <tr key={r.id} onClick={() => setOpen(r)} className="clickable">
                    <td data-label="เวลา" className="log-when">{atShort(r.at)}</td>
                    <td data-label="บัญชีผู้ใช้งาน">
                      {r.actor
                        ? (
                          <>
                            <span className="log-who">{r.actor.code} · {r.actor.name}</span>
                            <span className="log-sub">{ROLE_LABEL[r.actor.role] || r.actor.role}</span>
                          </>
                        )
                        : (
                          <>
                            <span className="log-who muted">
                              {r.attemptedCode ? `กรอกรหัส ${r.attemptedCode}` : 'ไม่มีบัญชี'}
                            </span>
                            <span className="log-sub">ยังไม่ได้เข้าระบบ</span>
                          </>
                        )}
                    </td>
                    {/* `.log-v` — one box holding everything that is not the
                        label. It changes nothing on a wide screen, where these
                        cells are a column of their own; on a phone the label
                        and this box are the two halves of a flex row, and
                        without it the value's two lines would become two flex
                        items sitting side by side. See `.log-v` in styles. */}
                    <td data-label="การกระทำ">
                      <span className="log-v">
                        <span className="log-act">
                          {r.event !== 'request' && (
                            <span className={`chip ev-${r.event}`}>{EVENT_LABEL[r.event]}</span>
                          )}
                          {/* NOT ON การแก้ไขข้อมูล, where it is on every row.
                              That tab asks the endpoint for `write=1`, so the
                              badge is true of everything in the list and says
                              nothing about any of it — and it is amber, sitting
                              against an action name that already begins with
                              แก้ไข. Two near-identical Thai phrases 8px apart
                              with no space between words is what "ทับกัน" was:
                              measured on the built app the chip ends at 198px
                              and the words start at 206, so nothing overlaps —
                              they simply cannot be told apart at a glance.

                              It stays on ทั้งหมด, where writes are the few rows
                              among the reads and the badge is the whole point. */}
                          {r.write && tab !== 'edits' && <span className="chip edited">แก้ไขข้อมูล</span>}
                          {/* THE PART THAT GIVES. Badge and words are one line
                              on a phone, and when the two of them are wider
                              than the space beside the label something has to
                              lose: a chip cannot be shortened and still be
                              read, so it is these words, and they are the ones
                              that can afford it — the row's own title in the
                              record it opens is this same string, whole. */}
                          {/* NOT WHEN AN EVENT BADGE IS ALREADY SAYING IT.
                              `EVENT_LABEL` is a superset of the action name on
                              all three: the badge says เข้าสู่ระบบสำเร็จ where
                              this says เข้าสู่ระบบ, and it adds the half that
                              matters — whether it worked. Printed side by side
                              they were the same word twice, 8px apart, in a
                              language that puts no space between words. The
                              route below still names the request, and the whole
                              action is the title of the record this row opens. */}
                          {r.event === 'request' && <span className="log-what">{r.action}</span>}
                        </span>
                        <span className="log-sub mono">{r.method} {r.path}</span>
                      </span>
                    </td>
                    <td data-label="ผลลัพธ์">
                      <span className="log-v">
                        <span className={`chip sc-${r.statusClass}`}>{r.status ?? '—'}</span>
                      </span>
                    </td>
                    <td data-label="ที่มา">
                      <span className="log-v">
                        <span className="log-who mono">{r.ip || '—'}</span>
                        <span className="log-sub">{r.device}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.hasMore && (
            <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
              <button className="btn ghost" onClick={() => setLimit((n) => Math.min(n + 200, 500))}>
                ดูย้อนหลังเพิ่ม
              </button>
            </div>
          )}
          {data.hasMore && limit >= 500 && (
            <Alert kind="warn">
              แสดงได้สูงสุด 500 รายการต่อครั้ง — จำกัดช่วงวันที่ให้แคบลง
              {' '}หรือดาวน์โหลด CSV เพื่อดูทั้งช่วง
            </Alert>
          )}
        </>
      )}

      {open && <RecordDetail record={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * One record, whole.
 *
 * The table shortens three things — the user-agent to two words, the path
 * without its query, the address without the chain it arrived through — and
 * every one of them is the field somebody eventually needs in full. This is
 * where the abridgement is undone, rather than the table being made unreadable
 * to avoid ever needing it.
 */
function RecordDetail({ record: r, onClose }) {
  return (
    <Modal
      title={r.action}
      subtitle={at(r.at)}
      meta={`${r.method} ${r.path}`}
      onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>ปิด</button>}
    >
      <dl className="log-detail">
        <Row k="เหตุการณ์" v={EVENT_LABEL[r.event] || r.event} />
        <Row
          k="บัญชีผู้ใช้งาน"
          v={r.actor
            ? `${r.actor.code} · ${r.actor.name} (${ROLE_LABEL[r.actor.role] || r.actor.role})`
            : 'ไม่มี — คำขอนี้ยังไม่ได้เข้าสู่ระบบ'}
        />
        {r.attemptedCode && (
          <Row
            k="รหัสพนักงานที่กรอก"
            v={r.attemptedCode}
            note="ระบบบันทึกเฉพาะรหัสที่กรอก ไม่มีการเก็บรหัสผ่านไม่ว่ารูปแบบใด"
          />
        )}
        <Row k="ผลลัพธ์" v={`${r.status ?? '—'} · ${STATUS_CLASS_LABEL[r.statusClass]}`} />
        <Row k="เวลาที่ใช้" v={r.ms == null ? '—' : `${r.ms} มิลลิวินาที`} />
        <Row k="เส้นทาง" v={`${r.method} ${r.path}`} mono />
        {r.query && (
          <Row
            k="พารามิเตอร์"
            v={r.query}
            mono
            note="ค่าที่ส่งมาทาง URL เท่านั้น · ระบบไม่เก็บเนื้อหาที่ส่งมาในตัวคำขอ"
          />
        )}
        <Row k="แก้ไขข้อมูลหรือไม่" v={r.write ? 'ใช่ — เป็นคำสั่งที่ตั้งใจเปลี่ยนข้อมูล' : 'ไม่ — เป็นการอ่านอย่างเดียว'} />
        <Row k="หมายเลขไอพี" v={r.ip || 'ไม่ทราบ'} mono />
        {r.via && (
          <Row
            k="ผ่านตัวกลาง"
            v={r.via}
            mono
            note="ค่าจากส่วนหัว x-forwarded-for ทั้งสาย — มีเมื่อคำขอผ่านพร็อกซี"
          />
        )}
        <Row k="อุปกรณ์" v={r.device} />
        <Row k="User-Agent" v={r.userAgent || 'ไม่มี'} mono />
      </dl>
    </Modal>
  );
}

function Row({ k, v, note, mono = false }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className={mono ? 'mono' : undefined}>
        {v}
        {note && <span className="note">{note}</span>}
      </dd>
    </>
  );
}

