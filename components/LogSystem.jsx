'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import {
  EVENT_LABEL, FAILED_LOGIN_ALERT, RETENTION_MIN_DAYS, STATUS_CLASS_LABEL,
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
      {tab !== 'overview' && (
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
        <div className="hint">
          ระบบบันทึกทุกการเรียกใช้งานผ่าน API ไว้เป็นข้อมูลจราจรทางคอมพิวเตอร์
          {' '}ตาม พ.ร.บ. ว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ มาตรา ๒๖
          {' '}· บันทึกนี้เพิ่มได้อย่างเดียว แก้หรือลบย้อนหลังไม่ได้ และไม่มีการเก็บเนื้อหาที่ส่งเข้ามา
          {' '}<strong>ไม่ว่ารูปแบบใด รวมทั้งรหัสผ่าน</strong>
        </div>

        {/* `.grid` — the same auto-fit row of `.stat` boxes the landing screens
            use, so these four read as the app's own tiles rather than as a
            widget belonging to this page. */}
        <div className="grid" style={{ marginTop: 4 }}>
          <Tile
            label="REQUESTS"
            value={data.requests}
            unit="ครั้ง"
            note={`ทั้งหมดในระบบ ${data.total.toLocaleString('th-TH')} รายการ`}
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
                  <div className="writes" style={{ height: `${d.n ? Math.round((d.writes / d.n) * 100) : 0}%` }} />
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
          note="นับเป็นบัญชี ไม่ใช่คน — บัญชีฝ่ายบุคคลใช้ร่วมกันทั้งแผนก"
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

      <RetentionNote retention={data.retention} oldest={data.oldest} total={data.total} />
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

/** One of the four counted lists under the chart. */
function Panel({ title, note, rows, empty, render }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="hint">{note}</div>
      {!rows?.length && <Empty>{empty}</Empty>}
      {rows?.length > 0 && (
        <ul className="log-tally">
          {rows.map((raw) => {
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
              aria-label="ค้นหาในบันทึกระบบ"
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
          <input type="date" max={today} value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
        </Field>
        <Field label="ถึงวันที่" note="รวมวันที่เลือกด้วย">
          <input type="date" max={today} value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
        </Field>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        {narrowed && (
          <button className="btn ghost sm" onClick={onClearFilters}>ล้างตัวกรองทั้งหมด</button>
        )}
        {/* The reason this screen has an export at all: the request comes from
            somebody who will never be given a login. See the route. */}
        <button className="btn ghost sm" onClick={download}>ดาวน์โหลด CSV ตามตัวกรอง</button>
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
                    <td data-label="การกระทำ">
                      <span className="log-act">
                        {r.event !== 'request' && (
                          <span className={`chip ev-${r.event}`}>{EVENT_LABEL[r.event]}</span>
                        )}
                        {r.write && <span className="chip edited">แก้ไขข้อมูล</span>}
                        {r.action}
                      </span>
                      <span className="log-sub mono">{r.method} {r.path}</span>
                    </td>
                    <td data-label="ผลลัพธ์">
                      <span className={`chip sc-${r.statusClass}`}>{r.status ?? '—'}</span>
                    </td>
                    <td data-label="ที่มา">
                      <span className="log-who mono">{r.ip || '—'}</span>
                      <span className="log-sub">{r.device}</span>
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

      {data && <RetentionNote retention={data.retention} />}

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

/**
 * How long these records are kept, said on the screen rather than in a comment.
 *
 * มาตรา ๒๖ puts a floor of ninety days under this, and the one thing an
 * administrator has to be able to answer without reading any source is whether
 * this system clears it. The answer depends on `LOG_RETENTION_DAYS`, which is
 * on the server and not on this screen, so the endpoint sends it.
 */
function RetentionNote({ retention, oldest, total }) {
  if (!retention) return null;
  return (
    <div className="hint" style={{ marginTop: 14, marginBottom: 0 }}>
      {retention.days
        ? `ระบบลบบันทึกที่เก่ากว่า ${retention.days} วันโดยอัตโนมัติ (ตั้งค่าที่ LOG_RETENTION_DAYS)`
        : 'ระบบเก็บบันทึกไว้ทั้งหมด ไม่มีการลบอัตโนมัติ'}
      {' '}· พ.ร.บ. คอมพิวเตอร์ มาตรา ๒๖ กำหนดให้เก็บข้อมูลจราจรทางคอมพิวเตอร์
      {' '}ไม่น้อยกว่า {RETENTION_MIN_DAYS} วัน
      {oldest && <> · บันทึกเก่าสุดที่มีคือ {atShort(oldest)}</>}
      {total != null && <> · รวม {total.toLocaleString('th-TH')} รายการ</>}
      {' '}· บันทึกนี้รวมอยู่ในไฟล์สำรองข้อมูลรายวันด้วย
    </div>
  );
}
