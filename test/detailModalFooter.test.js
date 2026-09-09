import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
/* readFileSync is used twice: this component, and the Modal that frames it. */

/**
 * ปุ่มท้ายกล่องรายละเอียดใบ OT — ปุ่มไหนเป็นการตัดสิน และปุ่มไหนแค่ทางออก.
 *
 * The pop-up decides one entry, which makes its foot different from every other
 * decision surface in this queue: there is no count to put on the button, and
 * there are three buttons rather than two — a way out sitting beside two things
 * that change the record.
 *
 * Two decisions are pinned here.
 *
 * ONE, the approval names what it signs. Elsewhere the pile says it: อนุมัติ (3)
 * on the bar, ยืนยันทั้งหมด (3 รายการ) in the confirm dialog. Alone, ฝ่ายบุคคล's
 * bare "ยืนยัน" is the same word every OK button in the app uses, so it becomes
 * ยืนยันใบ OT. A หัวหน้า keeps อนุมัติ, which already means one thing.
 *
 * TWO, there are exactly two buttons and they are the two answers. ปิด was the
 * third, at the left, changing nothing — and this dialog already closes by ✕, by
 * Escape, by a tap on the backdrop and by a swipe down on the sheet. What is
 * left is laid out as the pair it is: equal halves, one filled and one in the
 * palette's light red, so neither width nor weight nudges the answer.
 *
 * Read as source text for the reason test/batchConfirmLabel.test.js is.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Line endings normalised before anything below reads a character of this.
    The machine this is developed on checks the repo out CRLF (see the note in
    `.gitattributes`); the Linux box that serves it checks the same commit out
    LF. An assertion written with `\n` misses every multi-line match on the
    first, one written with `\r\n` misses them on the second, and in both
    cases the file under test is correct to the character. Normalising is what
    makes the assertion about the CSS instead of about the checkout — the same
    thing test/adminApproval.test.js and test/modalScrollFrame.test.js do. */
const src = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8').replace(/\r\n/g, '\n');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8').replace(/\r\n/g, '\n');

/** The pop-up only — the modals above it have their own buttons. */
const modal = src.slice(src.indexOf('function DetailModal'));
/* The notes here quote the shapes they replaced, which is the point of them. */
const code = modal.replace(/\/\*[\s\S]*?\*\//g, '');

const has = (src_, text, why) => assert.ok(src_.includes(text), why || `หาไม่เจอ: ${text}`);

test('the approval names the slip for ฝ่ายบุคคล and stays อนุมัติ for a หัวหน้า', () => {
  has(code, "{isHr ? 'ยืนยันใบ OT' : 'อนุมัติ'}");
  // Not `verb`: this pop-up is handed the flag, not the word, because the two
  // roles do not take the same shape here — one names its object and one does
  // not. A template over `verb` cannot say that.
  // The signature wrapped onto its own line when `watching` joined it on
  // 2026-09-03; what is pinned is the flag being a PROP, not where the brace is.
  has(src, 'entry: e, isHr, busy, mine = false, watching = false,');
  has(src, '          isHr={isHr}');
  assert.ok(!code.includes('{verb}'), 'ปุ่มยังประกอบจาก verb — สองบทบาทใช้รูปประโยคต่างกัน');
});

test('the refusal is the same word the rest of the app uses', () => {
  has(code, '>\n        ไม่อนุมัติ\n      </button>');
  // The second step, over the top of the same header — a reason gets typed
  // before anything moves.
  has(code, 'ยืนยันไม่อนุมัติ');
});

/**
 * A BUTTON THAT ONLY CLOSES IS NOT ONE OF THE ANSWERS. Five ways out of one
 * dialog, and the fifth was given a third of the foot and read first.
 */
test('nothing in the foot merely closes the pop-up', () => {
  assert.ok(!code.includes('>ปิด<'), 'ปุ่มปิดกลับมาอยู่ท้ายกล่องอีกแล้ว');
  // The ways out that remain are the Modal's own, not this footer's — ✕, Escape,
  // the backdrop and a swipe down, all four through one door and all four
  // meaning the same thing since 2026-08-20: closed, in one action. See the note
  // over `requestClose` in components/common.jsx for what that traded away, and
  // test/modalCloseButton.test.js for the one dialog that still asks.
  const modalSrc = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8').replace(/\r\n/g, '\n');
  has(modalSrc, 'className="modal-x" onClick={requestClose} aria-label="ปิด"');
  has(modalSrc, '<div className="modal-backdrop" onClick={requestClose}>');
  has(modalSrc, "if (e.key === 'Escape' && !e.defaultPrevented) requestClose();");
});

/**
 * ย้อนกลับ IS NOT ปิด. It goes back to the reading — which is the whole reason a
 * refusal is typed over the top of this pop-up instead of in a dialog of its
 * own — so it stays, quiet, beside the decision being asked for.
 *
 * `mine` (the reviewer's own filing) has no answers to offer, so it has no foot
 * at all rather than a bar holding one button that means "go away".
 *
 * `watching` is the second of those, from 2026-09-03: ฝ่ายบุคคล's queue lists
 * the รอหัวหน้า rows now, and a request that has not reached this reader's step
 * has nothing here for them to answer either. One expression covers both, so a
 * third case cannot be added to one and forgotten in the other.
 */
test('the foot is two answers, or it is not drawn', () => {
  has(code, '<button className="btn quiet" onClick={() => setMode(\'view\')}>ย้อนกลับ</button>');
  has(code, ') : (mine || watching) ? null : (');
  // Both branches lay their pair out the same way.
  assert.equal((code.match(/<div className="foot-split">/g) || []).length, 2,
    'สองสถานะของท้ายกล่องต้องจัดวางแบบเดียวกัน');
});

/**
 * EQUAL HALVES, AND EQUAL IN EVERY OTHER WAY TOO. They are the two answers to
 * one question, so any difference between their boxes — a wider one, a taller
 * one, a rounder one — is a hint about which to press. Only the fill is allowed
 * to tell them apart.
 *
 * Full width on the sheet; on a desktop the pair keeps its natural size where
 * every other dialog in this app puts its buttons.
 */
test('the pair splits the foot evenly', () => {
  // 12 on a desktop, 8 on the sheet. The gap is the margin for error between
  // an approval and a refusal, so it is wider than the app's ordinary 10 —
  // and narrower on the phone, where the pair spans the sheet and the width is
  // already doing that job.
  has(css, '.foot-split { display: flex; align-items: center; gap: 12px; }');
  has(css, '.modal-foot .foot-split { flex: 1; gap: 8px; }');
  const start = css.indexOf('.foot-split .btn {');
  const rule = css.slice(start, css.indexOf('}', start));
  has(rule, 'flex: 1 1 0;');
  has(rule, 'min-height: 46px; border-radius: 8px;');
  // A <button> centres its own label inside the box its PADDING makes; with a
  // min-height doing the sizing, that is not the box on screen.
  has(rule, 'display: flex; align-items: center; justify-content: center;');
  // 22, up from `.btn`'s 18: on a desktop the pair is shrink-to-fit at the end
  // of an otherwise empty bar, so the padding is the whole of how substantial
  // the two decisions look. From ONE rule, or the shorter label gets the
  // narrower button back — which is the difference `flex: 1 1 0` just removed.
  has(rule, 'padding: 12px 22px;');
  // `.btn` eases background, transform and shadow and stops there, because no
  // `.btn` variant had a moving border. The refusal's hover moves one — faint
  // line to ink — and left off this list the fill eases while the edge snaps.
  has(rule, 'transition: background .16s, transform .16s, box-shadow .16s, border-color .16s;');
  // ไม่อนุมัติ came out as ไม่ over อนุมัติ. Thai has no spaces, so the label
  // looks unbreakable — but browsers break Thai with a dictionary, and it knows
  // those are two words. That legal break also made the button MIN-CONTENT
  // narrower than the label, which is what let `flex: 1 1 0` divide the foot
  // into halves too narrow for it. Scoped to the pair on purpose: the batch
  // bar says ไม่อนุมัติทั้งหมดที่เลือก (3 รายการ) and is meant to wrap.
  has(rule, 'white-space: nowrap;');
  assert.ok(
    !/^.btn {[^}]*white-space/m.test(css),
    'nowrap ไปอยู่บน .btn ทั้งตระกูล — ป้ายยาวในแถบเลือกหลายใบจะทะลุขอบ',
  );
});

/**
 * THE FOOT IS THE BAR AN IPHONE'S HOME INDICATOR LIES OVER, and in landscape it
 * is also the bar the notch reaches into.
 *
 * ONE SHORTHAND, ALL FOUR SIDES. The side insets were declared in a separate
 * `.modal-foot` rule further up the phone block, and this one — later, same
 * specificity — set `padding` shorthand, which resets all four. So they were
 * written and then thrown away, and in landscape on a notched phone the two
 * decisions ran under the notch. That is what this pins: the insets and the
 * bottom padding in the SAME declaration, where nothing can quietly reset half
 * of them.
 *
 * 36px under the buttons so the pair is not read as attached to the bottom
 * edge, with the inset ADDED to it rather than standing in for it — a flat 36px
 * would put a 46px decision under the indicator. `max` on the SIDES, which stay
 * 16: a phone held upright has both insets at 0 and keeps exactly the 16px it
 * always had, and it is the bottom edge alone that was ever reported.
 *
 * THE BOTTOM READ "12px", "16px", "22px", "30px", AND IS 36px — five numbers
 * on 2026-08-28, every one of them the same report: the pair reads as attached
 * to the bottom edge. The prediction written here at 22 was that a further
 * report would be evidence the answer is not a number, and the further report
 * came. What is pinned NOW is therefore the pair of numbers together: 30 under a
 * 12px top is the widest asymmetry that still reads as one bar, and the note in
 * the stylesheet says what to change instead if it is reported a fifth time —
 * the foot's fill or the button's height, not this.
 */
test('the foot clears every edge of the sheet, in one declaration', () => {
  const start = css.indexOf('  .modal-foot {\n    border-radius: 0;');
  assert.ok(start > 0, 'the phone rule for the modal foot was renamed');
  const rule = css.slice(start, css.indexOf('}', start));
  has(rule, 'max(16px, env(safe-area-inset-right))');
  has(rule, 'calc(36px + env(safe-area-inset-bottom))');
  // The top is pinned WITH it: what makes the foot read as a bar resting on the
  // sheet's edge is the RATIO, and a later hand that raised only one of them
  // would be tuning half of the thing that was reported.
  has(rule, '12px');
  has(rule, 'max(16px, env(safe-area-inset-left))');
  // And nothing sets the foot's padding after it — a second shorthand anywhere
  // below is the same defect coming back.
  const after = css.slice(css.indexOf('}', start));
  assert.ok(!/\.modal-foot \{[^}]*padding(-left|-right)?:/.test(after),
    'มีกฎ padding ของ .modal-foot อีกอันอยู่ข้างล่าง — ค่ามุมจอจะถูกล้างอีก');
});

/**
 * AND THE REFUSAL IS LIFTED OFF IT, like the approval beside it.
 *
 * `.btn` floats on `0 6px 18px var(--green-glow)`, and that lift is most of why
 * the approval reads as a solid object with a crisp edge. `.btn.ghost.danger`
 * sets `box-shadow: none`, so the refusal was pressed flat into the footer —
 * same height, same corner, same width, and still not a pair. Asked for six
 * times as "a clearer border"; the border was never the missing part.
 */
test('the refusal is lifted off the footer, not pressed into it', () => {
  const start = css.indexOf('.foot-split .btn.ghost.danger {');
  const rule = css.slice(start, css.indexOf('}', start));
  has(rule, 'box-shadow: 0 3px 10px -4px var(--shadow-3);');
  has(css, '.foot-split .btn.ghost.danger:active:not(:disabled) { box-shadow: none; }');
});

/**
 * The refusal was a white card with GREY letters — `.modal-foot .btn.ghost`
 * beats `.btn.ghost.danger` on order — sitting beside a filled green button. It
 * read as the disabled one.
 */
test('the refusal is light red, in tokens and not in hexes', () => {
  const start = css.indexOf('.foot-split .btn.ghost.danger {');
  const rule = css.slice(start, css.indexOf('}', start));
  has(rule, 'background: var(--reject-bg); color: var(--reject-ink); border: 1px solid var(--reject-line);');
  // The green is the app's filled `.btn` and needs nothing said about it here.
  assert.ok(!css.includes('.foot-split .btn:not(.ghost)'), 'ปุ่มเขียวถูกเขียนทับ');
});

/**
 * A SECOND RED, AND IT HAS TO CARRY BOTH THEMES.
 *
 * These three were specified as light-mode hexes. Written at the rule they
 * would be three colours stranded in ธีมมืด — which is what
 * `no rule names a colour of its own` in test/theme.test.js exists to catch,
 * and it only reads the rules: a token defined with one half sails past it.
 * So both halves are asserted here, at the exact values, because "the red the
 * button is" is the whole request.
 */
test('the refusal red is a token with a dark half, not a light-mode hex', () => {
  const PAIRS = [
    ['--reject-bg', '#FEF2F2', '#331717'],
    ['--reject-line', '#FECACA', '#5A2626'],
    ['--reject-ink', '#DC2626', '#FCA5A5'],
  ];
  for (const [name, light, dark] of PAIRS) {
    // The plain fallback, for a browser that drops light-dark().
    has(css, name + ': ' + light + ';');
    has(css, name + ': light-dark(' + light + ', ' + dark + ');');
  }
});

/**
 * WHO on one line, WHEN on the next.
 *
 * The subtitle was one string — code · แผนก · date · day-name — which on a
 * phone is three lines of grey with no way to see which part answers which
 * question. They are two questions: who this is, and what day is being decided
 * about. The second is the decision's subject and gets a line of its own.
 */
test('the header says who, then when', () => {
  has(code, '<span className="s-who">');
  has(code, '<span className="s-when">');
  has(css, '.modal-head .s-who { display: block; }');
  // `--ink`, and it read `--muted` and then `--ink-2` earlier on 2026-08-28.
  // THE LEAD IS RELATIVE: `.s` above it climbed `--muted-2` → `--muted` →
  // `--ink-2` the same day, once for legibility and once for dark mode
  // specifically (`--muted` measures 6.57 on the dark card — over AA, under
  // AAA), and each time this line had to step up too or the distinction the
  // pair exists to draw would have closed to nothing.
  has(css, '.modal-head .s-when { display: block; color: var(--ink); }');
  // WHAT IS PINNED IS THAT THEY ARE NOT THE SAME TOKEN — and this is now the
  // last rung: there is no ink above `--ink`, so a further brightening of `.s`
  // cannot be paid for by moving this one again.
  const s = css.slice(css.indexOf('.modal-head .s {'), css.indexOf('}', css.indexOf('.modal-head .s {')));
  assert.ok(!/var\(--ink\)/.test(s), 'บรรทัดคำอธิบายกับบรรทัดวันที่กลายเป็นสีเดียวกัน');
  // On the sheet the figure and the status chip share the name's line instead
  // of stacking under the ✕ — a whole line of a 375px screen.
  has(css, '.head-meta { flex-direction: row; align-items: center; gap: 6px; }');
});

/**
 * THE FOOT NEVER SCROLLS, AND NOT BECAUSE ANYTHING IS STUCK TO ANYTHING.
 *
 * `.modal` is a flex column with a capped height; `.modal-body` is the only
 * child that scrolls and `.modal-foot` is `flex: none` beside it. The two
 * decisions are therefore on screen from the moment the pop-up opens, at every
 * scroll position, with no sticky positioning involved — and `position: sticky`
 * added here would do nothing at all, because the foot is not inside the box
 * that scrolls.
 *
 * Pinned because it is invisible: somebody flattening `.modal` to `display:
 * block`, or moving the foot inside `.modal-body`, breaks it without touching
 * anything named "footer".
 */
test('the decisions are on screen at every scroll position', () => {
  const modal = css.slice(css.indexOf('.modal {'), css.indexOf('.modal.wide'));
  has(modal, 'display: flex; flex-direction: column;');
  has(modal, 'max-height: min(88dvh, 900px);');
  const body = css.slice(css.indexOf('.modal-body {'), css.indexOf('.modal-foot {'));
  has(body, 'flex: 1 1 auto;');
  has(body, 'overflow-y: auto;');
  const footStart = css.indexOf('.modal-foot {');
  // Searched FROM the rule, not from the top of the file: a comment elsewhere
  // that names `.modal-foot .btn.ghost` would otherwise end the slice before it
  // began and leave every assertion below reading an empty string.
  const foot = css.slice(footStart, css.indexOf('.modal-foot .btn.ghost', footStart));
  has(foot, 'flex: none;');
  // And the markup keeps them siblings — a foot rendered inside the body would
  // scroll away with it and every rule above would still pass.
  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    common.indexOf('className="modal-body"') < common.indexOf('className="modal-foot"'),
    'ท้ายกล่องย้ายเข้าไปอยู่ในส่วนที่เลื่อนได้',
  );
});

/**
 * A NOUGHT IS NOT WORTH A BOX ON A PHONE.
 *
 * Most entries are one bucket and two noughts — an ordinary weekday evening is
 * ×1.5 วันปกติ and nothing else — and in a strip this narrow each nought costs a
 * whole box to say nothing.
 *
 * Marked in the JSX and hidden in the stylesheet, rather than filtered out of
 * the list: a desktop reviewer reading this beside the printed form wants the
 * buckets that did NOT fill as much as the one that did, and there it costs
 * nothing to show them. One layout decides it, at the width where it matters.
 *
 * รวม is never marked — a total of 0.00 is a fact about the request, not an
 * empty bucket.
 */
test('a bucket with no hours steps out of the way on a phone', () => {
  has(code, "className={(e.buckets?.[b] || 0) === 0 ? 'box zero' : 'box'}");
  has(css, '.ot-split .box.zero { display: none; }');
  const strip = code.slice(code.indexOf('ot-split'), code.indexOf('className="note"'));
  assert.ok(!/box total[^]*zero|zero[^]*box total/.test(strip.split('box total')[1] || ''),
    'กล่องรวมถูกซ่อนไปด้วย');
  has(strip, '<div className="box total">');
});

/**
 * SAME RADIUS WAS NOT THE SAME CORNER. Both buttons took their rounding from
 * one rule, but only one of them was cut through a border — `.btn` is
 * `border: none` and the refusal carries a 1px rule, so the bordered one draws
 * a second, tighter curve inside the first and the pair read as two roundings.
 */
test('the two buttons are the same box down to the hairline', () => {
  const start = css.indexOf('.foot-split .btn {');
  const rule = css.slice(start, css.indexOf('}', start));
  has(rule, 'border-radius: 8px;');
  has(rule, 'border: 1px solid transparent;');
  // …and the refusal only re-colours that hairline; it does not add its own.
  const red = css.indexOf('.foot-split .btn.ghost.danger {');
  has(css.slice(red, css.indexOf('}', red)), 'border: 1px solid var(--reject-line);');
});

test('quiet is a voice of its own, not a ghost with the paint scraped off', () => {
  const rule = css.slice(css.indexOf('.btn.quiet {'), css.indexOf('.btn.danger {'));
  has(rule, 'background: transparent;');
  has(rule, 'color: var(--muted);');
  // A transparent rule rather than none, so it shares a baseline with the
  // bordered buttons beside it and does not jump when the hover wash arrives.
  has(rule, 'border: 1px solid transparent;');
  has(rule, 'box-shadow: none;');
  has(css, '.btn.quiet:hover:not(:disabled)');
});
