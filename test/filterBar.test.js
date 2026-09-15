import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ONE FILTER BAR, ON EVERY SCREEN THAT FILTERS — 2026-09-10.
 *
 * Reported in three lines with a screenshot of รายงาน OT แยกแผนก's controls:
 *
 *   *"กระชับความสูงของ ส่วนตัวกรองหน่อยครับ ตามรูป
 *     ลบ label ช่อง input / dropdown ออก
 *     ปรับให้เป็นรูปแบบเดียวกันทั้ง app"*
 *
 * and, when asked what should happen to the controls whose VALUE cannot say
 * what they are, *"ช่วยออกแบบตาม ux/ui ที่นิยมใช้กัน"*.
 *
 * ── THE TWO HALVES ─────────────────────────────────────────────────────────
 *
 * ONE CONTAINER. `.queue-tools` was รออนุมัติ OT's, then the three report
 * screens', and is now every filter bar in the app. Six rules were deleted for
 * it — `.head-split`, `.month-find` and `.export-row` (ตรวจสอบประจำเดือน),
 * `.action-row` (การเงิน and แยกแผนก), `.compliance-filters` (การใช้สิทธิ์พิเศษ)
 * and `.roster-find` (ทะเบียนพนักงาน) — and a seventh container was VACATED
 * rather than deleted: the three log tabs filtered inside a `.form-grid`, which
 * is still the app's form layout and is still used by two screens as one. This
 * file fails if any of the six returns, or if a new screen grows a seventh.
 *
 * THE LABEL IS INSIDE THE BOX. `.field-head`'s 18px plus `.field`'s 7px gap is
 * 25px above every control on every bar — the height the report was about. A
 * BARE box was the obvious way to spend it and is not what was built: half
 * these controls cannot say what they are (`อนุมัติแล้ว + รอ HR` does not say
 * it is สถานะที่นับ; `01/09/2569` does not say ตั้งแต่ or ถึง), so dropping the
 * words would have bought 25px by making four controls on บันทึกประวัติระบบ
 * unreadable. The label moves INTO the box and sits over the value — a filled
 * text field, the shape Material has drawn since 2018 and every booking site's
 * date picker uses. The box keeps `--field-h`; the row above it goes.
 *
 * ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
 *
 * Both halves come apart quietly. A new screen writes its own flex row because
 * `.queue-tools` is not an obvious name for "filter bar"; or somebody adds a
 * `.field` to a bar and it draws a label above the box again because the inset
 * rule is one selector deep. Neither breaks a build and neither shows up on the
 * screen the author is looking at.
 *
 * ⚠ A FORM IS NOT A FILTER BAR, and the scope was settled in as many words:
 * *เฉพาะแถบตัวกรอง*. On บันทึก OT a label is a question being asked of somebody
 * with an empty box under it, and a question printed inside the box it asks
 * about is a placeholder — the one thing a form label must not be, because it
 * leaves when the box is answered. `.form-grid` keeps its labels over its
 * boxes and that is pinned here too.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** CRLF here, LF on the Linux box — see the note in `.gitattributes`. */
const read = (f) => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
/* Comments in this repo quote the markup they explain and record what was
   deleted, so an assertion about what the code DOES has to read it with the
   prose taken out. AGENTS.md names this; it has caught assertions in this
   suite more than once, including one that matched the very Thai it was
   checking had not been copied. */
const noProse = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const css = read('app/styles.css');
const rules = noProse(css);
/** One rule, from its selector to the end of its declarations. */
const rule = (selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at > 0, `${selector} หายไปจาก styles.css`);
  return css.slice(at, css.indexOf('}', at));
};

/** Every screen that draws a filter bar, and the label on each control of it. */
const BARS = [
  ['components/ApprovalQueue.jsx', ['ค้นหา', 'แผนก', 'เดือน']],
  ['components/HrView.jsx', ['ค้นหาพนักงาน', 'สถานะที่นับ', 'แผนก', 'ประจำเดือน']],
  ['components/AccountingView.jsx', ['บริษัท', 'ประจำเดือน']],
  ['components/DepartmentView.jsx', ['แผนก', 'ประจำเดือน']],
  ['components/LogSystem.jsx', ['ค้นหา', 'กรองตามบัญชี', 'ตั้งแต่วันที่']],
  ['components/AdminView.jsx', ['ค้นหาพนักงาน', 'ตำแหน่ง', 'แผนก', 'บทบาท']],
  /* TWO SCREENS IN ONE FILE — ทะเบียนพนักงาน above and ประวัติการแก้ทะเบียน
     here, which became the app's last `.form-grid` filter bar on 2026-09-15. */
  ['components/AdminView.jsx', ['กรองตามพนักงาน', 'กรองตามสิ่งที่ถูกแก้',
    'กรองตามประเภท', 'กรองตามบัญชีผู้แก้ไข']],
  /* The two one-control bars, 2026-09-15 — a bar with one field on it is still
     the bar. Both were a `.field` with its label stacked over the box. */
  ['components/App.jsx', ['ประจำเดือน']],
  ['components/EmployeeView.jsx', ['ประจำเดือน']],
];

// ── one container ───────────────────────────────────────────────────────────

test('every filter bar in the app is `.queue-tools`', () => {
  for (const [file, labels] of BARS) {
    const src = noProse(read(file));
    /* A SECOND CLASS AFTER IT IS ALLOWED, AND ONLY A SECOND CLASS — 2026-09-14,
       with ทะเบียนพนักงาน's `roster-tools`. What this file is holding down is
       that every filter bar in the app IS this container, not that no screen may
       say anything about its own layout: that bar carries four fields, and the
       860px rule that gives every field the full width turns four of them into
       four slabs above the table. The hook is what pairs the three dropdowns
       off, and `.queue-tools` is still what draws the bar.

       WHAT IS STILL REFUSED is the thing the round of 2026-09-10 was about — a
       bar that is some other element with some other class. `queue-tools` has
       to be the FIRST class on it, so a screen cannot quietly make its own
       container and wear this one as a modifier. */
    assert.match(src, /className="queue-tools(?: [a-z-]+)?"(?: style)?/,
      `${file} ไม่ได้ใช้ .queue-tools เป็นแถบตัวกรองแล้ว`);
    // The labels are what proves it is THIS screen's filters in there, and not
    // an empty bar that happens to carry the class.
    for (const label of labels) {
      // Two ways a control on a bar names itself: a `label` prop (`PickOne`,
      // `Field`) or a `<label>` written into a hand-rolled `.field-head`, which
      // is what รออนุมัติ OT's search box does.
      assert.ok(
        src.includes(`label="${label}"`) || src.includes(`label="${label} `)
        || src.includes(`<label>${label}</label>`)
        || new RegExp(`<label[^>]*>${label}</label>`).test(src),
        `${file} ไม่มีช่อง ${label} แล้ว`,
      );
    }
  }
});

test('the six rules it replaced are gone from the stylesheet', () => {
  /* Each of these was a real rule with real reasoning behind it, and each is
     recorded where it stood rather than merely deleted — which is why this
     reads the sheet with the prose stripped. */
  for (const dead of [
    '.head-split', '.month-find', '.export-row', '.action-row',
    '.compliance-filters', '.roster-find',
  ]) {
    assert.ok(!new RegExp(`\\${dead}\\s*[,{>. ]`).test(rules.replace(/\n/g, ' ')),
      `${dead} กลับมาเป็นกฎอีกแล้ว — แถบตัวกรองแยกร่างอีกจอหนึ่ง`);
  }
});

test('no screen grows a filter row of its own', () => {
  // A bar is a flex row of `.field`s. Any component that builds one without
  // the shared class is the eighth container this round removed seven of.
  for (const f of readdirSync(join(ROOT, 'components')).filter((n) => n.endsWith('.jsx'))) {
    const src = noProse(read(`components/${f}`));
    assert.doesNotMatch(src, /className="row [a-z-]*filters?"/,
      `components/${f} วาดแถวตัวกรองเอง แทนที่จะใช้ .queue-tools`);
  }
});

// ── the label is inside the box ─────────────────────────────────────────────

test('the label is drawn over the control, not above it', () => {
  const head = rule('.queue-tools .field > .field-head');
  assert.match(head, /position: absolute/, 'label กลับไปอยู่เหนือกล่องแล้ว');
  assert.match(head, /top: 7px/);
  // WITHOUT THIS THE TOP THIRD OF EVERY BOX IS DEAD. The words sit ON TOP of a
  // <button> (`PickOne`, `PickDate`) or an <input>; a label that takes the
  // press is a control that does not open.
  assert.match(head, /pointer-events: none/,
    'label กินคลิกที่ควรตกถึงกล่องข้างใต้');
  // And the container has to be the positioning context, or `absolute` climbs
  // to the card and the label lands somewhere else entirely. `gap: 0` with it:
  // `.field`'s own 7px gap is the space the label row used to take, and left
  // standing it is 7px of nothing under a box with no second child.
  const field = rule('.queue-tools .field');
  assert.match(field, /position: relative/);
  assert.match(field, /gap: 0/);
});

test('the box makes room for it, and the arithmetic fits --field-h', () => {
  /*
   * label 10px at 1.2   = 12
   * gap                 =  2
   * value 15px at 1.3   = 19.5   (`--field-size`, unchanged)
   *                       ────
   *                       33.5  + 6 top + 7 bottom = 46.5
   *
   * `--field-h` is 46, which the `min-height` already declares — so the box is
   * the height it always was and only the row above it is gone. If any of the
   * three moves, this sum is what has to be redone.
   */
  assert.match(css, /--field-h: 46px;/);
  assert.match(css, /--field-size: 15px;/);
  assert.match(rule('.queue-tools .field > .field-head label'), /font: 600 10px\/1\.2 var\(--mono\)/);
  const pad = css.slice(css.indexOf('.queue-tools .field input:not('));
  assert.match(pad.slice(0, 400), /padding-top: 21px; padding-bottom: 5px;/);
  // All three kinds of box, or the bar is two heights: a text input, a
  // `PickOne` and a `PickDate`/`PickMonth`.
  const sel = pad.slice(0, pad.indexOf('{'));
  for (const kind of ['input:not(', '.pick-one', '.pick-box']) {
    assert.ok(sel.includes(kind), `กล่องชนิด ${kind} ไม่ได้เว้นที่ให้ label ในกล่อง`);
  }
});

test('the leading and trailing glyphs follow the value, not the box', () => {
  // Both are `top: 50%` against a 46px field, which centred them on the whole
  // box — right while it held one line, and 8px high the moment a label moved
  // in above it.
  const nudge = rule('.queue-tools .searchbox .searchbox-icon,\n.queue-tools .searchbox-clear');
  assert.match(nudge, /transform: translateY\(calc\(-50% \+ 6px\)\)/);
});

test('the bar runs to the edges of whichever card it is in', () => {
  // On `.card.flush` it always did — that card has no padding. On a plain
  // `.card` the same wash drew as a grey slab floating inside 18px of white,
  // which is one shape on four screens and another on two.
  assert.match(rule('.card:not(.flush) > .queue-tools'), /margin: 0 -18px/);
  assert.match(rule('.card:not(.flush) > .queue-tools'), /border-top: 1px solid var\(--line-soft\)/);
  assert.match(rule('.card'), /padding: 18px;/,
    'ระยะขอบของ .card เปลี่ยน แต่ margin ที่หักล้างมันยังเป็น -18px');
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone.slice(0, phone.indexOf('\n}\n\n')), /\.card \{ padding: 15px;/);
  assert.match(phone, /\.card:not\(\.flush\) > \.queue-tools \{ margin: 0 -15px; \}/,
    'บนมือถือ .card ใช้ padding 15 แต่แถบยังหักล้าง 18 อยู่');
});

test('a card with no padding gets no negative margin — reported 2026-09-10', () => {
  /* ⚠ THIS IS THE BUG THE `:not(.flush)` IS. A negative margin is exactly the
     size of the padding it cancels, and `.card.flush` has none — so a bare
     `.card > .queue-tools` hung the bar 18px past the card at both ends on
     รออนุมัติ OT, การเงิน and แยกแผนก. `overflow: hidden` cut the overhang off
     rather than showing it, which is why it read as a first field standing 1px
     from the card's edge — 18px LEFT of the heading right above it — and not as
     a bar that was too wide. Reported with a picture: *"ช่องตกขอบครับ"*. */
  for (const m of rules.matchAll(/^[ \t]*(\.card[^{\n]*>[^{\n]*\.queue-tools[^{\n]*)\{([^}]*)\}/gm)) {
    const [, selector, body] = m;
    if (!/margin/.test(body)) continue;
    assert.match(selector, /:not\(\.flush\)/,
      `${selector.trim()} หักล้าง padding ที่การ์ดชนิดนี้ไม่มี — แถบจะตกขอบการ์ด`);
  }
  // And the three screens whose bar sits straight in a `.card.flush`, so the
  // rule above has something to be about.
  for (const f of ['components/ApprovalQueue.jsx', 'components/AccountingView.jsx',
    'components/DepartmentView.jsx']) {
    assert.match(noProse(read(f)), /className="card flush/,
      `${f} เลิกใช้ .card.flush — กฎ :not(.flush) อาจไม่มีจอไหนเหลือให้คุ้มครองแล้ว`);
  }
});

// ── and a form keeps its labels ─────────────────────────────────────────────

test('a form is not a filter bar', () => {
  /* Settled in as many words on 2026-09-10 — *เฉพาะแถบตัวกรอง*. The inset rule
     is scoped to `.queue-tools`, and nothing else may take it: on บันทึก OT the
     label is a question asked of somebody with an empty box under it, and a
     question printed inside that box is a placeholder — which leaves the moment
     it is answered. */
  const inset = rules.slice(rules.indexOf('.queue-tools .field > .field-head'));
  const selector = inset.slice(0, inset.indexOf('{'));
  assert.ok(!selector.includes('.form-grid'), 'กฎ label-ในกล่อง เอื้อมไปถึงฟอร์มแล้ว');
  // `.field-head` keeps its own height for every field that is NOT on a bar.
  assert.match(rule('.field-head'), /min-height: 18px/);
  assert.match(rule('.field'), /gap: 7px/);
  // The forms this is about must still be form grids — a label over a box,
  // with room under it for the note that explains the field.
  for (const f of ['components/AdminView.jsx', 'components/Delegation.jsx']) {
    assert.match(noProse(read(f)), /className="form-grid"/,
      `${f} เลิกใช้ .form-grid — ฟอร์มถูกลากไปเป็นแถบตัวกรองด้วย`);
  }
});


// ── the last form grid that was a filter bar ────────────────────────────────

/**
 * ประวัติการแก้ทะเบียน — 2026-09-15, asked for as *"ยุบตัวกรองให้อยู่ในแถวเดียวกัน
 * · ใช้ label ของช่อง input รูปแบบเดียวกับตัวกรองหน้าเพิ่มพนักงาน ทำให้เป็น
 * รูปแบบเดียวกันทั้ง app"*.
 *
 * WHAT IT WAS: four filters in a `.form-grid` — two columns of boxes, a label
 * row over each, two notes under, and ล้างตัวกรองทั้งหมด on a fifth row below
 * the lot. The round of 2026-09-10 converted six screens and left this one,
 * because it is the second bar in a file whose first bar was already converted.
 *
 * THE TWO NOTES ARE THE PART WORTH PINNING. A bar has no room under a box, so
 * each one had to go somewhere that is not "deleted quietly": the roster one
 * was the placeholder read out loud and went, and the one about where the
 * account list comes from is a fact about the SCREEN and went into the card's
 * hint — the same move บันทึกประวัติระบบ made with the same sentence.
 */
const audit = (() => {
  const src = read('components/AdminView.jsx');
  const at = src.indexOf('function RosterAudit()');
  assert.ok(at > 0, 'RosterAudit หายไปจาก AdminView.jsx');
  return src.slice(at, src.indexOf('\nfunction ', at + 10));
})();

test('ตัวกรองสี่ช่องของ ประวัติการแก้ทะเบียน อยู่บนแถบเดียว', () => {
  const code = noProse(audit);
  assert.match(code, /<div className="queue-tools" style=\{\{ marginBottom: 12 \}\}>/);
  assert.ok(!code.includes('className="form-grid"'), 'ยังเป็น .form-grid อยู่');
  // The one box that is typed into takes the bar's double width.
  assert.match(code, /<Field label="กรองตามพนักงาน" className="search">/);
  // All four are inside the one bar, and so is ล้างตัวกรองทั้งหมด.
  const bar = code.slice(code.indexOf('<div className="queue-tools"'), code.indexOf('{error &&'));
  for (const label of ['กรองตามพนักงาน', 'กรองตามสิ่งที่ถูกแก้', 'กรองตามประเภท', 'กรองตามบัญชีผู้แก้ไข']) {
    assert.ok(bar.includes(`label="${label}"`), `${label} ไม่ได้อยู่บนแถบ`);
  }
  assert.match(bar, /\{narrowed && \(\s*\n\s*<button/, 'ปุ่มล้างตัวกรองไม่ได้อยู่บนแถบ');
  assert.ok(!code.includes('<div className="row" style={{ marginBottom: 12 }}>'),
    'แถวของปุ่มล้างตัวกรองยังอยู่ใต้แถบ');
});

test('คำอธิบายใต้กล่องสองอันไปอยู่ที่ที่มันควรอยู่ ไม่ได้หายเฉย ๆ', () => {
  const code = noProse(audit);
  // A bar of equal-height boxes has no room for either.
  assert.ok(!code.includes('note="รายชื่อมาจากประวัติเอง'), 'note ยังอยู่ใต้กล่อง');
  assert.ok(!code.includes('note="พิมพ์เพื่อค้นหา'), 'note ยังอยู่ใต้กล่อง');
  // The one about the screen moved into the card's hint, naming the box it is
  // about — a sentence that survives only if a reader can tell what it answers.
  const hint = code.slice(code.indexOf('<div className="hint">'), code.indexOf('</div>', code.indexOf('<div className="hint">')));
  assert.match(hint, /กรองตามบัญชีผู้แก้ไข/);
  assert.match(hint, /มาจากประวัติเอง/);
  // The one about the search box is the placeholder, which is where an example
  // of what to type belongs.
  assert.match(read('components/common.jsx'), /placeholder = 'พิมพ์ชื่อ หรือ รหัสพนักงาน…'/);
});

test('ช่องค้นหาบนแถบทุกช่องมีแว่นขยาย รวมช่องที่เพิ่งขึ้นมาบนแถบ', () => {
  /* The round of 2026-09-10 put one in all four search boxes in the app and
     missed `PickPerson` — it was not on a filter bar then. It is now. */
  const person = (() => {
    const src = read('components/common.jsx');
    const at = src.indexOf('export function PickPerson(');
    return src.slice(at, src.indexOf('\n/**', at));
  })();
  assert.match(person, /<Icon name="search" className="searchbox-icon" \/>/);
  assert.match(person, /className=\{`has-icon\$\{clearable \? ' has-clear' : ''\}`\}/);
  // …and the padding that keeps the text off the glyph is the shared rule.
  assert.match(rules, /\.searchbox input\.has-icon \{ padding-left: 40px; \}/);
});


// ── the last labels standing over a box ────────────────────────────────────

/**
 * ทุกช่องเลือกเดือนอยู่บนแถบ — 2026-09-15.
 *
 * Reported with a picture of the one on พิมพ์ใบขออนุมัติ OT: *"เหลือช่อง input
 * ตามรูปที่ยังไม่ใช้ label แบบเดียวกัน"*. Two screens still stacked a
 * `<label>` over a `PickMonth` — พิมพ์ใบขออนุมัติ OT, whose label read
 * ประจำเดือน · PERIOD and was the only bilingual one in the app, and
 * ประวัติการขอ OT's full-history card, where ล่าสุด beside it carried
 * `minHeight: var(--field-h)` purely to make up the height of that label row.
 *
 * ── WHY THE RULE IS ABOUT `PickMonth` AND NOT ABOUT `<label>` ───────────────
 * A label over a box is RIGHT in a form — that is what `.form-grid` is, and the
 * test above holds it. What makes a month picker different is that there is no
 * form in this app that asks for a เดือน: every one of them narrows what is
 * already on screen, so every one of them belongs on a bar (label inside the
 * box) or in a card head (`.period-input`, no label at all — the value reads as
 * a month by itself). Neither shape stacks a label.
 */
test('ทุก PickMonth ในแอปอยู่บนแถบหรือในหัวการ์ด — ไม่มีอันไหนมี label ลอยเหนือกล่อง', () => {
  const files = readdirSync(join(ROOT, 'components'))
    .filter((f) => f.endsWith('.jsx'))
    .filter((f) => f !== 'ManualView.jsx');
  let seen = 0;
  for (const f of files) {
    const src = noProse(read(`components/${f}`));
    for (const m of src.matchAll(/<PickMonth\b/g)) {
      seen += 1;
      // The 200 characters in front of it: enough for the wrapper that decides
      // which of the two shapes this is.
      const before = src.slice(Math.max(0, m.index - 200), m.index);
      const inHead = /<div className="field-head"><label>[^<]*<\/label><\/div>\s*$/.test(before);
      const bare = /className="period-input"/.test(src.slice(m.index, m.index + 200));
      assert.ok(inHead || bare,
        `components/${f}: PickMonth ตัวหนึ่งไม่ได้อยู่ในรูปแบบใดเลย — ...${before.slice(-120)}`);
      // And what is refused: a `<label>` of its own, stacked above the box.
      assert.ok(!/<label>[^<]*<\/label>\s*$/.test(before.replace(/<div className="field-head">/g, '')),
        `components/${f}: ยังมี <label> ลอยอยู่เหนือ PickMonth`);
    }
  }
  assert.ok(seen >= 6, `เจอ PickMonth แค่ ${seen} ตัว — regex คงพัง`);
});

test('คู่มือเลิกเรียกช่องนั้นว่า ประจำเดือน · PERIOD', () => {
  /* The manual draws mock screens and names the controls on them, so a label
     that changed on the screen and not in the manual is the manual telling a
     reader to look for something that is not there. `ประจำเดือน · PERIOD` was
     in three places: one sentence and two mock fields. */
  const manual = read('components/ManualView.jsx');
  assert.ok(!manual.includes('ประจำเดือน · PERIOD'), 'คู่มือยังเรียกชื่อเดิมอยู่');
  assert.ok(manual.includes('<MkField label="ประจำเดือน">'), 'ภาพจำลองไม่มีช่องประจำเดือนแล้ว');
});

test('สองจอนั้นเป็น card flush + card-head + queue-tools เหมือนจอรายงาน', () => {
  // The shape every report screen has: the heading and its sentence on the
  // white band, the control that decides what is on screen on the wash below.
  const print = noProse(read('components/App.jsx'));
  const at = print.indexOf('function MyForm()');
  const form = print.slice(at, print.indexOf('\nfunction ', at + 10));
  assert.match(form, /<div className="card flush no-print">\s*\n\s*<div className="card-head">/);
  assert.match(form, /<div className="t">ใบขออนุมัติทำงานล่วงเวลา/);
  assert.match(form, /<div className="queue-tools">/);
  assert.ok(!form.includes('<h2>'), 'หัวการ์ดยังเป็น <h2> ไม่ใช่ .card-head .t');

  const emp = noProse(read('components/EmployeeView.jsx'));
  assert.match(emp, /<div className="card flush">\s*\n\s*<div className="card-head">\s*\n\s*<div style=\{\{ minWidth: 0 \}\}>/);
  assert.match(emp, /<div className="t">ประวัติการขอ OT/);
  // ล่าสุด is on the bar now, and the two inline styles that held it level with
  // a taller field are gone — the bar ends its items on one line by itself.
  assert.match(emp, /<div className="queue-tools">[\s\S]{0,400}?ล่าสุด/);
  assert.ok(!emp.includes("minHeight: 'var(--field-h)'"), 'ปุ่มยังชดเชยความสูงของแถว label อยู่');
});
