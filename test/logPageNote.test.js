import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * มาตรา ๒๖ behind the ⓘ — the sentence that stopped being a footer.
 *
 * บันทึกระบบ is kept because the law requires it, and that fact was printed
 * under every list on the screen: two tabs, four lines of grey on a phone,
 * above nothing anybody had come to read. It is standing context — equally
 * true before the page loads and after it — so it moved to the one place
 * standing context belongs, the heading, and waits behind a button there.
 *
 * It floats. A block in the flow moved everything under it — the tab strip,
 * the first row of the table — every time somebody opened or shut it, which
 * on a phone is the part of the screen a thumb is already on. So it hangs off
 * the bar instead, and the price of floating is that it has to be dismissible:
 * a press anywhere outside it, the ⓘ again, or Escape.
 *
 * The four things pinned here are the ones that quietly undo it: the footer
 * coming back, the note being made dynamic (the heading is drawn before any
 * screen has data, so a note that needs a figure cannot live in that table),
 * the panel going back into the flow, and the ⓘ losing the box that lets the
 * dismiss tell a press on the button from a press outside it.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
const app = readFileSync(join(ROOT, 'components/App.jsx'), 'utf8');
const log = readFileSync(join(ROOT, 'components/LogSystem.jsx'), 'utf8');
const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');

// ── the footer is gone, and so are its rules ────────────────────────────────

test('บันทึกระบบ draws no footer', () => {
  assert.ok(!log.includes('RetentionNote'), 'the footer component came back');
  assert.ok(!log.includes('พ.ร.บ. คอมพิวเตอร์ มาตรา ๒๖ กำหนดให้เก็บ'),
    'the law is being printed on the page again as well as behind the ⓘ');
});

test('the footer took its stylesheet with it', () => {
  // Rules for an element nothing renders are the kind of thing that survives
  // three redesigns and then gets copied somewhere it does something.
  assert.ok(!css.includes('.log-foot'), 'dead footer rules are still in the stylesheet');
});

test('how far back the log goes is still said somewhere', () => {
  // The one fact in the old footer that was about THIS collection rather than
  // about the law. It qualifies the count, so it went to the count.
  const tile = log.slice(log.indexOf('label="REQUESTS"'));
  const note = tile.slice(0, tile.indexOf('onClick'));
  assert.match(note, /ทั้งหมดในระบบ/);
  assert.match(note, /เก่าสุด/);
  assert.ok(note.includes('atShort(data.oldest)'), 'the date is not read from the summary');
  // And only when the screen was given one: a collection with nothing in it
  // has no oldest record to name.
  assert.ok(note.includes('data.oldest ?'), 'an empty log would print เก่าสุด —');
});

// ── the note, and where it can live ─────────────────────────────────────────

test('the page table carries the note, and only for the page that has one', () => {
  const table = app.slice(app.indexOf('const PAGE = {'), app.indexOf('function Shell('));
  assert.match(table, /'ระบบเก็บบันทึกตาม พ\.ร\.บ\. คอมพิวเตอร์ มาตรา ๒๖ \(ไม่น้อยกว่า 90 วัน\)/);
  assert.match(table, /รวมอยู่ในไฟล์สำรองข้อมูลรายวัน/);
  // Every other page is two fields, so nothing else grows a button. A second
  // note is not forbidden — it is a decision, and this is where it is made.
  assert.equal((table.match(/มาตรา ๒๖/g) || []).length, 1);
  assert.equal((table.match(/: \[\r?\n/g) || []).length, 1,
    'another page grew a note — check it is standing context and not a caption');
});

test('the heading reads the note, and shuts it on the way out', () => {
  // `PAGE_BY_ROLE` went in front on 2026-08-31, when the หัวหน้างาน tab was
  // renamed to รายงาน OT ประจำทีม and the page it opens still said HR's
  // ตรวจสอบประจำเดือน. It is an OVERRIDE and not a replacement: a role with no
  // entry, or a tab that role does not override, falls through to `PAGE`, and
  // the empty triple is still the last word so an unknown tab draws no heading
  // rather than throwing.
  assert.match(
    app,
    /const \[title, meta, note\] = PAGE_BY_ROLE\[user\.role\]\?\.\[tab\] \|\| PAGE\[tab\] \|\| \['', '', null\];/,
  );
  // One role overrides one tab. A second entry is allowed and is a decision —
  // it is not allowed to arrive as a copy of `PAGE` that nobody noticed
  // growing, which is the failure this count is here to make visible.
  const byRole = app.slice(app.indexOf('const PAGE_BY_ROLE = {'), app.indexOf('function Shell('));
  assert.equal((byRole.match(/\bmonthly:/g) || []).length, 1);
  assert.match(byRole, /manager: \{ monthly: \['รายงาน OT ประจำทีม', 'TEAM SUMMARY'\] \},/);
  // A note left open follows the reader onto the next screen, where it is the
  // footer again with an extra tap in front of it.
  assert.match(app, /useEffect\(\(\) => \{ setNoteOpen\(false\); \}, \[tab\]\);/);
});

test('the button is the app\'s tip control, wearing an i', () => {
  // Not a new component and not a new stylesheet: the same 17px circle, the
  // same focus ring, the same keys as the `?` on a form field.
  assert.match(app, /<TipButton\s+glyph="i"/);
  assert.match(common, /export function TipButton\(\{ text, of, open, onToggle, glyph = '\?' \}\)/);
  assert.match(common, /\{glyph\}/);
});

test('hover and tap both reach the sentence', () => {
  const btn = common.slice(common.indexOf('export function TipButton('));
  // `title` is the pointer's way in; the toggle is the thumb's. A phone has no
  // hover, so a tooltip alone would be a sentence nobody on a phone can read.
  assert.match(btn.slice(0, btn.indexOf('</button>')), /title=\{text\}/);
  assert.match(btn.slice(0, btn.indexOf('</button>')), /onClick=\{onToggle\}/);
  assert.match(app, /<div className="page-note" ref=\{noteRef\} role="note">\{note\}<\/div>/);
});

test('the panel floats over the page instead of pushing it', () => {
  // As a block it moved the tab strip and the first row of the table every
  // time somebody opened or shut it — under the thumb already reaching for
  // them. It hangs off `.appbar`, which is sticky and therefore its containing
  // block, and rides the bar while the page scrolls underneath.
  const rule = css.slice(css.indexOf('.appbar .page-note {'), css.indexOf('}', css.indexOf('.appbar .page-note {')));
  assert.ok(rule.length > 0, '.page-note lost its rule');
  assert.match(rule, /position: absolute/);
  assert.match(css, /\.appbar \{[^}]*position: sticky/s, 'the bar it hangs from stopped being positioned');
  // In the bar, not in the page — anywhere else and `absolute` measures from
  // a different box.
  const bar = app.slice(app.indexOf('<header className="appbar'), app.indexOf('</header>'));
  assert.ok(bar.includes('className="page-note"'), 'the panel left the bar it is positioned against');
});

test('it shuts on a press outside it, on the ⓘ, and on Escape', () => {
  // The ⓘ is the one that is easy to get wrong: `pointerdown` reaches the
  // document before the button's click, so without the first of these the
  // button would close the panel on the way down and open it again on the way
  // up — a control that cannot shut what it opened.
  const effect = app.slice(app.indexOf('if (!noteOpen) return undefined;'));
  const body = effect.slice(0, effect.indexOf('}, [noteOpen]);'));
  assert.match(body, /tipRef\.current\?\.contains\(e\.target\) \|\| noteRef\.current\?\.contains/);
  assert.match(body, /addEventListener\('pointerdown', dismiss\)/);
  assert.match(body, /e\.key === 'Escape'/);
  // And taken down again — otherwise a listener stacks up per open for as long
  // as the session lasts.
  assert.match(body, /removeEventListener\('pointerdown', dismiss\)/);
  assert.match(body, /removeEventListener\('keydown', onKey\)/);
  // The ⓘ needs a box of its own for that first clause to have something to
  // ask about.
  assert.match(app, /<span className="tip-wrap" ref=\{tipRef\}>/);
  assert.match(css, /\.appbar \.tip-wrap \{ display: inline-flex; flex: none; \}/);
});
test('the paragraph under ภาพรวม went behind the ⓘ, promises and all', () => {
  // Four lines about what a traffic log is, above the figures somebody opened
  // the screen for. Two of its clauses had nowhere else to be said, and one of
  // them is the only answer this app gives to "is my password in there" — the
  // promise test/logRouteGuards.test.js exists to hold the code to. It is still
  // printed, one tap from the heading instead of four lines down one tab.
  assert.ok(!log.includes('ระบบบันทึกทุกการเรียกใช้งานผ่าน API'), 'the paragraph came back');
  const table = app.slice(app.indexOf('const PAGE = {'), app.indexOf('function Shell('));
  assert.match(table, /เพิ่มได้อย่างเดียว แก้หรือลบย้อนหลังไม่ได้/);
  assert.match(table, /ไม่เก็บเนื้อหาที่ส่งเข้ามาไม่ว่ารูปแบบใด รวมทั้งรหัสผ่าน/);
  // And the figures start at the heading — `.card h2` leaves 4 of its own, so
  // 10 is the 14px gap the paragraph used to leave behind it.
  assert.match(log, /<div className="grid" style=\{\{ marginTop: 10 \}\}>/);
});
