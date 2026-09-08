import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ธีมมืด / ธีมสว่าง.
 *
 * The theme is CSS tokens and one attribute on <html>; nothing on any screen
 * knows which theme is running. These tests hold the three things that would
 * quietly stop being true — a raw colour creeping back into a rule, the printed
 * form following the screen into the dark, and text that cannot be read on the
 * fill behind it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

/**
 * The file in three parts: the token block, the rules, and the print block.
 *
 * THE END OF THE TOKEN BLOCK IS FOUND WITH A REGEX, NOT WITH `'\n}\n'`.
 *
 * `core.autocrlf` is true on the machine this is developed on, so every text
 * file is CRLF in the working copy and LF in the repository. A literal `\n}\n`
 * therefore finds nothing in a fresh clone here: `indexOf` returns -1, `rootEnd`
 * becomes 2, and the assertions below run against the string `'/*'` — the first
 * two characters of the file — and fail with a message about `--card` that says
 * nothing about line endings. That is what happened on 2026-08-18.
 *
 * The file's own endings are not the thing under test and must not be able to
 * decide the result, so the pattern accepts either.
 */
const tokenBlockEnd = /\r?\n\}\r?\n/;
const fromRoot = css.slice(css.indexOf(':root {'));
const rootEnd = css.indexOf(':root {') + fromRoot.search(tokenBlockEnd)
  + fromRoot.match(tokenBlockEnd)[0].length;
const themeEnd = css.indexOf('* { margin: 0');
const printStart = css.indexOf('@media print {');
const RULES = css.slice(themeEnd, printStart);

// ── every colour comes from a token ─────────────────────────────────────────

test('no rule names a colour of its own', () => {
  // The whole theme rests on this: a rule holding `#fff` cannot follow the
  // theme, and the way one gets in is somebody adding a component in a hurry.
  const raw = RULES.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([0-9 ,.%/]+\)/g) || [];
  assert.deepEqual(raw, [], `สีดิบในกฎ: ${raw.join(' ')}`);
});

test('the light values are still written plainly, as the fallback', () => {
  // A browser without light-dark() drops those declarations and keeps these.
  const tokens = css.slice(0, rootEnd);
  assert.match(tokens, /--card: #ffffff;/);
  assert.match(tokens, /--ink: #14201A;/);
  assert.doesNotMatch(tokens, /light-dark\(/);
});

// ── paper is not a screen ───────────────────────────────────────────────────

test('printing pins the light palette whatever the screen is set to', () => {
  // Browsers drop background colours when printing but keep foreground ones, so
  // a dark theme reaching paper prints pale text on white — F-HR-027 comes out
  // nearly blank and nobody finds out until it is printed.
  const print = css.slice(printStart);
  assert.match(print, /:root \{ color-scheme: only light; \}/);
});

// ── the choice ──────────────────────────────────────────────────────────────

test('an explicit choice beats the machine, in both directions', () => {
  assert.match(css, /:root\[data-theme="light"\] \{ color-scheme: only light; \}/);
  assert.match(css, /:root\[data-theme="dark"\] \{ color-scheme: only dark; \}/);
  // Source order matters: these come after the `light dark` default, or picking
  // สว่าง on a dark machine would appear to do nothing.
  assert.ok(css.indexOf('[data-theme="light"]') > css.indexOf('color-scheme: light dark'));
});

test('the stored choice is applied before the first paint', () => {
  const layout = readFileSync(join(ROOT, 'app/layout.js'), 'utf8');
  assert.match(layout, /localStorage\.getItem\('ot-theme'\)/);
  assert.match(layout, /documentElement\.dataset\.theme/);
  // In <head>, ahead of everything: from a React effect it would paint the
  // system's answer first and swap a frame later.
  assert.ok(layout.indexOf('THEME_BOOT') < layout.indexOf('fonts.googleapis.com'));

  /**
   * And the root element must say the mismatch it causes is expected. Without
   * it React reports a hydration error on every first paint — the server
   * rendered no theme attribute and the script had already written one. It is
   * load-bearing for the script above, not decoration: remove it and the app
   * logs an error it cannot fix, or somebody "fixes" it by moving the theme
   * into an effect and the flash comes back.
   *
   * READ FROM THE RETURNED JSX, NOT FROM THE FILE. Matching the whole file is
   * how this assertion passed while the attribute sat in a COMMENT and the real
   * tag went without it — a no-op, shipped green, found by the error still
   * being on screen. A test that a comment can satisfy is testing prose.
   */
  const code = layout
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /<html lang="th" suppressHydrationWarning>/);
  // The stripper is load-bearing, so prove it strips: the comment above the tag
  // in layout.js says the word, and the code must still be the thing matched.
  assert.ok(layout.includes('suppressHydrationWarning` IS THE POINT'), 'คอมเมนต์หายไป — เทสต์ข้างล่างไม่ได้พิสูจน์อะไร');
  assert.doesNotMatch(code, /IS THE POINT/, 'ตัวตัดคอมเมนต์ไม่ทำงาน');
});

test('the setting is per browser, not per account', () => {
  const profile = readFileSync(join(ROOT, 'components/ProfileView.jsx'), 'utf8');
  assert.match(profile, /localStorage\.setItem\(THEME_KEY/);
  assert.match(profile, /localStorage\.removeItem\(THEME_KEY\)/);
  // Nothing is sent to the server — a theme is about the screen in front of
  // somebody, and the ฝ่ายบุคคล login is shared.
  const fn = profile.slice(
    profile.indexOf('function ThemeChoice'),
    profile.indexOf('// ── read-only details'),
  );
  assert.doesNotMatch(fn, /api\.(post|patch|put)/);
});

// ── contrast ────────────────────────────────────────────────────────────────

const value = (name, side) => {
  const m = css.match(new RegExp(String.raw`${name}:\s*light-dark\(([^,]+),\s*([^)]+)\)`));
  if (m) return (side === 'light' ? m[1] : m[2]).trim();
  const plain = css.match(new RegExp(String.raw`${name}:\s*(#[0-9a-fA-F]{3,8})`));
  return plain ? plain[1] : null;
};

const luminance = (hex) => {
  let s = hex.replace('#', '');
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(s.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Body text has to clear 4.5. The pairs listed here are the ones a dark palette
 * gets wrong by construction — a fill that lightens under text that does not.
 */
const READABLE = [
  ['--ink', '--bg'],
  ['--ink', '--card'],
  ['--ink-2', '--card'],
  ['--muted', '--card'],
  ['--green-dark', '--green-bg'],
  ['--danger-ink', '--danger-bg'],
  ['--amber', '--amber-bg'],
  ['--info', '--info-bg'],
  ['--on-amber', '--amber'],
  ['--on-fill', '--surface-dark'],
  // The rail and the hero, which took `--surface-dark` until 2026-09-07 and
  // are `--panel-rail` / `--panel-hero` now. Two grounds and one ink scale, so
  // every step of that scale is measured against both: `--on-panel` is the
  // figure and the heading, `--on-panel-quiet` the kicker under the wordmark,
  // and `--on-panel-2` is held higher still by AAA_SUBTEXT at the foot of this
  // file. `--on-panel-3` is the outlined button on the hero and shares
  // `--on-panel-2`'s light value, which is why it is listed on the hero only.
  ['--on-panel', '--panel-rail'],
  ['--on-panel', '--panel-hero'],
  ['--on-panel-quiet', '--panel-rail'],
  ['--on-panel-3', '--panel-hero'],
  ['--on-panel-danger', '--panel-rail'],
  ['--hero-figure', '--panel-hero'],
  // The success notice, in both the shapes it takes: floating on the screens
  // that still use a toast, and in the flow on the two birthday screens. Listed
  // because the pair they replaced was NOT — .toast.ok filled itself with
  // --green-dark, a token ธีมมืด lifts to #9ACBAF so it can be read AS TEXT,
  // and white on that measures 1.85. Nothing here caught it, because in the
  // light theme the same declaration was fine.
  ['--toast-ok-ink', '--toast-ok-bg'],
  ['--alert-ok-ink', '--alert-ok-bg'],
  // ประกาศวันหยุดบริษัท (`.announce`), which is the first thing in this app to
  // put ordinary body text on a GREEN panel. `--green-bg` was already listed
  // above, but only under `--green-dark` — the pairing an alert makes, where the
  // ink is the panel's own hue. This banner reads as content rather than as a
  // status, so its weights are the neutral ones, and neither was checked
  // against that background until the banner existed.
  //
  // `--ink` is the banner's body and heading, `--muted` the weekday beside each
  // date, `--ink-2` the holiday's name under it.
  //
  // `--ink-2` HAS BEEN IN THIS LIST TWICE AND OUT OF IT ONCE, which is worth a
  // line because the removal was right at the time. It first coloured the rates
  // sentence; when that sentence was removed on request the pair went with it,
  // because a pair listed for something no longer on screen reads as a
  // guarantee about a combination nobody can see. It is back for the holiday
  // names, which were lifted off `--muted` a round later so that the
  // announcement's content is not as quiet as the weekday that checks its date.
  ['--ink', '--green-bg'],
  ['--ink-2', '--green-bg'],
  ['--muted', '--green-bg'],
];

test('ธีมมืด — ตัวหนังสืออ่านออกทุกคู่ ตามมาตรฐาน AA', () => {
  // The dark palette was written here, so it is held to the standard outright.
  for (const [fg, bg] of READABLE) {
    const f = value(fg, 'dark');
    const b = value(bg, 'dark');
    assert.ok(f && b, `หา token ไม่เจอ: ${fg} / ${bg}`);
    const r = contrast(f, b);
    assert.ok(r >= 4.5, `${fg} บน ${bg} = ${r.toFixed(2)} (ต้อง ≥ 4.5)`);
  }
});

/**
 * NEITHER SUCCESS FILL MAY GO SEE-THROUGH AGAIN, and this is the assertion
 * rather than a comment because the alpha shipped once.
 *
 * emerald-950/60 was asked for and built, and on a screen it did what alpha
 * does to a box that floats over a table: the rows read through it. The usual
 * answer is `backdrop-filter`, which test/modalScrollFrame.test.js forbids
 * outside the two bars — a filtered box composites as its own layer and stops
 * obeying z-index. So opaque is the only shape these two can take, and the
 * READABLE pairs above silently stop meaning anything if one drifts back:
 * `value()` captures up to the first `)`, so `rgb(2 44 34 / .6)` comes back cut
 * in half and `luminance()` returns NaN, which compares false against every
 * floor without failing anything.
 */
test('ธีมมืด — พื้นกล่องแจ้งเตือนความสำเร็จต้องทึบ ไม่มี alpha', () => {
  for (const token of ['--toast-ok-bg', '--alert-ok-bg']) {
    const dark = value(token, 'dark');
    assert.match(dark, /^#[0-9a-fA-F]{6}$/, `${token} ครึ่งมืดไม่ใช่ hex ทึบ: ${dark}`);
  }
});

/**
 * The ✕, held to the same floor as the sentence beside it.
 *
 * Kept out of READABLE because that list is measured against BOTH themes and
 * this pair only clears AA in one: on the light toast the ✕ is `--on-dark`, the
 * grey mixed for the sidebar, and it has sat at 2.36 on the green fill since
 * long before there was a theme. Raising it is a change to how the app has
 * always looked in ธีมสว่าง, which is not something to slip in under a dark-mode
 * fix — the same reasoning LIGHT_FLOOR below is built on.
 */
test('ธีมมืด — ปุ่มปิดบนกล่องแจ้งเตือนความสำเร็จอ่านออก', () => {
  for (const [x, bg] of [['--toast-ok-x', '--toast-ok-bg'], ['--alert-ok-x', '--alert-ok-bg']]) {
    const ratio = contrast(value(x, 'dark'), value(bg, 'dark'));
    assert.ok(ratio >= 4.5, `${x} บน ${bg} = ${ratio.toFixed(2)} (ต้อง ≥ 4.5)`);
  }
});

/**
 * The light theme is measured, not corrected.
 *
 * Three pairs in it have been below AA since long before there was a theme,
 * and all three are the same colour: the brand amber. Its caption sits on its
 * own pale panel at 3.46, white on the amber chip is 3.88, and the brand green
 * as link text on white is 4.43. Raising any of them changes how the app has
 * always looked, which is a decision for whoever owns the brand and not
 * something to slip in under a dark-mode change.
 *
 * So the numbers are pinned instead. Nothing may get WORSE, the two known
 * shortfalls are named here rather than left for somebody to rediscover, and
 * the day anybody decides to fix them this test says by how much.
 */
const LIGHT_FLOOR = {
  '--amber|--amber-bg': 3.45,
  '--on-amber|--amber': 3.87,
  '--green-text|--card': 4.42,
};

test('ธีมสว่าง — ไม่มีคู่ไหนแย่ลงกว่าเดิม', () => {
  const below = [];
  for (const [fg, bg] of [...READABLE, ['--green-text', '--card']]) {
    const r = contrast(value(fg, 'light'), value(bg, 'light'));
    const floor = LIGHT_FLOOR[`${fg}|${bg}`] ?? 4.5;
    assert.ok(r >= floor, `${fg} บน ${bg} = ${r.toFixed(2)} (ต้องไม่ต่ำกว่า ${floor})`);
    if (r < 4.5) below.push(`${fg} บน ${bg} = ${r.toFixed(2)}`);
  }
  // The list is asserted so that FIXING one without removing its floor is a
  // failing test too — a pinned shortfall that no longer exists is a lie.
  assert.deepEqual(below.sort(), Object.keys(LIGHT_FLOOR).sort().map((k) => {
    const [fg, bg] = k.split('|');
    return `${fg} บน ${bg} = ${contrast(value(fg, 'light'), value(bg, 'light')).toFixed(2)}`;
  }).sort());
});

/**
 * The one pair that does not clear 4.5, and the dark theme did not cause it.
 *
 * Green text on white is #0F8A46 on #ffffff — 4.43, the brand green this app
 * has shipped with since before it had a theme. Asserted at the value it has
 * rather than raised to 4.5: darkening every link in the light theme is a
 * change to how the app looks that nobody asked for while asking for a dark
 * mode, and slipping it in under that heading is how a palette drifts. The dark
 * side of the same token measures 9.33 and the loop above covers it.
 *
 * If HR ever wants it raised, #0B6E37 — already in the file as --green-dark —
 * measures 5.64 and is the smallest change that clears AA.
 */
test('green text is the pair the dark theme improved most', () => {
  // 4.43 on white, 9.33 on charcoal. Worth an assertion of its own: it is the
  // token that had to be split out of --green, and the split is what let the
  // dark side clear AA without moving the light side at all.
  assert.ok(contrast(value('--green-text', 'dark'), value('--card', 'dark')) >= 4.5);
  assert.equal(value('--green-text', 'light'), '#0F8A46');
});

/**
 * EVERY TOKEN A COMPONENT NAMES HAS TO EXIST, which nothing above checks.
 *
 * `no rule names a colour of its own` scans styles.css and only styles.css, so
 * a colour written into a .jsx is invisible to it — and `var(--x, #hex)` is
 * invisible twice over, because a name that resolves to nothing falls back to
 * the hex and the page still renders. It just renders the wrong colour, in both
 * themes, for ever.
 *
 * That is not hypothetical. `--amber-dark` was read by the รอ HR ยืนยัน badge on
 * ตั้งค่าระบบ and has never been defined anywhere in this app; what drew was its
 * fallback #8a5a00, a brown picked against a white page, which measured 2.53 on
 * the dark card. The badge announcing an unanswered [OPEN] item was the hardest
 * thing on that screen to read, and every contrast assertion in this file passed
 * the whole time, because none of them was looking at a .jsx.
 *
 * A fallback is allowed — it is the sensible thing to write for a browser that
 * drops the custom property. What is not allowed is a fallback standing in for a
 * token nobody ever wrote.
 */
test('ทุกโทเคนที่ถูกอ้างในโค้ด ต้องมีนิยามจริง', () => {
  const print = readFileSync(join(ROOT, 'app/print.css'), 'utf8');
  const defined = new Set(
    [...(css + print).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]),
  );

  const files = execFileSync('git', ['ls-files', 'app', 'components', 'lib'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => /\.(jsx?|css)$/.test(f));

  const dead = [];
  for (const f of files) {
    readFileSync(join(ROOT, f), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
          if (!defined.has(m[1])) dead.push(`${f}:${i + 1} ${m[1]}`);
        }
      });
  }
  assert.deepEqual(dead, [], `โทเคนที่ไม่มีนิยาม:\n  ${dead.join('\n  ')}`);
});

/**
 * OKLCH, for the two questions contrast cannot answer: how SATURATED a colour
 * is, and which hue family it belongs to. Both decide whether something shouts.
 */
const oklch = (hex) => {
  let s = hex.replace('#', '');
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(s.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * q;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * q;
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { C: Math.hypot(A, B), h };
};

/**
 * สีเน้นในธีมมืดต้องตุ่น — และตุ่นตามความถี่ที่มันโผล่.
 *
 * Both of these passed every assertion above while being the loudest things on
 * the screen, because CONTRAST IS NOT PROMINENCE. The first dark amber measured
 * 6.93 on the card and the อนุมัติ green measured 8.56 — the amber was dimmer by
 * the only number anyone was checking, and louder to look at.
 *
 * What makes a colour loud here is CHROMA. The dark theme is a cool near-grey
 * screen in one hue family — card 0.014, muted text 0.018 — so an accent is the
 * only colour on it and wins every glance by default.
 *
 * The ceiling is 0.09, and inside it the ORDER is deliberate: the green sits
 * under the amber, not over it. Frequency is why. Amber is the exception — a
 * held entry, a closed period, `.date.holiday` on a holiday row. Green is the
 * ordinary case: every approved chip, every link, every ✓, every total row. The
 * colour you see constantly should be the quieter of the two.
 *
 * --danger is exempt and must stay ABOVE both. An error is meant to be the
 * loudest thing in the room, and the day it stops being that is a regression.
 *
 * The light theme is deliberately not held to any of this. There these are dark
 * ink on pale panels — they recede, and muting them would only hide them.
 */
test('ธีมมืด — สีเน้นต้องตุ่น ไม่ใช่แค่ผ่าน contrast', () => {
  const amber = oklch(value('--amber', 'dark'));
  const green = oklch(value('--green-text', 'dark'));
  const danger = oklch(value('--danger', 'dark'));

  assert.ok(amber.C <= 0.09, `ส้มสดเกินไป C=${amber.C.toFixed(3)} (เพดาน 0.09)`);
  assert.ok(green.C <= 0.09, `เขียวสดเกินไป C=${green.C.toFixed(3)} (เพดาน 0.09)`);
  assert.ok(green.C < amber.C, 'เขียวโผล่บ่อยกว่าส้ม จึงต้องตุ่นกว่าส้ม');
  assert.ok(danger.C > amber.C, 'แดงผิดพลาดต้องดังที่สุด');

  // Muting the amber walked its hue toward --danger. Warning and error are two
  // colours for a reason; past this they stop being tellable apart at chip size.
  assert.ok(
    Math.abs(amber.h - danger.h) >= 18,
    `ส้มกับแดงใกล้กันเกินไป ${Math.abs(amber.h - danger.h).toFixed(0)}° (ต้อง ≥ 18°)`,
  );

  // And none of it was paid for with legibility: dulling is not dimming.
  assert.ok(contrast(value('--amber', 'dark'), value('--card', 'dark')) >= 6.9);
  assert.ok(contrast(value('--green-text', 'dark'), value('--card', 'dark')) >= 8.0);
});

/**
 * THE FILL CAME DOWN TOO, and it is the one that mattered.
 *
 * The accents were muted first and the screen did not get quieter, because on
 * สรุป OT ส่งบัญชี the 01 avatar, the Pm mark, the active row of the phone bar
 * and the primary button are all `--green` — no panel, no border, nothing to
 * soften them. Everything that was actually bright had been left alone.
 *
 * It moves freely in both directions: white on the fill is its only floor, and
 * dulling AND darkening both raise it. That is the assertion worth keeping —
 * not "the brand value is pinned", which is what used to be here and is what
 * made the fill look untouchable.
 *
 * It still leads the palette. The order is the point: fill > amber > accents,
 * so the brand is the one saturated green rather than one of several.
 */
test('ธีมมืด — สีเติมนำตระกูล แต่ไม่ใช่โคมไฟ', () => {
  const fill = oklch(value('--green', 'dark'));
  const green = oklch(value('--green-text', 'dark'));
  const amber = oklch(value('--amber', 'dark'));

  assert.ok(fill.C > amber.C && fill.C > green.C, 'สีเติมต้องเป็นเขียวที่สดที่สุด');
  assert.ok(fill.C <= 0.12, `สีเติมยังสดเกินไป C=${fill.C.toFixed(3)}`);

  // The floor that used to have the least headroom in the file now has the
  // most, which is the whole reason the fill was free to move.
  const onFill = contrast(value('--on-fill', 'dark'), value('--green', 'dark'));
  assert.ok(onFill >= 4.5, `ขาวบนสีเติม = ${onFill.toFixed(2)}`);

  // Light keeps the exact brand value: on white it was never the problem.
  assert.equal(value('--green', 'light'), '#0F8A46');
});

/**
 * เงาต้องทำให้มืดลง — รวมถึงเงาที่ชื่อว่า glow.
 *
 * A green glow under a button is a shadow; it only ever looked like light
 * because of what it sat on. On the light page `rgba(15,138,70,.28)` takes
 * #EEF1EE to #B0D4BF — lightness −0.117, a shadow. The dark half was written
 * lighter AND more opaque, and on #101513 it took the page to #124129:
 * lightness +0.147. The primary button was lit from underneath.
 *
 * This is the same rule the `--shadow-*` group already states one comment above
 * ("a shadow works by darkening what is under it"), applied to the group that
 * was three lines below it and breaking it.
 */
test('ธีมมืด — เงาต้องทำให้มืดลง ไม่ใช่เปล่งแสง', () => {
  const parse = (rgba) => {
    const [r, g, b, a] = rgba.match(/[\d.]+/g).map(Number);
    return { rgb: [r, g, b], a };
  };
  const composite = (rgba, bgHex) => {
    const { rgb, a } = parse(rgba);
    let s = bgHex.replace('#', '');
    const bg = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
    const mix = rgb.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
    return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('');
  };
  // The dark half of a light-dark() pair whose value is an rgba(), not a hex.
  const shadowValue = (name) =>
    css.match(new RegExp(String.raw`${name}: light-dark\([^)]*\),\s*(rgba\([^)]*\))`))[1];

  const page = value('--bg', 'dark');
  for (const n of ['--green-glow', '--green-glow-sm', '--green-glow-lg', '--danger-glow']) {
    const on = composite(shadowValue(n), page);
    const delta = luminance(on) - luminance(page);
    assert.ok(delta <= 0, `${n} ทำให้พื้นสว่างขึ้น (+${delta.toFixed(4)}) — นั่นคือแสง ไม่ใช่เงา`);
  }

  // --focus-ring is the exception: pulling the eye IS its job, so it may emit.
  // Bounded, not banned — it sat at +0.102 in OKLCH lightness and was the
  // second brightest thing on a card after the button it was ringing.
  const ring = composite(shadowValue('--focus-ring'), value('--card', 'dark'));
  assert.ok(contrast(ring, value('--card', 'dark')) <= 1.6, 'วงโฟกัสสว่างเกินไป');
});

/**
 * The panel and the border are the same colour as the word inside them. They
 * were left on the old gold hue for one edit and framed a brick-toned word in a
 * golden-brown plate — close enough to look like a mistake, far enough to see.
 */
test('ธีมมืด — พื้นและเส้นขอบส้มอยู่ในวรรณะเดียวกับตัวอักษร', () => {
  const amber = oklch(value('--amber', 'dark'));
  for (const n of ['--amber-bg', '--amber-line', '--on-amber']) {
    const d = Math.abs(oklch(value(n, 'dark')).h - amber.h);
    assert.ok(d <= 10, `${n} หลุดวรรณะสีส้มไป ${d.toFixed(0)}°`);
  }
});

/**
 * The dark theme needs its panels to be TELLABLE APART, which no contrast
 * assertion above covers: text can be perfectly readable on a card nobody can
 * see the edge of, and the first dark palette shipped exactly that — page, rail
 * and card within nine points of lightness of each other, which read as one
 * flat sheet.
 *
 * The floors are low on purpose. Near black, a 1.2 ratio is a visible step and
 * a 1.5 would mean a card the colour of a light grey; what is being pinned is
 * the ORDER and the fact that a step exists at all.
 */
test('ธีมมืด — พื้นผิวแต่ละระดับแยกจากกันได้', () => {
  const bg = value('--bg', 'dark');
  const card = value('--card', 'dark');
  // THROUGH `--panel-rail`, NOT `--surface-dark`. This line read the latter
  // and called it `rail`, which was the same value and the same object until
  // 2026-09-07. It is now the same value and a DIFFERENT object — the toast
  // and the login splash — so left alone this assertion would have gone on
  // passing while saying nothing about the column it names.
  const rail = value('--panel-rail', 'dark');
  const line = value('--line', 'dark');

  assert.ok(contrast(card, bg) >= 1.18, `การ์ดกับพื้นหน้าใกล้กันเกินไป = ${contrast(card, bg).toFixed(2)}`);
  assert.ok(contrast(rail, bg) >= 1.05, `แถบข้างกับพื้นหน้าใกล้กันเกินไป = ${contrast(rail, bg).toFixed(2)}`);
  assert.ok(contrast(line, card) >= 1.2, 'เส้นขอบการ์ดต้องมองเห็น');

  // The order: page darkest, rail above it, card above that. Light falls on
  // what is nearest, so the thing being read is the lightest thing on screen.
  const lum = (h) => contrast(h, '#000000');
  assert.ok(lum(bg) < lum(rail) && lum(rail) < lum(card), 'ลำดับความลึกกลับด้าน');
});

/**
 * A grey mixed toward the brand reads as olive at panel size, however well it
 * works in a 4px border. The first palette had the card nine points off
 * neutral; anything past about a dozen is a screen that looks unwell.
 */
test('ธีมมืด — เทาต้องไม่อมเขียวจนขุ่น', () => {
  const spread = (hex) => {
    const s = hex.replace('#', '');
    const ch = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
    return Math.max(...ch) - Math.min(...ch);
  };
  for (const n of ['--bg', '--card', '--surface-dark', '--panel-rail', '--panel-hero',
    '--neutral-wash', '--field-bg']) {
    const v = value(n, 'dark');
    assert.ok(spread(v) <= 12, `${n} = ${v} อมเขียวเกินไป (${spread(v)})`);
  }
});

/**
 * The paper previews — F-HR-027 and the two accounting sheets.
 *
 * NEITHER LAYER FOLLOWS THE THEME, for two different reasons.
 *
 * The sheet cannot: it is a picture of paper, it declares its own white and its
 * own black, and a preview that went dark would lie about what comes out of the
 * printer.
 *
 * The desk under it was themed near-black for one afternoon and put back after
 * the two were compared on screen — the light grey reads as the desk the paper
 * is lying on, and this preview is the one screen in the app pretending to be a
 * physical object. Both are still tokens so that print.css holds no raw colour
 * a later reader would assume is themed.
 */
test('กระดาษและโต๊ะรองกระดาษไม่เปลี่ยนตามธีม', () => {
  const print = readFileSync(join(ROOT, 'app/print.css'), 'utf8');

  /**
   * FOUR sheets, each declaring its own paper — never a token.
   *
   * It was three until the password slips (`.slips`) joined F-HR-027 and the
   * two accounting sheets. The count is deliberately a count and not a `>= 1`:
   * it is the thing that fails when somebody adds a fifth printable and reaches
   * for `var(--card)` because that is what every other surface in the app uses.
   * On paper that is a themed colour on a sheet the printer will not tint, and
   * in the dark theme it is near-black ink on white.
   *
   * So a failure here is not "update the number" — it is "the new sheet either
   * declares its own #fff/#000 like the four below, or it is not a sheet".
   */
  const paper = new RegExp(String.raw`background: #fff;\s+color: #000;`, 'g');
  assert.equal([...print.matchAll(paper)].length, 4);

  // Four desks, all reading the same token, none holding a colour of its own.
  const desk = new RegExp(String.raw`background: var\(--paper-desk\);`, 'g');
  assert.equal([...print.matchAll(desk)].length, 4);
  assert.doesNotMatch(print, /#e8ebe9/);

  // One value, not two: the desk is the same grey in both themes, deliberately.
  assert.match(css, /--paper-desk: #e8ebe9;/);
  assert.equal(value('--paper-desk', 'light'), value('--paper-desk', 'dark'));

  // And it turns white for the printer, where there is no desk.
  const onPaper = new RegExp(String.raw`-screen \{ background: #fff;`, 'g');
  assert.equal([...print.matchAll(onPaper)].length, 4);
});

/**
 * The fill and the text are two tokens, and that part never changed.
 *
 * White on the fill wants the green dark; green text on a dark card wants it
 * light. No single value does both, which is why there are two — and it is why
 * `value('--green', 'dark')` must never quietly become the text green because
 * somebody noticed they were "both the green".
 *
 * What DID change is the second line of this test. It used to assert
 * `/--green: #0F8A46;/` against the whole file to pin the fill as one value
 * across themes. That assertion outlived the decision: the plain fallback block
 * at the top of styles.css still contains that exact string, so it kept passing
 * after the fill was themed and stopped meaning anything. Read the token
 * through `value()` like every other assertion here, or it is not testing the
 * palette, it is testing the fallback.
 */
test('the fill and the text green are two tokens, not one', () => {
  assert.notEqual(value('--green-text', 'dark'), value('--green', 'dark'));
  assert.notEqual(value('--green-text', 'light'), value('--green-dark', 'light'));

  // Both themes, both jobs, measured rather than assumed.
  for (const side of ['light', 'dark']) {
    const onFill = contrast(value('--on-fill', side), value('--green', side));
    assert.ok(onFill >= 4.4, `ขาวบนสีเติม (${side}) = ${onFill.toFixed(2)}`);
  }
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SMALL PRINT ON หน้า OT ของฉัน IS HELD TO AAA, NOT AA.
 *
 * Reported 2026-08-28 as "อ่านยากบน Dark Mode" across three places at once —
 * the ceiling sentence on the hero, the ×1.5 / ×3 explanations on the rate
 * cards, and the role line in the sidebar. Every one of them PASSED the AA
 * floor the READABLE list above enforces, and one of them did not:
 *
 *     --on-dark  on the hero        6.30 dark   6.23 light   AA, not AAA
 *     --muted-2  on a card          5.04 dark   3.41 light   FAILS AA in light
 *     --muted-2  on the sidebar     5.59 dark   4.92 light   AA by a whisker
 *
 * THE LIGHT NUMBER ON THE MIDDLE ROW IS THE FINDING. It was reported as a dark
 * mode problem and the default theme was worse: 3.41 is under 4.5, so the line
 * that says which hours a figure counted has been below the floor for everyone
 * who never opened the theme menu. The AA list did not catch it because
 * `--muted-2` was never a pair anybody wrote down.
 *
 * THE SIDEBAR ROW IS A DIFFERENT FAULT WEARING THE SAME SYMPTOM. `--muted-2` is
 * mixed against a white card and `.whoami` sits on `--surface-dark`; the token
 * was not too faint so much as measured against the wrong thing. That is the
 * `--amber-dark` shape from the note further down this file in a milder form —
 * a real name resolving on a surface nobody checked it against.
 *
 * SO THE FLOOR HERE IS 7.0 AND THE LIST IS OF PAIRS, not of tokens. A token is
 * only light or dark relative to what it is drawn on, which is the whole lesson
 * of the two rows above.
 */
/**
 * AND THE TWO GROUNDS ARE NAMED TWICE EACH, which is the 2026-09-07 half of
 * this note. The pairs were `--on-dark-2` on `--surface-dark` and its warning
 * beside it, one ground for both lines because the rail and the hero were one
 * colour. They still are one colour in ธีมมืด and are two in ธีมสว่าง — white
 * for the rail, a pale green wash for the hero — so a single pair can no
 * longer stand for both, and the hero (the darker of the two by seven points)
 * is the one that decides whether the ink clears.
 *
 * THAT IS WHAT MOVED THE WARNING. `--amber-ink`, the token this app mixed for
 * amber on a pale wash, measures 5.77 on `--panel-hero` — AA, and this line is
 * held to AAA. It is the same finding as the dark half of the pair, arrived at
 * from the opposite side of the palette, and the list below is what forces it
 * to be arrived at rather than assumed.
 */
const AAA_SUBTEXT = [
  // The hero's cap, unit and sentence, and the rail's name and role line.
  ['--on-panel-2', '--panel-rail'],
  ['--on-panel-2', '--panel-hero'],
  // "รออนุมัติอีก 23 ชม.", the one line on the hero that is a warning.
  ['--on-panel-warn', '--panel-hero'],
  // OT วันปกติ ×1.5 and its two neighbours: label, unit and note.
  ['--ink-2', '--card'],
];

test('ตัวหนังสือเล็กบนหน้า OT ของฉัน ผ่าน AAA ทั้งสองธีม', () => {
  for (const [ink, bg] of AAA_SUBTEXT) {
    for (const theme of ['light', 'dark']) {
      const ratio = contrast(value(ink, theme), value(bg, theme));
      assert.ok(ratio >= 7, `${ink} บน ${bg} (${theme}) = ${ratio.toFixed(2)} (ต้อง ≥ 7)`);
    }
  }
});

test('ไม่มีตัวหนังสือเล็กบนหน้านั้นถอยกลับไปใช้โทเคนที่วัดแล้วไม่ผ่าน', () => {
  // The three rules that were reported, by name. A test on the tokens alone
  // would still pass on the day somebody put `--muted-2` back into one of them,
  // which is exactly the move that has to be caught: the pair is only safe
  // because these rules are the ones using it.
  const rule = (sel) => {
    const at = css.indexOf(`\n${sel} {`);
    assert.ok(at > 0, `หากฎ ${sel} ไม่เจอ`);
    return css.slice(at, css.indexOf('}', at));
  };
  for (const sel of ['.hero .cap', '.hero .sub', '.stat .label', '.stat .note', '.whoami .r']) {
    assert.ok(!/var\(--muted-2\)|var\(--on-dark\)|var\(--on-panel-quiet\)/.test(rule(sel)),
      `${sel} กลับไปใช้โทเคนที่วัดได้ต่ำกว่า AAA บนพื้นของมัน`);
  }
  // And the warning is a warning: amber, and not the grey beside it.
  assert.match(rule('.hero .sub.waiting'), /var\(--on-panel-warn\)/);
});
