import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ROLES, approverRolesFor, isSigner, readsCompanyReports,
} from '../lib/roles.js';
import { mayCorrectEntries } from '../lib/entries.js';

/**
 * คู่มือการใช้งาน — the screen every บทบาท can OPEN, showing only what their
 * บทบาท can DO.
 *
 * WHAT THIS FILE IS FOR. Two requests built this screen and they pull in
 * opposite directions, which is the whole reason both halves need pinning:
 *
 *   2026-09-09, morning — *a manual, as a menu page, ให้ทุกสิทธิ์ดูได้*. That
 *   is a promise about the DOOR, and a row with no condition on it is one `&&`
 *   away from having one.
 *
 *   2026-09-09, later — *แยกเป็นคู่มือหน้าเดียว แบบเลื่อนเป็น section · แสดง
 *   เฉพาะวิธีใช้งานที่ใช้งานได้ตามสิทธิ์*. That is a promise about the
 *   CONTENTS, and it is the one that makes the first easy to break by accident:
 *   the obvious way to hide ตั้งค่าระบบ from a พนักงาน is a condition on the
 *   menu row, and that hides the whole manual from them with nothing on screen
 *   saying one exists.
 *
 * So the two are tested apart. `both menus reach it` below is the door and has
 * not changed since it was written; everything under ── สิทธิ์ ── is the
 * contents and is new.
 *
 * AND A THIRD PROMISE, ASKED FOR IN THE SAME BREATH AS THE REWRITE:
 * *ภาพประกอบต้องมี ui ทั้งแบบหน้าจอ มือถือ และ pc*. A `Shot` with only a
 * `desk` renders perfectly and looks finished — the failure is invisible on the
 * machine of whoever writes it, because that machine is a PC.
 *
 * Source-shape assertions, for the reason test/roleNavTabs.test.js gives:
 * `components/App.jsx` is a client component with no export worth calling. The
 * ONE thing here that is not source-shape is the gate evaluation, which runs
 * the real expressions against the real predicates — see it below.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * LINE ENDINGS NORMALISED BEFORE ANYTHING BELOW READS A CHARACTER, for the
 * reason `.gitattributes` gives: this repository is checked out CRLF on the
 * machine it is developed on and LF on the Linux box that serves the app, so
 * an assertion spelling a multi-line shape with `\n` reports which CHECKOUT
 * it ran on rather than what the code says.
 *
 * Every assertion here is a regex with `\n` in it, matched against a file
 * read off disk, and the suite ran green on the machine this was written on —
 * the first run happened before the file had been checked out again. All five
 * multi-line assertions then missed on the next CRLF checkout, against a tree
 * with nothing wrong in it: the break-inside rule matched nothing, and
 * `SECTION_RE` parsed 0 sections and SAID so, which is the only reason this
 * was noticed rather than passing vacuously.
 *
 * The fix belongs in the `read` helper, before anything reads a character —
 * not "normalise when you notice". See the header of
 * test/adminApproval.test.js, which had it right first.
 */
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const jsx = read('components/App.jsx');
const manual = read('components/ManualView.jsx');
const icons = read('components/icons.jsx');

/**
 * The source with its comments taken out.
 *
 * NEEDED BECAUSE THIS REPOSITORY'S COMMENTS NAME WHAT THEY REJECTED. The header
 * of ManualView says why the screen is not a `tabs.push` and why the rail is
 * not a button calling `scrollIntoView` — both are the reasoning worth keeping,
 * and both would fail a check that greps the whole file for the thing it wants
 * absent. Stripping comments first is what makes "this must not appear" mean
 * "this must not RUN".
 */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const manualCode = codeOnly(manual);

/** The builder alone — the same cut test/roleNavTabs.test.js makes. */
const builder = jsx.slice(jsx.indexOf('const tabs = ['), jsx.indexOf('async function logout()'));

test('the manual is a screen with a heading, drawn from the same tab state as the rest', () => {
  assert.match(jsx, /manual: \['คู่มือการใช้งาน', 'USER GUIDE'\],/,
    'the screen lost its entry in PAGE — the app bar would draw no title over it');
  assert.match(jsx, /tab === 'manual' && \(\s*<ManualView/,
    'nothing renders the screen');
  assert.match(jsx, /import ManualView from '\.\/ManualView\.jsx';/);
});

/**
 * THE MENU GOES DOWN AS A PROP, and this is the assertion that keeps the
 * picture in เมนูของคุณ from becoming a fourth hand-written copy of the menu.
 *
 * `navGroups` and `barSlots` are the arrays the real sidebar and the real phone
 * bar are drawn from. Rebuilt inside ManualView — which is the shape somebody
 * reaches for when the prop is missing — the manual would show a row the reader
 * does not have on the first day a tab moves, and nothing would fail.
 */
test('the reader’s own menu is handed to the manual rather than rebuilt in it', () => {
  assert.match(jsx, /<ManualView user=\{user\} navGroups=\{navGroups\} barSlots=\{barSlots\} \/>/);
  assert.match(manual, /export default function ManualView\(\{ user, navGroups = \[\], barSlots = \[\] \}\)/);
  for (const forbidden of ['NAV_GROUPS', 'BAR_SLOTS', 'tabs.push', 'tabs.filter']) {
    assert.ok(!manualCode.includes(forbidden),
      `the manual is building the menu itself (${forbidden}) instead of drawing the one it was given`);
  }
});

test('it is not a tab, so no บทบาท gains a fifth column on the phone bar', () => {
  assert.ok(!/key: 'manual'/.test(builder),
    'the manual was pushed into `tabs` — see test/roleNavTabs.test.js for the bar this widens');
});

/**
 * THE ONE THIS FILE WAS WRITTEN FOR, AND IT IS UNCHANGED BY THE GATING.
 *
 * Two rows, one per bar, and neither may grow a condition: not a บทบาท, not a
 * flag on the session, not a count. What is inside the screen is now cut to the
 * reader — see ── สิทธิ์ ── below — and that makes this MORE important rather
 * than less: the cut has to happen on the far side of this door, or a บทบาท
 * with one readable section loses the manual entirely.
 *
 * The rows are found by the handler they carry rather than by their label, so
 * renaming the button does not quietly stop this from checking anything.
 */
test('both menus reach it, and neither row is gated on บทบาท', () => {
  for (const [what, go] of [['the sidebar', "goTab('manual')"], ['the drawer', "onGo('manual')"]]) {
    const at = jsx.indexOf(go);
    assert.ok(at > 0, `${what} no longer has a way into the manual`);
    /* The whole button, from the tag that opens it to the press. A condition on
       this row would sit inside that span — `{isSigner(user.role) && <button…`
       puts it just before, which is why the window reaches back past the tag. */
    const row = jsx.slice(jsx.lastIndexOf('<button', at) - 200, at);
    assert.ok(!/user\.role|isSigner|readsCompanyReports|maySubmitOt|seesEveryRole/.test(row),
      `${what}'s คู่มือ row grew a role rule — it is meant to be there for every บทบาท`);
  }
});

/**
 * The sidebar's row wears `.nav`'s own clothes rather than a class of its own.
 *
 * Not tidiness: the collapsed rail's rules — the 44px square, the label that
 * goes, the tooltip that replaces it — are all written against `.nav`, and a
 * row with a private class is a row that keeps its sentence at 68px wide the
 * day somebody collapses the rail and nobody re-reads this file.
 */
test('the sidebar row is a second .nav, so the collapsed rail already knows it', () => {
  assert.match(jsx, /<nav className="nav nav-help" aria-label="ช่วยเหลือ">/);
  assert.match(read('app/styles.css'), /\.nav-help \{[^}]*margin-top:/,
    'the help row lost the gap that separates it from the last menu block');
});

/* ══ สิทธิ์ — what each บทบาท is shown ═══════════════════════════════════════
 *
 * The gates are one-line arrow functions over the object `permissionsOf`
 * returns, which makes them the one part of a `.jsx` file this runner can
 * actually EXECUTE: pull each expression out of the source, build `p` here from
 * the real predicates in lib/roles.js and lib/entries.js, and ask it.
 *
 * That is worth the small parser. A source-shape test would say the word
 * `p.correct` appears next to ตั้งค่าระบบ; this says a พนักงาน does not get
 * that section, which is the thing anybody actually cares about.
 */

const SECTION_RE = /^  \{\n    key: '([a-z]+)',\n    group: '([^']+)',\n    icon: '([a-zA-Z]+)',\n    title: '([^']+)',/gm;
const sections = [...manual.matchAll(SECTION_RE)]
  .map(([, key, group, icon, title]) => ({ key, group, icon, title }));

const gates = [...manual.matchAll(/^    gate: (\([^)]*\) => [^\n]+),$/gm)].map((m) => m[1]);

/** The same object ManualView builds, from the same four predicates. */
const permissionsFor = (role) => ({
  role,
  submit: ROLES.includes(role),
  sign: isSigner(role),
  company: readsCompanyReports(role),
  correct: mayCorrectEntries({ role }),
  logs: role === 'admin',
  readOnly: readsCompanyReports(role) && !mayCorrectEntries({ role }),
  firstStep: approverRolesFor(role),
});

const visibleFor = (role) => {
  const p = permissionsFor(role);
  // eslint-disable-next-line no-new-func
  return sections.filter((_, i) => new Function('p', `return (${gates[i]})(p);`)(p));
};

test('every section is found, and every one of them carries a gate', () => {
  assert.ok(sections.length >= 15,
    `only ${sections.length} sections were parsed — the shape of SECTIONS changed and this file is now checking nothing`);
  assert.equal(gates.length, sections.length,
    'a section is missing its `gate`, or a gate was written across more than one line');
  const keys = sections.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'two sections share a key — one of them cannot be linked to');
});

/**
 * A GATE MAY READ THE PERMISSION OBJECT AND NOTHING ELSE.
 *
 * `gate: (p) => p.role === 'hr'` would pass every other test in this file and
 * would be the fifth place this app decides who may correct an entry. The four
 * that already do are imported at the top of ManualView; a บทบาท name inside a
 * gate means one of them was reached past.
 *
 * The flags are listed rather than pattern-matched so that adding one is a
 * deliberate edit here as well — a new flag is a new permission, and this file
 * is where somebody notices it needs `permissionsOf` to derive it from a real
 * predicate rather than from a role literal.
 */
test('no gate names a บทบาท — they read only the flags permissionsOf derives', () => {
  const FLAGS = ['submit', 'sign', 'company', 'correct', 'logs', 'readOnly', 'firstStep'];
  for (const gate of gates) {
    for (const role of ROLES) {
      assert.ok(!gate.includes(`'${role}'`),
        `a gate tests for the บทบาท ${role} directly: ${gate}`);
    }
    const reads = [...gate.matchAll(/\bp\.([a-zA-Z]+)/g)].map((m) => m[1]);
    for (const flag of reads) {
      assert.ok(FLAGS.includes(flag),
        `a gate reads p.${flag}, which permissionsOf does not derive: ${gate}`);
    }
  }
});

test('permissionsOf is built from the predicates that already decide these things', () => {
  assert.match(manual, /import \{\n  ROLE_LABEL_TH, approverRolesFor, isSigner, readsCompanyReports, roleLabel,\n\} from '@\/lib\/roles\.js';/);
  assert.match(manual, /import \{ mayCorrectEntries \} from '@\/lib\/entries\.js';/);
  const fn = manual.slice(manual.indexOf('export function permissionsOf'), manual.indexOf('/* ── the mock'));
  for (const call of ['readsCompanyReports(role)', 'mayCorrectEntries(user)', 'isSigner(role)', 'approverRolesFor(role)']) {
    assert.ok(fn.includes(call), `permissionsOf stopped asking ${call}`);
  }
  /* การเงิน's read-only reports are DERIVED — company minus correct — and not a
     บทบาท test, so a second บทบาท given the same reading right gets the same
     wording without anybody remembering this line. */
  assert.match(fn, /readOnly: company && !correct,/);
});

/**
 * NOBODY OPENS THE MANUAL AND FINDS NOTHING, and the gating makes that possible
 * for the first time: every section carrying a `gate` means every section can
 * be absent, and a บทบาท the gates all happen to miss gets a card, a rail with
 * no rows and a page with no text. It would be reported as "the manual is
 * broken", which is a report nobody can act on.
 */
test('every บทบาท is shown a manual, and สิทธิ์ only ever adds to it', () => {
  const counts = new Map(ROLES.map((role) => [role, visibleFor(role).length]));

  for (const role of ROLES) {
    assert.ok(counts.get(role) >= 6,
      `บทบาท ${role} is shown only ${counts.get(role)} sections — that is not a manual`);
  }

  /* พนักงาน is the floor: the roster's 143 พนักงาน must not be reading about
     ตั้งค่าระบบ. */
  assert.equal(counts.get('employee'), Math.min(...counts.values()),
    'พนักงาน is no longer the shortest manual');
  assert.ok(counts.get('admin') > counts.get('employee'),
    'every บทบาท sees the same manual — the สิทธิ์ cut has stopped cutting');

  /**
   * ผู้ดูแลระบบ IS NOT THE CEILING, AND THAT IS NOT A BUG.
   *
   * `isSigner` is false for them — they sign the SECOND step, like ฝ่ายบุคคล —
   * so รายการรออนุมัติ and รายงาน OT ประจำทีม are screens they do not have, and
   * the sections about those two are correctly absent. Asserting they see all
   * eighteen would be asserting the manual describes screens the app does not
   * give them, which is the failure this whole cut exists to end.
   *
   * What IS true of them: everything ฝ่ายบุคคล has plus บันทึกประวัติระบบ, and
   * that difference is exactly one section.
   */
  assert.equal(counts.get('admin'), counts.get('hr') + 1,
    'ผู้ดูแลระบบ and ฝ่ายบุคคล differ by something other than บันทึกประวัติระบบ');

  /* AND NO SECTION IS WRITTEN FOR NOBODY. A gate that no บทบาท satisfies is a
     หัวข้อ that exists in the source, is maintained, and is read by no one —
     which is invisible from every direction except this one. */
  const everSeen = new Set(ROLES.flatMap((role) => visibleFor(role).map((s) => s.key)));
  for (const s of sections) {
    assert.ok(everSeen.has(s.key), `no บทบาท is ever shown ${s.key} — its gate cannot be satisfied`);
  }
});

/**
 * THE SECTIONS THAT MUST NOT REACH A พนักงาน, named one at a time.
 *
 * A count says the cut happened; this says it cut in the right place. Both are
 * needed and the count is the one that would survive a gate accidentally
 * inverted — eighteen becomes eight either way round.
 */
test('the four screens a พนักงาน cannot open have no วิธีใช้ in their manual', () => {
  const employee = visibleFor('employee').map((s) => s.key);
  for (const key of ['settings', 'logs', 'confirm', 'correct', 'approve', 'company']) {
    assert.ok(!employee.includes(key),
      `a พนักงาน is being told how to use ${key}, which is not in their menu`);
  }
  for (const key of ['start', 'menu', 'file', 'flow', 'fix', 'print', 'rules', 'help']) {
    assert.ok(employee.includes(key), `a พนักงาน lost ${key}, which is theirs`);
  }

  /* การเงิน is the บทบาท this cut is most likely to get wrong, because they are
     a ผู้เซ็น AND read the whole company's month AND may write to none of it.
     All three have to be true of their manual at once. */
  const finance = visibleFor('finance').map((s) => s.key);
  assert.ok(finance.includes('approve'), 'การเงิน lost the queue they sign');
  assert.ok(finance.includes('company'), 'การเงิน lost the month they read');
  assert.ok(!finance.includes('correct') && !finance.includes('settings'),
    'การเงิน is being shown how to edit — they read those screens and write to none of them');

  /* ฝ่ายบุคคล sign the second step, not the first — no คิวรออนุมัติ of their
     own, and the section about it is not theirs. */
  assert.ok(!visibleFor('hr').map((s) => s.key).includes('approve'),
    'ฝ่ายบุคคล is being shown the ผู้เซ็นขั้นแรก queue, which is not a screen they have');
});

/**
 * THE READ-ONLY SENTENCE IS ON THE SCREEN, not only in the gate.
 *
 * HR asked for การเงิน's shape in exactly these words on 2026-09-03 —
 * *เห็นเมนู … แต่ไม่สามารถแก้ไขข้อมูลได้* — and a manual that shows somebody a
 * screen without saying they cannot write to it has described a different
 * screen from the one they will open.
 */
test('a บทบาท that reads without writing is told so, in the section itself', () => {
  assert.match(manual, /p\.readOnly[\s\S]{0,80}คุณเปิดอ่านได้ แต่แก้ไขข้อมูลไม่ได้/,
    'the read-only label came off the section header');
  assert.match(manual, /คุณเปิดสองหน้านี้ได้ แต่แก้ไขอะไรไม่ได้/,
    'the sentence saying nothing on those two screens writes is gone');
});

/* ══ ภาพประกอบ ═══════════════════════════════════════════════════════════════ */

/**
 * EVERY UI ILLUSTRATION IS DRAWN FOR BOTH DEVICES.
 *
 * Asked for on 2026-09-09 — *ภาพประกอบต้องมี ui ทั้งแบบหน้าจอ มือถือ และ pc* —
 * and this is the promise that breaks silently. A `Shot` given only `desk`
 * renders, looks finished, and is missing exactly the half that the reader
 * holding a phone needs; the person who wrote it is sitting at the other one.
 *
 * Counted rather than parsed, because a `Shot`'s two props each contain nested
 * self-closing JSX and matching the closing tag would be a small parser for no
 * more certainty: three counts that must agree cannot be satisfied by a Shot
 * with a prop missing.
 */
test('every ภาพประกอบ of a screen is drawn for both คอมพิวเตอร์ and มือถือ', () => {
  const shots = (manual.match(/<Shot\b/g) || []).length;
  const desks = (manual.match(/desk=\{\(/g) || []).length;
  const phones = (manual.match(/phone=\{\(/g) || []).length;
  assert.ok(shots >= 8, `only ${shots} ภาพประกอบ — the steps lost most of their pictures`);
  assert.equal(desks, shots, 'a Shot is missing its `desk` — one device is undrawn');
  assert.equal(phones, shots, 'a Shot is missing its `phone` — the reader on a phone gets a picture of a desktop');

  /* Both drawings survive the phone breakpoint. Hiding one at a narrow width is
     the obvious way to make the pair fit and it defeats the whole point: the
     device you are reading ON is not the device the step is about. */
  const css = read('app/styles.css');
  const at900 = css.indexOf('@media (max-width: 900px)');
  assert.ok(at900 > 0, 'the manual lost its phone breakpoint');
  const narrow = css.slice(at900, css.indexOf('@media (max-width: 640px)', at900));
  assert.match(narrow, /\.mshot-pair \{ grid-template-columns: minmax\(0, 1fr\); \}/,
    'the pair no longer stacks on a phone');
  assert.ok(!/\.mshot-one[^{]*\{[^}]*display: none/.test(css),
    'one of the two drawings is being hidden rather than stacked');
});

/**
 * A DRAWING MADE OF TEXT NEEDS A LABEL, and these are made entirely of text —
 * an unlabelled one is read aloud as a wireframe's worth of loose words between
 * two paragraphs that already said the same thing. `Shot` and `Diagram` both
 * take `alt` and put it on `role="img"`, with the drawing itself `aria-hidden`.
 */
test('every ภาพประกอบ carries one sentence saying what it shows', () => {
  const pictures = (manual.match(/<Shot\b/g) || []).length + (manual.match(/<Diagram\b/g) || []).length;
  const alts = (manual.match(/\balt=/g) || []).length;
  assert.equal(alts, pictures, 'a ภาพประกอบ has no `alt`');
  assert.match(manual, /<figure className="mshot" role="img" aria-label=\{alt\}>/);
  assert.match(manual, /<div className="mshot-pair" aria-hidden="true">/);
});

/**
 * THE TWO KINDS ARE KEPT APART ON PURPOSE.
 *
 * `Diagram` takes no device at all, and it must stay that way: a route through
 * two signatures and the way a night shift is cut into rate columns are facts
 * about the SYSTEM. Drawn twice under บนคอมพิวเตอร์ / บนมือถือ they would say
 * there are two of them, which is the one thing a manual about an approval
 * chain must not say.
 */
test('a diagram of the system is drawn once, and takes no device', () => {
  const diag = manual.slice(manual.indexOf('function Diagram('), manual.indexOf('function FlowDiagram('));
  for (const forbidden of ['desk', 'phone', 'มือถือ', 'คอมพิวเตอร์']) {
    assert.ok(!diag.includes(forbidden), `Diagram grew a device (${forbidden}) — it describes the system, not a screen`);
  }
});

/**
 * ── ONE PICTURE PER ขั้นตอน, NOT ONE PER หัวข้อ ────────────────────────────
 *
 * Asked for on 2026-09-10: *เพิ่มเติมภาพ ui ประกอบให้ครบทุกหัวข้อและทุกขั้นตอน*.
 *
 * IT WAS ALREADY WRITTEN DOWN AS DONE BEFORE IT WAS TRUE, which is why it is a
 * test now and not a habit: docs/hr-briefing.md told ฝ่ายบุคคล *ทุกหัวข้อมี
 * ภาพประกอบเป็นขั้นตอนแล้ว* while SEVEN หัวข้อ had no drawing at all — บันทึก
 * OT แทนคนอื่น, รายงาน OT ประจำทีม, รายงาน OT แยกแผนก, ยืนยันขั้นที่สอง,
 * แก้ใบย้อนหลัง, บันทึกประวัติระบบ and ปัญหาที่พบบ่อย — and 45 of the 63
 * ขั้นตอน were prose alone.
 *
 * A ขั้นตอน is the unit and not the section, because the picture is what the
 * reader checks their own screen against while doing that one step. A section
 * with a picture on its first step and none on the four below it looks
 * illustrated in a table of contents and is not illustrated where it is read.
 *
 * `<FlowDiagram` and `<RateDiagram` count: they are `Diagram`s under a name,
 * and the two steps that use them are drawings of the system rather than of a
 * screen. What does not count is prose, a table of สถานะ chips, or a `hint`.
 */
const stepFigures = () => {
  const body = manual.slice(manual.indexOf('const SECTIONS = ['), manual.indexOf('export const sectionsFor'));
  const heads = [...body.matchAll(/^  \{\n    key: '([a-z]+)',/gm)];
  return heads.map((h, i) => {
    const slice = body.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : body.length);
    const steps = slice.split('<li className="manual-step">').slice(1);
    return {
      key: h[1],
      steps: steps.map((s) => (/<(Shot|Diagram|FlowDiagram|RateDiagram)\b/.test(s) ? 1 : 0)),
    };
  });
};

test('every หัวข้อ and every ขั้นตอน inside it carries a ภาพประกอบ', () => {
  const found = stepFigures();
  assert.equal(found.length, sections.length,
    'the ขั้นตอน parser and the section parser disagree — one of them is reading a shape that changed');
  for (const s of found) {
    assert.ok(s.steps.length > 0, `หัวข้อ ${s.key} has no ขั้นตอน at all`);
    const blank = s.steps.reduce((n, f) => n + (f ? 0 : 1), 0);
    assert.equal(blank, 0,
      `หัวข้อ ${s.key} has ${blank} ขั้นตอน with no ภาพประกอบ — a step is what a reader follows with the screen in front of them`);
  }
});

/**
 * ── A `Body` MAY READ ONLY WHAT IT WAS HANDED ─────────────────────────────
 *
 * `<s.Body {...ctx} />` passes `p`, `navGroups` and `barSlots`. A `Body` that
 * says `Body: () => (` and then reads `p.correct` inside its JSX is a
 * ReferenceError — not a wrong sentence, a WHITE SCREEN for whichever บทบาท
 * the gate lets in — and nothing else in this file would have caught it: the
 * gates are executed here, the bodies are not.
 *
 * IT HAPPENED, on 2026-09-10. บันทึก OT แทนคนอื่น had a `p.correct` ternary
 * carrying a second paragraph for ฝ่ายบุคคล; the gate was narrowed to `p.sign`
 * the same day, which left the branch unreachable, and the `{ p }` came off the
 * signature with it while the reference stayed. Every ผู้เซ็น opening the
 * manual would have hit it.
 */
test('no Body reads a prop it did not destructure', () => {
  const body = manual.slice(manual.indexOf('const SECTIONS = ['), manual.indexOf('export const sectionsFor'));
  const heads = [...body.matchAll(/^  \{\n    key: '([a-z]+)',/gm)];
  assert.ok(heads.length >= 15, 'the SECTIONS shape changed — this test is reading nothing');
  for (const [i, h] of heads.entries()) {
    const slice = body.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : body.length);
    const sig = slice.match(/\n {4}Body: (\([^)]*\)) =>/);
    assert.ok(sig, `หัวข้อ ${h[1]} has no Body, or its signature spans more than one line`);
    const code = codeOnly(slice.slice(slice.indexOf(sig[0])));
    for (const prop of ['p', 'navGroups', 'barSlots']) {
      const used = prop === 'p'
        ? /[^a-zA-Z0-9_.]p\./.test(code)
        : new RegExp(`[^a-zA-Z0-9_.]${prop}[^a-zA-Z0-9_]`).test(code);
      if (!used) continue;
      assert.ok(new RegExp(`[{,]\\s*${prop}\\s*[,}]`).test(sig[1]),
        `หัวข้อ ${h[1]} reads \`${prop}\` but its Body signature is \`${sig[1]}\` — that is a ReferenceError on the screen, not a missing sentence`);
    }
  }
});

test('every section draws an icon that exists', () => {
  const declared = new Set(
    [...icons.slice(icons.indexOf('const ICONS = {')).matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1]),
  );
  for (const s of sections) {
    // `Icon` draws NOTHING for a name it does not know, and says nothing about
    // it — so a typo here is an empty green tile, on every reader's screen.
    assert.ok(declared.has(s.icon), `${s.key} asks for the icon '${s.icon}', which components/icons.jsx does not have`);
  }
  /* The rail groups by these and draws no heading for an empty one, so a name
     that is not in GROUPS is a section nobody can reach from the rail. */
  const groups = manual.slice(manual.indexOf('const GROUPS = Object.freeze(['), manual.indexOf('const SECTIONS = ['));
  for (const s of sections) {
    assert.ok(groups.includes(`'${s.group}'`),
      `${s.key} is in the group ${s.group}, which the rail does not draw`);
  }
});

/* ══ หน้าเดียว ═══════════════════════════════════════════════════════════════ */

/**
 * IT READ "the screen is itself a menu" UNTIL 2026-09-09.
 *
 * The หัวข้อ used to open OVER the index, on the shell's back stack, and the
 * index was the screen. Asked to be one scrolling page instead. What is checked
 * here is the state that went away: `openKey` was the whole of it, and a
 * reader-visible half-rewrite — sections rendered inline but the old overlay
 * still reachable — is the shape a partial revert takes.
 */
test('the หัวข้อ overlay is gone, and the sections are the page', () => {
  for (const gone of ['openKey', 'setOpenKey', 'manual-item', 'manual-menu', 'manual-back']) {
    assert.ok(!manualCode.includes(gone), `the หัวข้อ overlay is still half here: ${gone}`);
  }
  /* Rules and not mentions: the block that replaced them opens by naming all
     five, which is the record AGENTS.md asks for and would fail a plain grep. */
  const css = codeOnly(read('app/styles.css'));
  for (const gone of ['.manual-item', '.manual-menu {', '.mi-icon', '.mi-chev', '.manual-back']) {
    assert.ok(!css.includes(gone),
      `${gone} is still in the stylesheet with nothing drawing it — a dead ruleset is one somebody greps and believes`);
  }
  assert.match(manual, /<section key=\{s\.key\} id=\{`sec-\$\{s\.key\}`\}/,
    'the sections lost the ids the rail links to');
});

/**
 * THE RAIL IS PLAIN ANCHORS.
 *
 * `#sec-approve` survives a reload, can be sent to somebody, and moves the page
 * with the browser's own scrolling — which honours `prefers-reduced-motion`
 * without being told. A button calling `scrollIntoView` is a hand-built copy of
 * all three and takes the หัวข้อ off the back stack.
 *
 * And `scroll-margin-top` is not decoration: the app bar is `position: sticky`,
 * so without it every jump lands with the heading the reader pressed for
 * underneath the bar.
 */
test('the rail links, and a link lands below the app bar rather than under it', () => {
  assert.match(manual, /<a key=\{s\.key\} className="manual-rail-a" href=\{`#sec-\$\{s\.key\}`\}>/);
  assert.ok(!manualCode.includes('scrollIntoView'), 'the rail is scrolling the page by hand');
  const css = read('app/styles.css');
  assert.match(css, /\.manual-sec \{ scroll-margin-top: calc\(62px \+ 14px\); \}/,
    'a jump now lands with the section heading under the sticky app bar');
  assert.match(css, /\.manual-rail \{[\s\S]{0,200}position: sticky; top: calc\(62px \+ 12px\);/,
    'the rail no longer follows the reader down the page');
});

/**
 * ── ⚠ ON A PHONE THE RAIL OPENS DOWNWARDS, AND MUST NOT GO BACK SIDEWAYS ────
 *
 * Reported on 2026-09-10 as *แถบเลือกหัวข้อ ค่อนข้างใช้งานยาก*. The rail wore
 * the shape the app's own menu wears on a phone — pills in a row that scrolls
 * sideways — and measured on a 390px screen that put **two and a half of a
 * พนักงาน's eight หัวข้อ on screen** (the strip 366px, a chip 116px), with the
 * other five or twelve behind a swipe that has no scrollbar and no edge fade.
 * A chip was **32px** tall against the 44px a finger is drawn to, and the group
 * headings were switched off, because a heading cannot be a chip in a row.
 *
 * The shape that replaced it is the one the phone has room for: a pinned row
 * that opens the whole list downwards, headings and all. What is pinned here is
 * every part of that a later tidy-up would undo one at a time — the button, the
 * headings being back, the 44px row, and the jump clearing BOTH bars.
 *
 * AND THAT THE DESKTOP COLUMN IS UNTOUCHED, which is the half that has no
 * screenshot to catch it: `display: contents` on the wrapper is what keeps the
 * links direct children of `.manual-rail`, so every rule written for the column
 * still reaches them. Replaced with `display: block` or `flex`, the desktop
 * rail loses its own layout and nothing in this file would have said so.
 */
test('on a phone the หัวข้อ list opens downwards, and the desktop column is untouched', () => {
  const css = read('app/styles.css');
  const phone = css.slice(css.indexOf('@media (max-width: 900px) {'));
  const block = phone.slice(0, phone.indexOf('@media (max-width: 640px)'));
  /* Rules and not prose: the note over this block records the strip it
     replaced, spelling included, which a plain search would read as the strip
     still being here. */
  const rules = codeOnly(block);

  // The strip, in the two spellings that made it one.
  assert.ok(!/\.manual-rail \{[^}]*flex-direction: row/.test(rules),
    'the rail is a row again — eight Thai titles do not fit across a phone');
  assert.ok(!/\.manual-rail \{[^}]*overflow-x: auto/.test(rules),
    'the rail scrolls sideways again, which is the swipe that was reported');
  assert.ok(!/\.manual-rail-h \{ display: none/.test(rules),
    'the group headings are switched off again — the list is flat titles with no orientation');

  // The pinned row that opens it, and the panel it opens.
  assert.match(manual, /className="manual-rail-btn"/, 'the phone lost the row that opens the list');
  assert.match(manual, /aria-expanded=\{open\}/, 'the button does not say whether it is open');
  assert.match(manual, /onClick=\{\(\) => setOpen\(false\)\}/,
    'pressing a หัวข้อ no longer puts the panel away, so it lands under the panel');
  assert.match(block, /\.manual-rail\.open \.manual-rail-list \{ display: block; \}/);
  assert.match(block, /max-height: min\(58vh, 420px\); overflow-y: auto; overscroll-behavior: contain;/,
    'the panel no longer scrolls inside itself — fifteen หัวข้อ is taller than a phone');

  // A row a finger is meant to hit.
  assert.match(block, /\.manual-rail-a \{\n {4}min-height: 44px;/,
    'the rows are back under 44px');

  /* THE JUMP HAS TWO BARS TO CLEAR, NOT ONE. The rail is sticky under a sticky
     app bar, so `calc(62px + 14px)` — right on a desktop, where the rail is
     beside the text — lands the หัวข้อ underneath the row that was pressed. */
  assert.match(block, /\.manual-sec \{ scroll-margin-top: calc\(62px \+ 48px \+ 12px\); \}/,
    'a jump lands under the pinned row on a phone');

  // …and the desktop column, which has no picture of itself in this file.
  assert.match(css, /\.manual-rail-btn \{ display: none; \}\n\.manual-rail-list \{ display: contents; \}/,
    'the wrapper became a box on the desktop, so the column lost its own layout');
});

/**
 * THE STEP NUMBERS ARE A CSS COUNTER.
 *
 * Written into the markup they drift the first time a step is inserted in the
 * middle, and the drift is silent: the list still counts 1 2 3 4 on screen
 * because a reader reads the numbers, not the source. The pins inside a drawing
 * are deliberately NOT these numbers — they count within their own picture and
 * the caption says what they point at, so the two can never disagree.
 */
test('the steps are numbered by the stylesheet, never by hand', () => {
  const css = read('app/styles.css');
  assert.match(css, /\.manual-steps \{ counter-reset: mstep;/);
  assert.match(css, /\.manual-step \{ counter-increment: mstep;/);
  assert.match(css, /content: counter\(mstep\);/);
});

/**
 * THE MANUAL MAY NOT PRINT A POLICY FIGURE — AND THAT NOW COVERS THE PICTURES.
 *
 * เพดาน, the rounding block, เวลางานปกติ, the minimum, how many days ahead a
 * request may be filed — every one of those is a value ฝ่ายบุคคล change on
 * ตั้งค่าระบบ without touching this repository, and a number written here goes
 * stale the first time they do. docs/hr-briefing.md carries that table with the
 * date it was read off the machine beside it, which is the shape a figure has
 * to have to be worth anything; a copy in the app with no date on it would be
 * the version people believe.
 *
 * THE DRAWINGS ARE THE NEW RISK. A mock of a form wants to be filled in, and
 * the natural thing to fill เวลางานปกติ with is the real one. `RateDiagram`
 * draws the CUT rather than a timeline for exactly this reason — an axis wants
 * hours on it and every hour it could carry belongs to ตั้งค่าระบบ.
 */
test('it points at ตั้งค่าระบบ for the numbers rather than restating them', () => {
  assert.match(manual, /ฝ่ายบุคคลตั้งเองได้ที่หน้า <b>ตั้งค่าระบบ<\/b>/,
    'the line that sends a reader to the live values is gone');
  for (const figure of ['08:00', '17:00', '30 นาที', '40 ชม']) {
    assert.ok(!manual.includes(figure),
      `the manual states ${figure} — a policy value it cannot keep true; name the screen instead`);
  }
  /* An example that could be mistaken for a setting is labelled on the face of
     the picture, not only in the prose above it — a printed page is read one
     figure at a time. */
  assert.match(manual, /ตัวเลขในภาพเป็นตัวอย่าง/);
});

/* ══ บันทึกเป็น PDF ══════════════════════════════════════════════════════════
 *
 * Asked for on 2026-09-09: "ทำให้คู่มือการใช้งานบันทึกเป็น pdf ได้ แบบเลือกได้
 * หลายหน้า". The FILE half is covered by test/printPdf.test.js, which lists
 * this view beside the other five and holds it to naming its own document. What
 * is left here is the half that is this screen's own.
 */

/**
 * THE PICKER OFFERS THE GATED LIST, which is what the สิทธิ์ cut buys on paper.
 *
 * ฝ่ายบุคคล printing the manual for a production line gets the eight หัวข้อ a
 * พนักงาน has, with no ตั้งค่าระบบ page in a stack being handed out at a
 * training session. It is also why `picked` is seeded from the visible list:
 * seeded from every section, a พนักงาน's first press of บันทึกเป็น PDF would
 * silently drop ten ticks they were never shown.
 */
test('the picker offers what this reader can see, and nothing else', () => {
  assert.match(manual, /const sheets = visible\.filter\(\(s\) => picked\.includes\(s\.key\)\);/,
    'the file is being assembled from something other than the gated list');
  assert.match(manual, /useState\(\(\) => sectionsFor\(permissionsOf\(user\)\)\.map\(\(s\) => s\.key\)\)/,
    'the initial ticks are no longer the sections this reader has');
  assert.match(manual, /เลือกทั้งหมด \(\{visible\.length\}\)/);
  assert.match(manual, /เลือกแล้ว \{sheets\.length\} จาก \{visible\.length\} หัวข้อ/);
});

/**
 * THE ONE THAT WOULD BE FOUND BY A READER RATHER THAN BY A TEST.
 *
 * `picked` is a set of keys; the sheets are a filter over the section list.
 * Build them by mapping `picked` instead and the document comes out in the
 * order somebody happened to click — so the same หัวข้อ make a different manual
 * every time, and the one printed for HR reads in an order nobody chose.
 * Nothing on the screen looks wrong while it happens.
 */
test('the pages are in page order, never in the order the ticks were made', () => {
  assert.ok(!/picked\.map\(/.test(manual), 'a list is being built by walking `picked`');
});

test('the ticks are the document — every หัวข้อ is offered, and both bulk controls are there', () => {
  assert.match(manual, /type="checkbox"[\s\S]{0,200}checked=\{picked\.includes\(s\.key\)\}/,
    'the picker no longer draws a box per หัวข้อ');
  assert.match(manual, /ล้างที่เลือก/);
  // Adds rather than replaces — the shape เลือกทั้งหมด on the OT form takes, so
  // it cannot lose a tick, and it stays correct now that the list IS narrowed.
  assert.match(manual, /\.\.\.picked,\s*\r?\n\s*\.\.\.visible\.map\(\(s\) => s\.key\)\.filter\(/,
    'เลือกทั้งหมด replaces the selection instead of adding to it');
  // Nothing ticked is a shut bar, not a blank sheet of paper.
  assert.match(manual, /disabled=\{sheets\.length === 0\}/);
});

/**
 * THE RUNNING HEAD SAYS WHOSE MANUAL THIS IS.
 *
 * It named the system and the company and that was enough while the stack was
 * the same stack for everybody. It is not any more: a page about ตั้งค่าระบบ
 * and a page about บันทึกใบขอ OT can now come from two different printings, and
 * a photocopied หัวข้อ with no บทบาท on it is instructions somebody may not
 * have the screens to follow.
 */
test('a printed page names the บทบาท it was printed for', () => {
  assert.match(manual, /ฉบับของ \{ctx\.p\.label\}/,
    'the running head no longer says whose manual the page came from');
});

/**
 * IT USES THE APP'S ONE PRINT PATH AND BUILDS NOTHING OF ITS OWN.
 *
 * `PrintChrome` draws both doors and `savePdf` sends the DOM; a view that
 * called `window.print()` or fetched `/api/print/pdf` itself would be a second
 * way of producing a document from this app — which is the failure
 * `PrintFormBatch` and lib/printFile.js both exist to refuse.
 */
test('it prints through PrintChrome, not through a path of its own', () => {
  assert.match(manual, /<PrintChrome/);
  for (const forbidden of ['window.print()', "fetch('/api/print/pdf'", 'savePdf(']) {
    assert.ok(!manual.includes(forbidden),
      `the manual builds its own document: ${forbidden}`);
  }
});

test('one หัวข้อ per page, spelt the way every other sheet in this app spells it', () => {
  const print = read('app/print.css');
  assert.match(print, /\.manual-sheet \+ \.manual-sheet \{ break-before: page; page-break-before: always; \}/,
    'หัวข้อ no longer start on a page of their own');
  // A heading stranded at the foot of a page sends the reader over the fold to
  // text with no heading on it — the one break this document can make that
  // actively misleads.
  assert.match(print, /\.manual-sheet-title \{ break-after: avoid/);
  // A step and the picture its sentence points at are one thing on paper: split
  // across a fold, the picture lands on the page after the instruction, and
  // paper cannot be scrolled back.
  assert.match(print, /\.manual-step,\n {2}\.mshot,\n {2}\.mdiag \{ break-inside: avoid/);
  // Paper is narrower than 900px in CSS pixels, so without this every printed
  // manual would take the phone's stacked shape and run to twice the pages.
  assert.match(print, /\.mshot-pair \{ grid-template-columns: 1fr 1fr !important; \}/);
  // The 74ch measure is a screen rule; left on, every printed page would carry
  // a right margin twice the size of its left one.
  assert.match(print, /\.manual-body \{ max-width: none; \}/);
});

/**
 * ── ⚠ IT PRINTED OFF THE EDGE OF THE PAPER ──────────────────────────────────
 *
 * `@page` is `margin: 0` for the whole app, and rightly so: the three forms
 * carry their own 8mm bands inside a full-bleed page box, and a margin there
 * costs a second sheet of paper per person. The manual has no band of its own —
 * it is prose — so once `main { padding: 0 }` (styles.css) and `.manual-sheet
 * { padding: 0 }` have both run there is nothing left between the text and the
 * page box.
 *
 * Measured out of the PDF on 2026-09-10, before: ink from 0.0mm to 210.1mm
 * across 209.9mm of paper, with 2.9mm of clear at the top. A printer cannot put
 * ink within about 5mm of the edge, so the first and last characters of every
 * line came off the sheet. After: 15.0mm and 15.2mm at the sides and 18.0mm at
 * the top, on all four pages of a หัวข้อ that runs to four.
 *
 * BOTH HALVES ARE PINNED, BECAUSE THEY FAIL DIFFERENTLY. The sides are the
 * sheet's own box, which every engine honours on every fragment of a block that
 * breaks across pages; top and bottom are a named page, the only thing that can
 * reach a page this stylesheet never sees — and the thing Firefox ignores.
 * Losing either is a document that prints wrong in a way nobody sees until it
 * is on paper.
 */
test('the manual is printed on A4 and not over the edge of it', () => {
  const print = read('app/print.css');
  assert.match(print, /@page manual \{ margin: 15mm 0; \}/,
    'the manual lost the page it stands on — top and bottom go back to nought');
  assert.match(print, /\.manual-sheet \{\n {4}page: manual;/,
    'nothing points the manual at its own @page any more');
  // 180mm centred on 210mm is the 15mm band either side, on every page.
  assert.match(print, /width: 180mm;/, 'the manual lost its measured text column');
  // …and that band is 15mm only while the width is the TEXT and not the box.
  assert.match(print, /box-sizing: content-box;\n {4}width: 180mm;/,
    'the column is border-box, so padding would come out of the text rather than the margin');
  // The three forms keep the full-bleed page they are measured against.
  assert.match(print, /@page \{\n {2}size: A4 portrait;\n {2}margin: 0;\n\}/,
    'the shared @page grew a margin — F-HR-027 now spills onto a second side');
});
