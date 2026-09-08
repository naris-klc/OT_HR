'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { api, thaiStamp } from '@/lib/api.js';
import { PickDate } from './PickDate.jsx';
import {
  EVENT_LABEL, FAILED_LOGIN_ALERT, STATUS_CLASS_LABEL,
} from '@/lib/accessLog.js';
import {
  Alert, Empty, Field, Modal, PickOne, ClearButton, TablePager, TipButton, useScrollEdge,
  useKeptFetch, usePageReset,
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

/**
 * Bangkok, in the reader's own zone — see the timezone comments on the two
 * endpoints.
 *
 * The two used to be `dateStyle: 'medium'` and `'short'`, which on th-TH is
 * "14 ส.ค. 2569 16:03:22" against "14/8/2569 16:03" — two shapes for one
 * column, on one screen, chosen by a word that does not say which shape it
 * means. They differ by the seconds now and by nothing else.
 */
const at = (iso) => thaiStamp(iso) || '—';
const atShort = (iso) => thaiStamp(iso, { seconds: false }) || '—';

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
 * ภาพรวม's four counted lists — each one three rows tall, and it scrolls.
 *
 * The endpoint does not send the same number of rows to each of them: 3
 * accounts, 15 addresses, 10 of each of the other two. Those are sensible caps
 * for what each list is worth fetching and they were four different card
 * heights on the screen — and the four sit in a grid, where a row is as tall as
 * its tallest cell, so the fifteen-row card left the three-row one beside it
 * under a hand's width of empty card. What each list is worth FETCHING and what
 * a card shows AT ONCE turn out to be two different questions.
 *
 * THE ANSWER IS A HEIGHT, AND IT IS IN THE STYLESHEET — `.log-tally` caps the
 * list at three rows on all four cards, with no condition and no state. It was
 * a `ดูทั้งหมด` button, a three-row slice of the list and a max-height measured
 * off the collapsed list the instant before it opened; asked for on 2026-09-08,
 * all three are gone. Every row the endpoint sent is in the list from the first
 * paint and the rest are one scroll away — which is the state pressing the
 * button used to reach, minus the control and minus a card that can be left
 * folded shut.
 *
 * The fade stays, and it is now the only thing that says the list runs on: an
 * overlay scrollbar does not paint until the pointer is over the box, so
 * without it a card with twelve more rows looks exactly like a card with none.
 * `useScrollEdge` is the answer this app already gives to "is there more this
 * way" in two other places, on the other axis; this caller is what put an
 * `axis` on it.
 */
function Panel({ title, note, rows, empty, render }) {
  const list = rows || [];
  /**
   * The rows are what the measurement waits for — they land one fetch after the
   * card is drawn, and until they do the list is empty and fits. The
   * ResizeObserver inside the hook catches the rest: a wrapped name, a rotated
   * phone, a column that came out narrower than the one beside it.
   */
  const [listRef, edge] = useScrollEdge(list, 'y');

  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="hint">{note}</div>
      {!list.length && <Empty>{empty}</Empty>}
      {list.length > 0 && (
        // The fade hangs on the wrapper, not the list: anything painted inside
        // a scroll container is content and scrolls away with it.
        <div className="log-tally-view" data-edge={edge}>
          <ul ref={listRef} className="log-tally">
            {list.map((raw) => {
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
 * What this report counts, and how to read it — behind the ⓘ beside the
 * heading, the way บันทึก OT แทนพนักงาน carries its own standing context.
 *
 * A STRING AND NOT JSX, which is `TipButton`'s own constraint: it puts the
 * text in `title` for a pointer as well as drawing it, and a `title` given an
 * element is the string "[object Object]".
 *
 * WHY NOT อ่านต่อ, WHICH IS THE APP'S OTHER ANSWER TO A LONG EXPLANATION: the
 * standard settled on 2026-09-07 is that a card's subtitle is drawn in full and
 * never clamped — folded for an hour across nine components that afternoon and
 * withdrawn, because what it bought was a screen opening on a heading and the
 * word อ่านต่อ. `Disclosure` is for the text under ONE setting. So the line
 * under this heading was SHORTENED to the one sentence that says what the tab
 * is, and the five kinds and the two notes about reading order came here —
 * which is where ภาพรวม's four lines of the same sort of context already went.
 */
const ABOUT = 'สิ่งที่นับเป็นการใช้สิทธิ์พิเศษ — ตั้งรหัสผ่านใหม่ · ผู้ดูแลระบบเซ็นแทนหัวหน้า'
  + ' · เปลี่ยนบทบาทเป็นฝ่ายบุคคลหรือผู้ดูแลระบบ · เปลี่ยนรหัสพนักงาน · คำนวณใหม่รวมใบที่อนุมัติแล้ว'
  + ' · เรียงจากเก่าไปใหม่ เพราะไฟล์นี้อ่านเป็นลำดับเหตุการณ์ ไม่ใช่กวาดหาของล่าสุด'
  + ' · ไม่รวมงานประจำวันปกติ — งานเหล่านั้นอยู่ในสามแท็บก่อนหน้าและในประวัติของใบแต่ละใบ';

/**
 * รายงานการใช้สิทธิ์พิเศษ — five kinds of exception, on one timeline.
 *
 * ITS OWN STATE AND ITS OWN FILTERS, not the ones the four traffic tabs share.
 * Those filter `otAccessLogs` by ip, event, status and actor — none of which
 * exists here. Reusing the bar would offer four boxes that do nothing and
 * silently carry a leftover ip filter into a compliance report, which is the
 * worst possible place for a filter somebody has forgotten about.
 */
function Compliance() {
  /**
   * Whether the ⓘ is showing its paragraph. Shut on arrival, like the one on
   * the page heading: it answers a question somebody asks once.
   */
  const [aboutOpen, setAboutOpen] = useState(false);
  const [range, setRange] = useState({ from: '', to: '' });
  const [only, setOnly] = useState('');

  /**
   * WHERE THE PAGE IS CUT, AND IT IS CUT IN THE BROWSER — the opposite of the
   * traffic list next door, and for a reason that belongs to this endpoint.
   *
   * `/logs/compliance` is uncapped on purpose: it reads four collections
   * through one loader shared with the CSV, so that the screen and the file can
   * never report different quarters. Asking it for a page would mean teaching
   * that loader to skip, which is the second way of reading the same period.
   * It sends every row; this decides how many of them are on screen at once.
   *
   * NOTHING IS BEHIND A FOLD, which is the property the route's own header
   * insists on. A cut list has rows below it reachable by nothing; a paged one
   * has every row on some page, with the total printed under the table.
   */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    if (only) p.set('kinds', only);
    return p.toString();
  }, [range, only]);

  // Back to the first page when the three filters change the list underneath —
  // see `usePageReset`. Not on `data`, or the fetch for page 4 would bounce.
  usePageReset(setPage, [params, pageSize]);

  /**
   * PRESSING › HERE NEVER REACHED THE NETWORK, AND THE CARD IS KEPT ANYWAY.
   *
   * This table pages in the browser — `page` is not in `params`, so a chevron
   * changes which rows are sliced and nothing is fetched. That is why the jump
   * reported on 2026-09-08 was the traffic list's alone, and why this half of
   * the screen needed no repair to answer it.
   *
   * It uses `useKeptFetch` regardless, because the same collapse is available
   * here through the other door: a reader scrolled to the bottom of a long
   * quarter who narrows เฉพาะประเภท was, until now, dropped back to the top of
   * the page by `setData(null)` in exactly the way the chevron dropped the
   * other table. One loader, one behaviour, and no second place for this to be
   * got wrong.
   */
  const {
    data, error, busy, setError,
  } = useKeptFetch(() => api.get(`/logs/compliance?${params}`), [params]);

  const download = () => {
    const name = `การใช้สิทธิ์พิเศษ_${range.from || 'เริ่มต้น'}_${range.to || 'ล่าสุด'}.csv`;
    api.download(`/exports/compliance.csv?${params}`, name).catch((err) => setError(err.message));
  };

  const today = ymd(new Date());
  const labels = data?.labels || {};

  /* The rows this page holds. Named `shown` and never `list`, so nothing here
     reads as the `list.slice(` that test/logPanelRows.test.js forbids — that
     assertion is about ภาพรวม's four cards, where a slice put rows behind a
     button that no longer exists, and this is a different mechanism on a
     different table. */
  const all = data?.rows || [];
  const shown = all.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="card">
      {/* `.form-head` and the 17px circle are the app's own — the same control
          บันทึก OT แทนพนักงาน puts beside its heading, with the `i` glyph
          rather than `?` because a heading is not asking the reader anything.
          See `TipButton` in common.jsx. */}
      <div className="form-head">
        <h2>การใช้สิทธิ์พิเศษ</h2>
        <TipButton
          glyph="i"
          text={ABOUT}
          of="การใช้สิทธิ์พิเศษ"
          open={aboutOpen}
          onToggle={() => setAboutOpen((v) => !v)}
        />
      </div>
      <div className="hint">บันทึกทุกครั้งที่มีการใช้สิทธิ์ระดับสูง หรือสิทธิ์ที่ระบบปกติจะปฏิเสธ</div>
      {aboutOpen && <div className="field-note compliance-about">{ABOUT}</div>}

      {/* THREE FILTERS AND THE TWO BUTTONS ON ONE LINE — see `.compliance-filters`.
          The pair used to be a `.row` under the grid, which on a two-column
          grid put ตั้งแต่วันที่/ถึงวันที่ on one line, เฉพาะประเภท alone on the
          next and the buttons on a third: three rows of chrome over a table
          that is the reason for the screen. */}
      <div className="compliance-filters">
        <Field label="ตั้งแต่วันที่">
          <PickDate label="ตั้งแต่วันที่" max={today} value={range.from} clearable
            onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
        </Field>
        <Field label="ถึงวันที่" note="รวมวันที่เลือกด้วย">
          <PickDate label="ถึงวันที่" max={today} value={range.to} clearable
            onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
        </Field>
        {/* `PickOne` AND NOT A `<select>`, SINCE 2026-09-04 — the round that
            took the last of the operating system's own menus off this app. The
            box was always this stylesheet's and the list that dropped out of it
            never was: drawn by the browser, absent from the document, and on
            ธีมมืด a white sheet with the system's blue bar over it, beside two
            `PickDate` boxes in the same grid that are the app's own.

            THE COUNT LEFT THE OPTION TEXT, exactly as it did on the queue's
            filters: `(3)` had to be inside the string because an `<option>` can
            hold nothing else, and it is the `.ct` column now — mono, tabular,
            against the right edge where the figures line up. */}
        <PickOne
          label="เฉพาะประเภท"
          note="เว้นว่าง = ทุกประเภท"
          value={only}
          onChange={setOnly}
          allLabel="ทุกประเภท"
          options={Object.entries(labels).map(([k, v]) => ({
            value: k, label: v, count: data?.counts?.[k],
          }))}
        />
        {/* Last cell of the row, and the padding is what puts the buttons on
            the line of the three boxes rather than of the three labels — see
            `.compliance-filters .compliance-actions`. ล้างตัวกรองทั้งหมด keeps its place to
            the left of ดาวน์โหลด: it appears only when something is filtering,
            and a button that comes and goes must not be the one whose position
            the other is found by. */}
        <div className="compliance-actions">
          {(range.from || range.to || only) && (
            <button className="btn ghost sm" onClick={() => { setRange({ from: '', to: '' }); setOnly(''); }}>
              ล้างตัวกรองทั้งหมด
            </button>
          )}
          <button className="btn ghost sm" onClick={download} disabled={!data?.total}>
            ดาวน์โหลด CSV ตามตัวกรอง
          </button>
        </div>
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
            <Alert kind="warn" tight>
              {data.withoutReason} รายการไม่มีเหตุผลบันทึกไว้
              {' — '}อาจเป็นรายการที่เกิดก่อนระบบจะบังคับให้ระบุเหตุผล
              หรือเป็นประเภทที่ไม่ได้บังคับ (ตั้งรหัสผ่านใหม่ · เซ็นแทนหัวหน้าจากสคริปต์)
            </Alert>
          )}

          {/* `card-list` says what this wrap holds below 860px: cards, not a
              table pushed sideways. Six columns, two of them whole sentences,
              do not go on a 360px screen in any arrangement — see `.cmp-table`
              in styles for what the card keeps and in what order. */}
          <div className="table-wrap card-list is-paged" data-busy={busy ? '1' : undefined} aria-busy={busy}>
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
                {shown.map((r, i) => (
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

          <TablePager
            label="การใช้สิทธิ์พิเศษ"
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPage={setPage}
            onPageSize={setPageSize}
          />

          {/* THE SENTENCE SURVIVED THE PAGER, AND THE WORD IN IT IS THE REASON.
              It read "หน้านี้แสดงครบทุกรายการในช่วงที่เลือก ไม่มีการตัดท้าย"
              until 2026-09-08, when the table began paging — the first half of
              that stopped being true of the SCREEN the moment it did, and the
              second half never stopped being true of the REPORT. Those are two
              different claims and only one of them was about the layout.

              `ไม่มีการตัดท้าย` is what the route's own header promises and what
              test/complianceExport.test.js reads this file for: the loader is
              uncapped, no row is dropped for being late in the period, and a
              quarter too long to read is still a quarter delivered whole. A
              pager moves rows between pages; it does not remove any, and every
              row is on one of them. */}
          <div className="hint" style={{ marginTop: 10 }}>
            ทั้งหมด {data.total.toLocaleString('th-TH')} รายการ
            {' · '}แบ่งหน้าเพื่ออ่าน ทุกรายการในช่วงที่เลือกอยู่ในหน้าใดหน้าหนึ่ง ไม่มีการตัดท้าย
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
  const [open, setOpen] = useState(null);

  /**
   * WHERE THE READER IS IN THE LOG — and the server is the one that cuts it.
   *
   * IT WAS A WINDOW THAT GREW UNTIL IT STOPPED, until 2026-09-08: `limit`
   * started at 100, ดูย้อนหลังเพิ่ม added 200 at a time up to 500, and at 500
   * an amber panel said `แสดงได้สูงสุด 500 รายการต่อครั้ง — จำกัดช่วงวันที่ให้
   * แคบลง หรือดาวน์โหลด CSV เพื่อดูทั้งช่วง`. Three things were wrong with it
   * and only the third is about the number. It could not say how much more
   * there was, so "ดูย้อนหลังเพิ่ม" was a press into the dark. It could not go
   * BACK — the window only ever grew, so the way to un-see 500 rows was to
   * change a filter. And past the five hundredth row the answer to "what did
   * this account open on Tuesday" was to download a file and open Excel, on the
   * one screen in this app whose whole job is being read.
   *
   * A PAGE IS `skip` ROWS IN. The endpoint counts the filter as well as reading
   * it (see `total` there), so `หน้า 3 / 47` is a fact and not an estimate, and
   * the last page is reachable. `MAX_LIMIT` is still 500 on the route and now
   * caps a page rather than the whole visit; the largest this screen asks for
   * is 100.
   *
   * THE TOTAL MOVES WHILE YOU PAGE, AND THAT IS THIS SCREEN AND NOT A BUG.
   * Reading the log is itself logged — `route()` writes a row for `GET /logs`
   * like any other request, which is the property that makes the collection
   * worth anything (see the route's header). So every press of › adds a row,
   * the list is newest-first, and the new row lands at the FRONT: `ทั้งหมด`
   * climbed 95 → 96 → 97 across three presses when this was walked on a clone
   * on 2026-09-08. Everything after it shifts one place later, so the last row
   * of page 1 can appear again at the top of page 2.
   *
   * THE OLD BUTTON HAD THE SAME PROPERTY and could not show it: a window that
   * only grows re-reads from the front every time, so the row it duplicated was
   * one already on the screen rather than one on the page before. What is new
   * is that the count is now printed, so the drift is visible instead of
   * silent — which is the right way round for an audit screen.
   *
   * A FIX EXISTS AND IS NOT TAKEN HERE: pin the first read's newest `at` and
   * send it as an upper bound on every later page, so a visit pages through one
   * snapshot. It is a change to what the ENDPOINT is being asked for, not to
   * this band, and it wants its own decision — ask before building it.
   */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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
   * answers with one page of the rows that MATCH, so filtering a page here
   * would search ten records and report "never happened" for anything older.
   * That was true when the page was the newest hundred and it is more true now
   * that it can be the newest ten.
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
    p.set('limit', String(pageSize));
    /* Omitted on page 1 rather than sent as `skip=0`, so the request the screen
       makes on arrival is byte-for-byte the one it made before this existed —
       and so the URL in บันทึกระบบ's own record of itself does not gain a
       parameter that says nothing. */
    if (page > 1) p.set('skip', String((page - 1) * pageSize));
    return p.toString();
  }, [tab, filters, page, pageSize]);

  /* THE ROWS STAY UNTIL THE NEXT PAGE REPLACES THEM — see `useKeptFetch`.
     This used to be `setData(null)` before the request, which took the table,
     the pager and the button that had just been pressed off the page for as
     long as the fetch took. The document collapsed to a viewport, the browser
     clamped `scrollY` to 0, and the rows came back under a reader who was now
     at the top of the screen. Measured at 418 → 0 on the built app. */
  const {
    data, error, busy, setError,
  } = useKeptFetch(() => api.get(`/logs?${params}`), [params]);

  /* Back to page 1 when the list underneath is a different list — the tab, the
     filters, or the length of a page. NOT on `data`: the fetch that arrives IS
     the page press, and resetting on it would make › a button that goes to
     page 2 and comes straight back. See `usePageReset`. */
  usePageReset(setPage, [tab, filters, pageSize]);

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
        {/* All three are `PickOne` since 2026-09-04 — see the note over
            เฉพาะประเภท on the tab above, which is the same argument and the same
            round. A filter bar has ONE kind of dropdown on it: one control drawn
            any other way is the OS menu back on one field. */}
        <PickOne
          label="กรองตามบัญชี"
          note="รายชื่อมาจากบันทึกเอง — ไม่ใช่ทะเบียนวันนี้"
          value={filters.actor}
          onChange={(v) => setFilter('actor', v)}
          allLabel="— ทุกบัญชี —"
          options={[
            /* The rows nobody's session is attached to: refused logins, and
               requests turned away before a session existed. Its own choice
               because it is the one somebody scanning for trouble wants. */
            { value: 'none', label: '— ไม่มีบัญชี (ยังไม่ได้เข้าระบบ) —' },
            ...(data?.actors || []).map((a) => ({
              value: a.id,
              label: `${a.code || '—'} · ${a.name || '—'}${a.role ? ` · ${ROLE_LABEL[a.role] || a.role}` : ''}`,
            })),
          ]}
        />
        {tab === 'auth' && (
          <PickOne
            label="กรองตามเหตุการณ์"
            value={filters.event}
            onChange={(v) => setFilter('event', v)}
            allLabel="— ทั้งหมด —"
            options={[
              { value: 'login', label: EVENT_LABEL.login },
              { value: 'login_failed', label: EVENT_LABEL.login_failed },
              { value: 'logout', label: EVENT_LABEL.logout },
            ]}
          />
        )}
        <PickOne
          label="กรองตามผลลัพธ์"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          allLabel="— ทุกผลลัพธ์ —"
          options={Object.entries(STATUS_CLASS_LABEL)
            .filter(([k]) => k !== 'unknown')
            .map(([k, label]) => ({ value: k, label }))}
        />
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
          {/* `is-busy` IS WHAT THE RETAINED ROWS COST, AND IT IS CHEAP.
              Between the press and the answer these are the PREVIOUS page's
              rows under a pager that already reads `หน้า 3 / 11`. A fade and
              `aria-busy` are how that half-second reads as "fetching" rather
              than as a count disagreeing with the rows under it. On the pager
              itself: nothing — `‹` and `›` stay live, because pressing twice in
              a row is the thing this whole round was reported over. */}
          <div className="table-wrap is-paged" data-busy={busy ? '1' : undefined} aria-busy={busy}>
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

          {/* WHERE ดูย้อนหลังเพิ่ม AND ITS AMBER PANEL BOTH STOOD. The two of
              them are the paragraph over `page` above; what replaced them is
              one band that can go both ways and knows how long the list is.
              `total` comes off the same request as the rows, so the count
              under the table and the rows in it are one read. */}
          <TablePager
            label="บันทึกระบบ"
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPage={setPage}
            onPageSize={setPageSize}
          />
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

