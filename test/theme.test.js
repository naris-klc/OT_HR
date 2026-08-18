import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

/** The file in three parts: the token block, the rules, and the print block. */
const rootEnd = css.indexOf('\n}\n', css.indexOf(':root {')) + 3;
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
  const rail = value('--surface-dark', 'dark');
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
  for (const n of ['--bg', '--card', '--surface-dark', '--neutral-wash', '--field-bg']) {
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

  // Three sheets, each declaring its own paper — never a token.
  const paper = new RegExp(String.raw`background: #fff;\s+color: #000;`, 'g');
  assert.equal([...print.matchAll(paper)].length, 3);

  // Three desks, all reading the same token, none holding a colour of its own.
  const desk = new RegExp(String.raw`background: var\(--paper-desk\);`, 'g');
  assert.equal([...print.matchAll(desk)].length, 3);
  assert.doesNotMatch(print, /#e8ebe9/);

  // One value, not two: the desk is the same grey in both themes, deliberately.
  assert.match(css, /--paper-desk: #e8ebe9;/);
  assert.equal(value('--paper-desk', 'light'), value('--paper-desk', 'dark'));

  // And it turns white for the printer, where there is no desk.
  const onPaper = new RegExp(String.raw`-screen \{ background: #fff;`, 'g');
  assert.equal([...print.matchAll(onPaper)].length, 3);
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
