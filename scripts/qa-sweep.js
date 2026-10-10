/**
 * Browser sweep for the release gate — every screen × every role × seven widths,
 * both themes, print, and axe (WCAG 2.1 AA). See docs/qa-release.md §ชั้นที่ 3.
 *
 *   QA_BASE=http://127.0.0.1:3011 npm run qa:sweep
 *   QA_BASE=... QA_ROLE=hr npm run qa:sweep          # one role only
 *
 * ── It only reads ───────────────────────────────────────────────────────────
 *
 * It logs in, clicks the navigation and measures. It never presses a button
 * inside a screen, so it writes nothing but login sessions. It still has to be
 * pointed at a server backed by a QA database: the accounts it uses are the
 * seed's (`npm run seed`, password `primus123` unless SEED_PASSWORD said
 * otherwise), and the live database does not have them. QA_BASE has no default
 * for that reason — a sweep that silently ran against :3000 would be measuring
 * HR's screens with HR's data.
 *
 * ── What counts as a finding ────────────────────────────────────────────────
 *
 *   - a console error, an uncaught exception, or any 5xx response
 *   - the page itself scrolling sideways, or an element past the viewport edge
 *     that no scroll box contains
 *   - a button shorter than 24px
 *   - a <thead> still showing at ≤860px outside a scroll box (cards lost labels)
 *   - the sidebar at ≤860px, or the bottom bar above it
 *   - print wider than the page
 *   - any axe violation, light 1440 · dark 1440 · light 390
 *
 * Input text size is NOT checked: 15px at every width is the user's decision
 * of 2026-10-10 (docs/design.md), not a defect.
 *
 * Exit code 1 when anything was found. Items the user already decided to leave
 * are listed in the latest docs/plan-qa-fixes-*.md — compare before reporting.
 *
 * playwright-core drives a browser that is already installed (Chrome, else
 * Edge); it downloads none. CHROME_PATH points it at another one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const BASE = process.env.QA_BASE;
if (!BASE) {
  console.error('ตั้ง QA_BASE ก่อน — เช่น QA_BASE=http://127.0.0.1:3011 (server ที่ต่อฐาน QA ไม่ใช่ฐานจริง)');
  process.exit(2);
}
const PASSWORD = process.env.QA_PASSWORD || process.env.SEED_PASSWORD || 'primus123';
const ROLES = { employee: 'PM-0412', manager: 'PM-0100', hr: 'HR-001', admin: 'ADMIN' };
const ONLY = process.env.QA_ROLE;
const OUT = process.env.QA_OUT || path.join(os.tmpdir(), 'primus-ot-qa');
const WIDTHS = [1440, 1024, 861, 860, 640, 390, 360];
const SKIP = /ออกจากระบบ|พับเก็บแถบเมนู|ขยายแถบเมนู/;
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
fs.mkdirSync(OUT, { recursive: true });

async function launch() {
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH });
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ channel }); } catch { /* try the next one */ }
  }
  throw new Error('ไม่พบ Chrome หรือ Edge — ตั้ง CHROME_PATH ให้ชี้ไปที่ตัวที่มี');
}

function watch(page, sink) {
  // A 401 is the login screen asking who you are, not a fault.
  page.on('console', (m) => { if (m.type() === 'error' && !/401 \(Unauthorized\)/.test(m.text())) sink.push(`console: ${m.text().slice(0, 220)}`); });
  page.on('pageerror', (e) => sink.push(`pageerror: ${e.message.slice(0, 220)}`));
  page.on('response', (r) => { if (r.status() >= 500) sink.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function login(page, code) {
  await page.goto(BASE + '/');
  await page.locator('#login-code').fill(code);
  await page.locator('#login-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#login-code'), null, { timeout: 15000 });
  await settle(page);
}

const NAV = 'nav a, nav button, aside a, aside button';

async function navItems(page) {
  return page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null);
    // A collapsed sidebar repeats the label in its tooltip, so "AB" + "AB" is one name.
    const once = (s) => (s.length % 2 === 0 && s.slice(0, s.length / 2) === s.slice(s.length / 2) ? s.slice(0, s.length / 2) : s);
    return [...new Set(els.map((e) => once((e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' '))).filter(Boolean))];
  }, NAV);
}

async function clickNav(page, label) {
  // The visible text is label + live count + tooltip, so match on the front half with digits removed.
  const key = label.replace(/[\d()›]/g, '').trim();
  const half = key.slice(0, Math.max(4, Math.floor(key.length / 2))).trim();
  const loc = page.locator(NAV).filter({ hasText: half });
  for (let i = 0; i < await loc.count(); i++) {
    if (await loc.nth(i).isVisible()) { await loc.nth(i).click(); await settle(page); return true; }
  }
  const byAria = page.locator(`[aria-label="${label}"]`);
  if (await byAria.count() && await byAria.first().isVisible()) { await byAria.first().click(); await settle(page); return true; }
  return false;
}

/** Runs in the page. */
function probe(width) {
  const vw = document.documentElement.clientWidth;
  const res = { hscroll: Math.max(0, document.documentElement.scrollWidth - vw - 1), offscreen: [], shortButtons: [], visibleThead: [], nav: '' };
  const scroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return p;
    }
    return null;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''} "${(el.textContent || '').trim().slice(0, 30)}"`;
  for (const el of document.querySelectorAll('main *, header *, nav *')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !scroller(el) && getComputedStyle(el).position !== 'fixed') res.offscreen.push(name(el));
  }
  // `.link` is a button set as a word in running text; its height is the line's, by design.
  for (const el of document.querySelectorAll('button:not(.link), a.btn, [role=button]')) {
    if (!visible(el) || el.closest('table thead')) continue;
    const h = el.getBoundingClientRect().height;
    if (h < 24) res.shortButtons.push(`${name(el)} ${h.toFixed(0)}px`);
  }
  if (width <= 860) {
    for (const th of document.querySelectorAll('main table thead')) if (visible(th) && !scroller(th)) res.visibleThead.push(name(th.closest('table')));
  }
  const kinds = [...document.querySelectorAll('aside, nav')].filter(visible).map((n) => {
    const r = n.getBoundingClientRect();
    if (r.bottom >= innerHeight - 2 && r.width > innerWidth * 0.8) return 'bottom';
    return r.height > innerHeight * 0.6 && r.left < 5 ? 'side' : 'other';
  });
  res.nav = [...new Set(kinds)].join(',');
  res.offscreen = [...new Set(res.offscreen)].slice(0, 6);
  res.shortButtons = [...new Set(res.shortButtons)].slice(0, 6);
  return res;
}

async function axe(page) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, targets: v.nodes.slice(0, 3).map((x) => x.target.join(' ')) }));
  });
}

async function theme(page, t) {
  await page.emulateMedia({ colorScheme: t });
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, t);
  await page.waitForTimeout(250);
}

const browser = await launch();
const out = { base: BASE, at: new Date().toISOString(), errors: {}, responsive: [], axe: {} };

for (const [role, code] of Object.entries(ROLES)) {
  if (ONLY && role !== ONLY) continue;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  watch(page, errs);
  await login(page, code);
  const items = (await navItems(page)).filter((x) => !SKIP.test(x));
  console.log(`${role}: ${items.length} จอ`);

  for (const item of ['(หน้าแรก)', ...items]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await theme(page, 'light');
    const key = `${role} · ${item.slice(0, 32)}`;
    if (item !== '(หน้าแรก)' && !(await clickNav(page, item))) { out.responsive.push({ key, w: '-', problems: ['กดเมนูไม่ได้'] }); continue; }
    const before = errs.length;

    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w <= 640 ? 800 : 900 });
      await page.waitForTimeout(250);
      const r = await page.evaluate(probe, w);
      const expectNav = w <= 860 ? 'bottom' : 'side';
      const problems = [];
      if (r.hscroll) problems.push(`หน้าเลื่อนแนวนอน ${r.hscroll}px`);
      if (r.offscreen.length) problems.push(`ล้นจอ: ${r.offscreen.join(' | ')}`);
      if (r.shortButtons.length) problems.push(`ปุ่มเตี้ยกว่า 24px: ${r.shortButtons.join(' | ')}`);
      if (r.visibleThead.length) problems.push(`thead ยังแสดง: ${r.visibleThead.join(' | ')}`);
      if (!r.nav.includes(expectNav)) problems.push(`เมนูเป็น ${r.nav || 'ไม่มี'} ควรเป็น ${expectNav}`);
      if (problems.length) {
        out.responsive.push({ key, w, problems });
        await page.screenshot({ path: path.join(OUT, `${role}-${w}-${item.replace(/[^\w฀-๿]+/g, '_').slice(0, 20)}.png`) });
      }
    }

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.emulateMedia({ media: 'print' });
    const pr = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (pr > 1) out.responsive.push({ key, w: 'print', problems: [`พิมพ์แล้วกว้างเกินหน้า ${pr}px`] });
    await page.emulateMedia({ media: 'screen' });

    for (const [t, w] of [['light', 1440], ['dark', 1440], ['light', 390]]) {
      await page.setViewportSize({ width: w, height: 900 });
      await theme(page, t);
      for (const v of await axe(page)) {
        (out.axe[v.id] ||= { impact: v.impact, help: v.help, where: [] }).where.push({ at: `${key} @${t}/${w}`, n: v.n, targets: v.targets });
      }
    }
    if (errs.length > before) out.errors[key] = errs.slice(before);
  }
  await ctx.close();
}
await browser.close();

const file = path.join(OUT, `sweep-${ONLY || 'all'}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 1));

const nErr = Object.keys(out.errors).length;
const nAxe = Object.keys(out.axe).length;
console.log(`\n== console error / 5xx: ${nErr ? '' : 'ไม่มี'}`);
for (const [k, v] of Object.entries(out.errors)) console.log(`${k}\n  ${v.join('\n  ')}`);
console.log(`\n== responsive: ${out.responsive.length || 'ไม่มี'}`);
for (const r of out.responsive) console.log(`${r.key} @${r.w}: ${r.problems.join(' ;; ')}`.slice(0, 400));
console.log(`\n== axe: ${nAxe || 'ไม่มี'}`);
for (const [id, v] of Object.entries(out.axe)) console.log(`${id} [${v.impact}] ${v.help} — ${v.where.length} มุมมอง เช่น ${v.where[0].at}: ${v.where[0].targets.join(' , ')}`);
console.log(`\nผลเต็ม: ${file}`);
process.exit(nErr || out.responsive.length || nAxe ? 1 : 0);
