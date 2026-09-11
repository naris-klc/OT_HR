'use client';

import React, { useMemo, useState } from 'react';
import {
  ROLE_LABEL_TH, approverRolesFor, isSigner, readsCompanyReports, roleLabel,
} from '@/lib/roles.js';
import { mayCorrectEntries } from '@/lib/entries.js';
import { printName } from '@/lib/printFile.js';
import { Disclosure, Empty, PrintChrome } from './common.jsx';
import Icon from './icons.jsx';
import { useBackHandler } from './nav.jsx';

/**
 * คู่มือการใช้งาน — one scrolling page, cut to what the reader's บทบาท can
 * actually open.
 *
 * ── WHY IT IS NOT A TAB ────────────────────────────────────────────────────
 *
 * Unchanged, and it is the one decision on this screen that has never moved.
 * Every other screen here is a `tabs.push` in `Shell`, and a push carries two
 * partitions with it: `group` for the sidebar's three blocks and `bar` for the
 * phone's slots. The phone bar is capped at four columns — `test/roleNavTabs`
 * asserts it per บทบาท — and a ผู้เซ็น already fills all four with one screen
 * apiece. A twelfth tab for everybody would have made that bar five wide, or
 * put a sheet on a slot that is currently one press to one screen.
 *
 * So it is reached the way ข้อมูลส่วนตัว is: a row in the sidebar's foot and a
 * row in the phone drawer, **neither of them gated on บทบาท**. That is still
 * true and it is the promise `test/manualScreen.test.js` guards; see the
 * section below for why it survives the gating that was added around it.
 *
 * ── IT READ "THE SCREEN IS ITSELF A MENU" UNTIL 2026-09-09 ─────────────────
 *
 * The paragraph that stood here argued for the index BEING the screen, on the
 * grounds that *eleven topics as one scrolling page is a page that gets
 * scrolled past*. The objection was real and it is worth keeping in writing,
 * because what answered it is not a change of mind — it is the two things that
 * arrived with the rewrite:
 *
 *   **The page is cut to the reader.** Eighteen หัวข้อ exist; a พนักงาน is
 *   shown eight of them, which is not a page anybody scrolls past. The long
 *   version — every section on one page — is only ever seen by ผู้ดูแลระบบ, who
 *   is one account.
 *
 *   **The index did not go away, it stopped being a door.** `.manual-rail` is
 *   the same list of หัวข้อ, pinned beside the text on a desktop and pinned
 *   above it on a phone, marking where the reader is. Jumping to a หัวข้อ still
 *   costs one press; what it no longer costs is a press to get BACK, and a
 *   reader who wanted the next หัวข้อ after this one no longer has to know its
 *   name to reach it. (It read "a strip of chips above it on a phone" until
 *   2026-09-10 — see the ⚠ over `Rail`, which is where the phone shape and the
 *   reason it changed are written down.)
 *
 * ── THE MENU ROW IS UNGATED; THE SECTIONS ARE GATED ────────────────────────
 *
 * THESE ARE TWO DIFFERENT RULES AND THEY MUST NOT BE COLLAPSED INTO ONE. The
 * request that put this screen in the app was *ให้ทุกสิทธิ์ดูได้*, and that is
 * a promise about the DOOR: every บทบาท has a way in, so nobody is told the
 * manual is not for them. The request that rewrote it was *แสดงเฉพาะวิธีใช้งาน
 * ที่ใช้งานได้ตามสิทธิ์*, and that is a promise about the CONTENTS: what is
 * inside is what this reader can act on.
 *
 * A single rule cannot serve both, and the failure of merging them is silent in
 * one direction: putting the gate on the sidebar row would hide the manual from
 * somebody who has one section they can read, and nothing on their screen would
 * say a manual exists. So the gate lives HERE, in `SECTIONS[].gate`, and
 * `components/App.jsx` builds the two rows with no condition on them at all.
 *
 * NOT ONE PREDICATE IN THIS FILE IS WRITTEN FRESH. `isSigner`,
 * `readsCompanyReports` and `approverRolesFor` come from lib/roles.js and
 * `mayCorrectEntries` from lib/entries.js — the same four the menu builder, the
 * queues and the report routes ask. A `role === 'hr'` typed into this file
 * would be a second place the app decides who may correct an entry, and the two
 * would disagree the first time one of them moved. `permissionsOf` is the only
 * place that reads them, and everything below reads `permissionsOf`.
 *
 * ── EVERY UI ILLUSTRATION IS DRAWN TWICE ───────────────────────────────────
 *
 * Asked for on 2026-09-09 — *ภาพประกอบต้องมี ui ทั้งแบบหน้าจอ มือถือ และ pc* —
 * and it is not the same picture at two widths. The two bars are different
 * objects and the manual already says so in prose: a desktop has a sidebar of
 * named rows down the left, a phone has at most four glyphs across the bottom
 * plus a round + in the corner, and a slot holding more than one screen opens a
 * sheet rather than going anywhere. A reader following a step is on exactly one
 * of the two, and a single picture is wrong for one of them.
 *
 * So `Shot` takes `desk` and `phone` and draws both, side by side on a wide
 * screen and stacked on a narrow one, each under a label saying which it is.
 * `Diagram` is the other kind and takes neither: a route through two signatures
 * and the way a night shift is cut into rate columns are facts about the
 * SYSTEM, not about the device, and drawing those twice would say there are two
 * of them.
 *
 * ── WHY THE PICTURES ARE DRAWN AND NOT PHOTOGRAPHED ────────────────────────
 *
 * A screenshot would be a binary in git that no test can read, and this app
 * renames its own screens: `สรุปทีม` became `รายงาน OT ประจำทีม` and
 * `OT ของฉัน` became `บันทึกและประวัติ OT`, both on 2026-08-31, and the queue
 * row lost a column and grew icon buttons on 2026-09-09. Every one of those
 * would have left a picture saying the old thing, correct-looking, with nothing
 * failing.
 *
 * The mocks below are `.mk-*` elements taking the app's own tokens, so they
 * follow ธีมสว่าง/ธีมมืด without being told and print through the one PDF path
 * with no asset to embed. What they cannot do is stay true on their own — they
 * are a drawing of a screen, and `AGENTS.md`'s rule about finding the paragraph
 * that describes what you changed covers them exactly.
 *
 * ── THE MENU PICTURE IS THE READER'S OWN MENU ──────────────────────────────
 *
 * `navGroups` and `barSlots` are handed in from `Shell` rather than rebuilt
 * here. They are the arrays the real sidebar and the real phone bar are drawn
 * from, so the picture in เมนูของคุณ cannot show a row the reader does not have
 * or miss one they do. A list retyped in this file would have been the fourth
 * copy of the menu and the one nobody updates.
 *
 * ── WHAT IT MAY SAY, AND WHAT IT MUST NOT ──────────────────────────────────
 *
 * IT DESCRIBES MECHANISM, NEVER A POLICY FIGURE. เพดาน, การปัดเศษ, เวลางาน
 * ปกติ, จำนวนวันที่ยื่นล่วงหน้าได้ — every one of those is a value ฝ่ายบุคคล can
 * change on ตั้งค่าระบบ without anybody touching this file, and a manual that
 * printed today's number would be wrong the first time they did. It says WHERE
 * the number is instead, which stays true.
 *
 * THAT NOW COVERS THE PICTURES TOO, and it is the rule the new drawings are
 * most likely to break, because a mock of a form wants to be filled in. Every
 * value shown in a `Shot` is either structural (a rate column's name) or marked
 * as an example on the face of it; none of them is a figure ตั้งค่าระบบ owns.
 * docs/hr-briefing.md carries that table, read off the machine on a stated date
 * and marked with the date for exactly this reason.
 */

/**
 * WHAT THIS READER MAY DO — asked once, from the four predicates that already
 * decide it, and read by every `gate` below.
 *
 * `readOnly` is DERIVED and not a บทบาท test, which is the whole reason it is
 * spelt this way: it means *reads every แผนก's month and may write to none of
 * it*, which today is การเงิน and is a description of a permission rather than
 * of a person. Written as `role === 'finance'` it would go quietly wrong the
 * day a second บทบาท is given the same reading right.
 *
 * An absent `user` answers พนักงาน to everything. That is the safe direction
 * and it is the one this screen can afford: the worst case is a reader shown
 * fewer sections than they have, on a page they reached from a menu row that is
 * still there.
 */
export function permissionsOf(user) {
  const role = user?.role || 'employee';
  const company = readsCompanyReports(role);
  const correct = mayCorrectEntries(user);
  return {
    role,
    label: roleLabel(role),
    submit: Boolean(user?.maySubmitOt),
    sign: isSigner(role),
    company,
    correct,
    logs: role === 'admin',
    readOnly: company && !correct,
    firstStep: approverRolesFor(role),
  };
}

/* ── the mock's furniture ─────────────────────────────────────────────────
 *
 * Small enough to read in one screen, and deliberately not a component library:
 * every one of these is a `<span>` with a class, so a mock reads as the shape
 * it is drawing rather than as a tree of wrappers.
 *
 * SPANS AND NOT DIVS, ALL OF THEM. A drawing has to be droppable anywhere a
 * step's prose can go, and one of those places is inside a `<p>` — where a
 * `<div>` is invalid markup that React does not warn about and the browser
 * silently restructures around, moving the drawing out of the paragraph it was
 * written in. The layout lives in app/styles.css; these carry none of it.
 */

/** A named row — a sidebar entry, a list item, a section of a settings page. */
const MkRow = ({ children, on = false, badge = null, pin = null }) => (
  <span className={on ? 'mk-row on' : 'mk-row'}>
    <span className="mk-row-t">{children}</span>
    {pin ? <span className="mk-pin">{pin}</span> : null}
    {badge ? <span className="mk-badge">{badge}</span> : null}
  </span>
);

/** A labelled input. `on` is the one the step is talking about. */
const MkField = ({ label, children, on = false, pin = null }) => (
  <span className="mk-field">
    <span className="mk-lab">{label}</span>
    <span className={on ? 'mk-in on' : 'mk-in'}>
      <span className="mk-in-t">{children}</span>
      {pin ? <span className="mk-pin">{pin}</span> : null}
    </span>
  </span>
);

const MkBtn = ({ children, ghost = false }) => (
  <span className={ghost ? 'mk-btn ghost' : 'mk-btn'}>{children}</span>
);

/** สถานะ and the two icon buttons on a queue row wear the same shape. */
const MkChip = ({ children, tone = 'off' }) => (
  <span className={`mk-chip ${tone}`}>{children}</span>
);

const MkNote = ({ children, tone = null }) => (
  <span className={tone ? `mk-note ${tone}` : 'mk-note'}>{children}</span>
);

/** One phone-bar button — a glyph over a word, exactly what BarSlot draws. */
const MkSlot = ({ icon, label, on = false, badge = null }) => (
  <span className={on ? 'mk-slot on' : 'mk-slot'}>
    <Icon name={icon} className="mk-slot-i" />
    <span className="mk-slot-t">{label}</span>
    {badge ? <span className="mk-badge">{badge}</span> : null}
  </span>
);

/** A tick or a cross on a queue row — two squares since 2026-09-09. */
const MkIconBtn = ({ icon, tone = 'ok', children }) => (
  <span className={`mk-ibtn ${tone}`}>
    <Icon name={icon} className="mk-ibtn-i" />
    {children ? <span className="mk-ibtn-t">{children}</span> : null}
  </span>
);

/** A tick box — the column a queue is worked in batches from. */
const MkTick = ({ children, on = false }) => (
  <span className="mk-tick">
    <span className={on ? 'mk-box on' : 'mk-box'} aria-hidden="true">{on ? '✓' : ''}</span>
    <span className="mk-tick-t">{children}</span>
  </span>
);

/** The strip of section buttons a settings-shaped screen wears on a desktop. */
const MkTabs = ({ items, on = null }) => (
  <span className="mk-tabs">
    {items.map((t) => <span key={t} className={t === on ? 'mk-tab on' : 'mk-tab'}>{t}</span>)}
  </span>
);

/** A table's heading strip — the column names, in the table's own order. */
const MkCols = ({ children }) => <span className="mk-cols">{children}</span>;

/**
 * The desktop window — the sidebar down the left, and the app bar over the PAGE
 * rather than over the whole window.
 *
 * THE BAR WAS DRAWN ACROSS BOTH UNTIL 2026-09-10, and that is a window this app
 * has never drawn: `.shell` is `aside.sidebar` BESIDE `.body`, and `.appbar`
 * lives inside `.body` — so the bar starts where the menu ends, and what stands
 * above the menu is the menu's own head, the PRIMUS lockup with the button that
 * collapses the rail beside it.
 *
 * `title` IS THE PAGE'S OWN NAME AND NOT THE NAME OF THE SYSTEM, because that
 * is what the real bar reads: `PAGE[tab]` in components/App.jsx, one entry per
 * screen. `title={null}` drops the bar along with the sidebar, for the one
 * screen that has neither — เข้าสู่ระบบ, drawn before anybody has a บทบาท.
 */
function Desk({ title = null, nav = null, children }) {
  return (
    <span className="mk mk-desk">
      <span className="mk-desk-body">
        {nav === false ? null : (
          <span className="mk-side">
            <span className="mk-brand">
              <span className="mk-brand-n">PRIMUS</span>
              <span className="mk-brand-k">OT SYSTEM</span>
              <span className="mk-fold" aria-hidden="true">‹</span>
            </span>
            {nav}
          </span>
        )}
        <span className="mk-main">
          {title ? (
            <span className="mk-bar">
              <span className="mk-mark" aria-hidden="true" />
              <span className="mk-bar-t">{title}</span>
            </span>
          ) : null}
          <span className="mk-canvas">{children}</span>
        </span>
      </span>
    </span>
  );
}

/**
 * The phone — app bar, the page, and the bar of at most four slots under it.
 *
 * THE APP BAR CARRIES THE TWO CONTROLS A PHONE HAS AND A DESKTOP DOES NOT: the
 * mark at the left, which is ย้อนกลับ, and the round button at the right, which
 * holds the whole of the menu that does not fit on the bar below. Both are
 * drawn, because a step that says กดปุ่มมุมบนขวา is describing something that
 * has to be in the picture.
 *
 * `fab` is the round + on บันทึกและประวัติ OT and nowhere else — `showFab` in
 * components/App.jsx is `maySubmitOt && tab === 'mine'` — and it is the one
 * difference this app's phone layout actually has.
 */
function Phone({ title = null, bar = null, fab = false, children }) {
  return (
    <span className="mk mk-phone">
      {title ? (
        <span className="mk-bar">
          <span className="mk-mark" aria-hidden="true" />
          <span className="mk-bar-t">{title}</span>
          <span className="mk-av" aria-hidden="true" />
        </span>
      ) : null}
      <span className="mk-canvas">
        {children}
        {fab ? <span className="mk-fab" aria-hidden="true">+</span> : null}
      </span>
      {bar === false ? null : <span className="mk-bottom">{bar}</span>}
    </span>
  );
}

/**
 * ONE STEP'S PICTURE, ON BOTH DEVICES.
 *
 * `role="img"` with `alt` on the figure and `aria-hidden` on the drawing — a
 * screen reader gets one sentence saying what the picture shows, rather than
 * walking a wireframe twice and reading the same words the step above it just
 * said. `alt` is required; `test/manualScreen.test.js` refuses a `Shot`
 * without one, because a mock is made of text and an unlabelled one reads as
 * nonsense rather than as a missing image.
 */
function Shot({ alt, desk, phone, caption = null }) {
  return (
    <figure className="mshot" role="img" aria-label={alt}>
      <div className="mshot-pair" aria-hidden="true">
        <div className="mshot-one">
          <span className="mshot-tag">บนคอมพิวเตอร์</span>
          {desk}
        </div>
        <div className="mshot-one">
          <span className="mshot-tag">บนมือถือ</span>
          {phone}
        </div>
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

/** The other kind — a fact about the system, which has no phone version. */
function Diagram({ alt, caption = null, children }) {
  return (
    <figure className="mdiag" role="img" aria-label={alt}>
      {children}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

/**
 * เส้นทางอนุมัติ, drawn for the reader's own บทบาท.
 *
 * `approverRolesFor` answers with the list of บทบาท who may sign this person's
 * first step, and an EMPTY list is not a missing answer — it is การเงิน,
 * ผู้จัดการฝ่าย, ฝ่ายบุคคล and ผู้ดูแลระบบ, whose requests have no first step
 * because the signature they would collect first is ฝ่ายบุคคล's own. So the
 * middle node is drawn dashed and named rather than left out: a two-box picture
 * would look like a diagram missing a box, and the thing worth showing is that
 * the step is absent BY THE RULE.
 */
function FlowDiagram({ p }) {
  const first = p.firstStep;
  const names = first.map((r) => ROLE_LABEL_TH[r] || r);
  const has = names.length > 0;
  const alt = has
    ? `เส้นทางอนุมัติของใบที่${p.label}ยื่น: ${p.label} ส่งไปที่ ${names.join(' หรือ ')} แล้วจึงถึงฝ่ายบุคคล`
    : `เส้นทางอนุมัติของใบที่${p.label}ยื่น: ไม่มีขั้นแรก ใบไปรอฝ่ายบุคคลตั้งแต่ยื่น`;
  return (
    <Diagram
      alt={alt}
      caption={has
        ? 'ผู้เซ็นขั้นแรกคือคนที่ถือแผนกนั้นอยู่ — ถ้าแผนกไม่มีใครเซ็นได้เลย ใบไปรอฝ่ายบุคคลแทน'
        : 'ไม่ใช่การข้ามขั้น — บทบาทนี้ไม่มีขั้นแรกให้ข้าม'}
    >
      <div className="mflow">
        <div className="mflow-node acc">
          <span className="mflow-k">ผู้ยื่น</span>
          <span className="mflow-n">คุณ · {p.label}</span>
        </div>
        <span className="mflow-arrow" aria-hidden="true">→</span>
        <div className={has ? 'mflow-node' : 'mflow-node gone'}>
          <span className="mflow-k">ขั้นที่ 1</span>
          <span className="mflow-n">{has ? names.join(' · ') : 'ไม่มีขั้นนี้'}</span>
          <span className="mflow-s">{has ? 'รอหัวหน้า' : 'ใบข้ามมาเลย'}</span>
        </div>
        <span className="mflow-arrow" aria-hidden="true">→</span>
        <div className="mflow-node">
          <span className="mflow-k">ขั้นที่ {has ? 2 : 1}</span>
          <span className="mflow-n">ฝ่ายบุคคล</span>
          {/* The word the CHIP wears, which is `STATUS.pending_hr.label` in
              lib/api.js and reads รอ HR — not the name of the step above it.
              The two are different things and the row shows the chip. */}
          <span className="mflow-s">รอ HR</span>
        </div>
        <span className="mflow-arrow" aria-hidden="true">→</span>
        <div className="mflow-node done">
          <span className="mflow-k">จบ</span>
          <span className="mflow-n">อนุมัติ</span>
          <span className="mflow-s">เข้ารายงานประจำเดือน</span>
        </div>
      </div>
    </Diagram>
  );
}

/**
 * How one ใบ becomes hours in three columns.
 *
 * NO TIME AND NO BLOCK SIZE IN IT, which is the rule this drawing is most
 * tempted to break: a picture of a shift wants an axis with hours on it, and
 * every hour it could show is a value ฝ่ายบุคคล owns. What it draws instead is
 * the CUT — one span typed once, split by the day it falls on and the hours
 * that day counts as normal, landing in columns whose names are structural.
 */
function RateDiagram() {
  return (
    <Diagram
      alt="ใบเดียวที่กรอกเป็นช่วงเวลาเดียว ถูกระบบตัดตามช่วงเวลางาน แล้วเข้าช่องอัตราสามช่อง"
      caption="ยอดสามช่องบวกกันได้เท่ากับยอดรวมพอดี เพราะระบบปัดเศษแยกทีละช่อง"
    >
      <div className="mrate">
        <div className="mrate-in">ช่วงเวลาที่คุณกรอก — เวลาเริ่ม ถึง เวลาสิ้นสุด (วันเดียวจบ)</div>
        <div className="mrate-arrow" aria-hidden="true">ระบบตัดเองว่าช่วงไหนเข้าช่องไหน</div>
        <div className="mrate-out">
          <div className="mrate-col">
            <span className="mrate-k">OT วันปกติ ×1.5</span>
            <span className="mrate-v">ชั่วโมงนอกเวลางาน ในวันทำงานปกติ</span>
          </div>
          <div className="mrate-col">
            <span className="mrate-k">OT วันหยุด ×1.5</span>
            <span className="mrate-v">ชั่วโมงในวันหยุด ที่ตรงกับช่วงเวลางานปกติ</span>
          </div>
          <div className="mrate-col">
            <span className="mrate-k">OT วันหยุด ×3</span>
            <span className="mrate-v">ชั่วโมงในวันหยุด ที่อยู่นอกช่วงเวลางานปกติ</span>
          </div>
        </div>
      </div>
    </Diagram>
  );
}

/** สถานะของใบ — the five `OtEntry.status` values, in the order a ใบ meets them. */
const STATUS_ROWS = [
  ['รอหัวหน้า', 'wait', 'ยื่นแล้ว รอผู้เซ็นขั้นแรก (หัวหน้างาน / ผู้จัดการ / การเงิน) กดอนุมัติ'],
  ['รอ HR', 'wait', 'ผ่านขั้นแรกแล้ว รอฝ่ายบุคคลยืนยันเป็นขั้นสุดท้าย'],
  ['อนุมัติ', 'ok', 'อนุมัติครบทุกขั้นแล้ว — ชั่วโมงเข้าไปอยู่ในรายงานประจำเดือน'],
  ['ไม่อนุมัติ', 'no', 'มีผู้ไม่อนุมัติ พร้อมเหตุผล — แก้ไม่ได้ ต้องกด ส่งใหม่ เพื่อยื่นใบใหม่'],
  ['ยกเลิก', 'off', 'เจ้าของใบยกเลิกเอง หรือคำขอถอนได้รับอนุมัติ — ไม่ถูกนับในรายงาน'],
];

/**
 * ── THE HEADINGS THE RAIL GROUPS UNDER ────────────────────────────────────
 *
 * FIVE, AND NOT THE SIDEBAR'S THREE. The menu's blocks answer *whose work is
 * this*; these answer *what are you trying to do*, which is the question
 * somebody opens a manual with. They are close enough to be worth saying apart:
 * a หัวหน้างาน's own OT and the queue they empty sit in one sidebar block
 * (การอนุมัติ & รายงาน holds the queue; ข้อมูลส่วนตัว holds their filing) and
 * are two different jobs to read about.
 *
 * A heading with no sections under it is not drawn, which is the same rule the
 * sidebar's blocks follow and for the same reason.
 */
const GROUPS = Object.freeze([
  'อ่านก่อนใช้งาน',
  'ใบของคุณเอง',
  'งานอนุมัติ',
  'รายงาน',
  'งานฝ่ายบุคคลและผู้ดูแลระบบ',
]);

/**
 * ── หัวข้อทั้งหมด ──────────────────────────────────────────────────────────
 *
 * One row per section, and every row carries its own `gate`. Written as a
 * function of `permissionsOf`'s answer rather than of `user`, so that no
 * section can reach past the four predicates to ask a บทบาท question of its
 * own — which is the thing that would put a fifth copy of the access rules in
 * this file.
 *
 * `gateLabel` is what the section wears on screen. It is a SENTENCE FOR THE
 * READER and not a restatement of the predicate: somebody reading a manual
 * wants to know that this part is theirs because they sign for a แผนก, not that
 * `isSigner` returned true.
 *
 * ORDER IS THE ORDER SOMEBODY MEETS THESE THINGS, which is why เริ่มต้นใช้งาน
 * is first and ปัญหาที่พบบ่อย is last whatever the บทบาท. The rail groups them
 * but does not re-sort them: a filter keeps the order it found things in, and
 * two orders for one list is what `Shell` spends a comment block avoiding.
 */
const SECTIONS = [

  {
    key: 'start',
    group: 'อ่านก่อนใช้งาน',
    icon: 'user',
    title: 'เริ่มต้นใช้งาน',
    blurb: () => 'เข้าสู่ระบบ · รหัสผ่านครั้งแรก · เปลี่ยนรหัสของตัวเอง',
    gate: () => true,
    gateLabel: () => 'ทุกบทบาท',
    Body: ({ p }) => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            กรอก <b>รหัสพนักงาน · EMPLOYEE ID</b> และ <b>รหัสผ่าน · PASSWORD</b> แล้วกด
            {' '}<b>เข้าสู่ระบบ</b>
          </p>
          <ul>
            <li>
              <b>ขีดกลางในรหัสพนักงานไม่มีผลตอนเข้าสู่ระบบ</b> — พิมพ์ PM-0620 หรือ PM0620
              ระบบก็อ่านเป็นรหัสเดียวกัน และตัวพิมพ์เล็กพิมพ์ใหญ่ก็ไม่ต่างกัน
              ตัวอย่างที่จาง ๆ อยู่ในช่องคือรูปแบบของสองบริษัท
            </li>
            <li>
              <b>รหัสผ่านครั้งแรกคือรหัสพนักงานของตัวเอง</b> — แต่ช่องนี้ตรงตัวทุกอักขระ
              ให้พิมพ์เป็น<b>ตัวพิมพ์ใหญ่ตามที่อยู่บนบัตร</b> ถ้ารหัสบนบัตรมีขีดกลาง รหัสผ่านก็ต้องมีขีดกลางด้วย
              {' '}· ค่าเดียวกันนี้คือค่าที่ได้กลับมาหลังฝ่ายบุคคลกดรีเซ็ตรหัสผ่านให้ · บรรทัดนี้เขียนอยู่ใต้ช่องรหัสผ่านแล้ว
            </li>
            <li>กดรูป<b>ตา</b>ท้ายช่องรหัสผ่านเพื่อดูสิ่งที่พิมพ์ไป</li>
            <li>กรอกผิดติดกันหลายครั้ง ระบบจะให้รอสักครู่ก่อนลองใหม่ ข้อความสีแดงใต้ช่องกรอกจะบอกว่าติดตรงไหน</li>
            <li>เข้าไม่ได้จริง ๆ ให้ติดต่อฝ่ายบุคคล ตามบรรทัดท้ายการ์ด — <b>ไม่มีปุ่มลืมรหัสผ่านในระบบ</b></li>
          </ul>
          <Shot
            alt="หน้าเข้าสู่ระบบ ช่องรหัสพนักงานและช่องรหัสผ่านพร้อมปุ่มรูปตา บนคอมพิวเตอร์แบ่งจอสองฝั่ง ฝั่งซ้ายเป็นแถบชื่อระบบ ฝั่งขวาเป็นฟอร์ม บนมือถือแถบชื่อระบบย่อขึ้นไปอยู่ด้านบนแล้วฟอร์มอยู่ใต้ลงมา"
            caption="ฟอร์มเดียวกัน — บนคอมพิวเตอร์แถบชื่อระบบกินครึ่งจอซ้าย บนมือถือย่อเหลือแถบบนสุด ยังไม่มีเมนูทั้งสองเครื่อง"
            desk={(
              <Desk nav={false}>
                <span className="mk-split">
                  <span className="mk-pane">
                    <span className="mk-pane-k">PRIMUS · OVERTIME SYSTEM</span>
                    <span className="mk-pane-h">ระบบบันทึกและอนุมัติค่าล่วงเวลา</span>
                  </span>
                  <span className="mk-col">
                    <MkRow>เข้าสู่ระบบ</MkRow>
                    <MkField label="รหัสพนักงาน · EMPLOYEE ID" on>PM00111 / THT1111</MkField>
                    <MkField label="รหัสผ่าน · PASSWORD">
                      ••••••••<Icon name="eye" className="mk-ibtn-i" />
                    </MkField>
                    <MkNote>เข้าใช้งานครั้งแรก · รหัสผ่านคือรหัสพนักงานของคุณ</MkNote>
                    <MkBtn>เข้าสู่ระบบ</MkBtn>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone bar={false}>
                <span className="mk-pane">
                  <span className="mk-pane-k">PRIMUS · OVERTIME SYSTEM</span>
                  <span className="mk-pane-h">ระบบบันทึกและอนุมัติค่าล่วงเวลา</span>
                </span>
                <MkRow>เข้าสู่ระบบ</MkRow>
                <MkField label="รหัสพนักงาน · EMPLOYEE ID" on>PM00111 / THT1111</MkField>
                <MkField label="รหัสผ่าน · PASSWORD">
                  ••••••••<Icon name="eye" className="mk-ibtn-i" />
                </MkField>
                <MkNote>เข้าใช้งานครั้งแรก · รหัสผ่านคือรหัสพนักงานของคุณ</MkNote>
                <MkBtn>เข้าสู่ระบบ</MkBtn>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            ตราบใดที่ยังใช้รหัสผ่านที่ฝ่ายบุคคลตั้งให้ จะมี<b>แถบเตือนสีเหลือง</b>ขึ้นบน
            {' '}<b>หน้าแรกของบทบาทคุณ</b> — หน้าแรกหน้าเดียว ไม่ได้ตามไปทุกหน้า
            เพราะรหัสนั้นคือรหัสพนักงานซึ่งพิมพ์อยู่บนใบ OT ทุกใบและคนอื่นทราบด้วย
            กดปุ่ม <b>เปลี่ยนรหัสผ่าน</b> ในแถบนั้น ระบบจะพาไปที่หน้า <b>ข้อมูลส่วนตัว</b>
            {' '}ตั้งรหัสใหม่เสร็จแล้วแถบจะหายไปเอง
          </p>
          <Shot
            alt="แถบเตือนสีเหลืองบนหน้าแรก เขียนว่าคุณยังใช้รหัสผ่านที่ฝ่ายบุคคลตั้งให้อยู่ และมีปุ่มเปลี่ยนรหัสผ่านอยู่ใต้ข้อความ"
            caption="ข้อความและปุ่มวางเหมือนกันทั้งสองเครื่อง — ปุ่มอยู่ใต้ข้อความเสมอ ไม่ได้อยู่ท้ายบรรทัด"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-alert col">
                  <span className="mk-alert-t">คุณยังใช้รหัสผ่านที่ฝ่ายบุคคลตั้งให้อยู่</span>
                  <MkNote>— รหัสนี้คือรหัสพนักงานของคุณ ซึ่งมีคนอื่นทราบด้วย</MkNote>
                  <MkBtn ghost>เปลี่ยนรหัสผ่าน</MkBtn>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <span className="mk-alert col">
                  <span className="mk-alert-t">คุณยังใช้รหัสผ่านที่ฝ่ายบุคคลตั้งให้อยู่</span>
                  <MkNote>— รหัสนี้คือรหัสพนักงานของคุณ ซึ่งมีคนอื่นทราบด้วย</MkNote>
                  <MkBtn ghost>เปลี่ยนรหัสผ่าน</MkBtn>
                </span>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            หน้า <b>ข้อมูลส่วนตัว</b> เข้าจาก<b>ชื่อตัวเองมุมล่างซ้ายของเมนู</b>
            {' '}(บนมือถือคือปุ่มตัวอักษรย่อมุมบนขวา แล้วเลือกในกลุ่ม <b>บัญชี</b>) — ในนั้นมีสี่การ์ดเรียงลงมา
          </p>
          <ul>
            <li>
              <b>ข้อมูลส่วนตัว</b> — รหัสพนักงาน ชื่อ-สกุล ตำแหน่ง วันเกิด แผนก บทบาท และบริษัท
              เป็นข้อมูลของฝ่ายบุคคล อ่านได้อย่างเดียว แก้เองไม่ได้ ถ้าผิดให้แจ้งฝ่ายบุคคล
            </li>
            {p.sign ? (
              <li>
                <b>ผู้รับช่วงอนุมัติแทน</b> — การ์ดนี้ขึ้นเพราะคุณเซ็นขั้นแรก ดูหัวข้อ
                {' '}<b>ตั้งผู้รับช่วงอนุมัติแทน</b> ด้านล่าง
              </li>
            ) : null}
            <li><b>ธีมสีหน้าจอ</b> — <b>ตามเครื่อง · สว่าง · มืด</b> จำไว้เฉพาะในเบราว์เซอร์นี้ ไม่ผูกกับบัญชี และใบที่พิมพ์ออกกระดาษเป็นพื้นขาวเสมอ</li>
            <li><b>เปลี่ยนรหัสผ่าน</b> — กรอกรหัสผ่านเดิม รหัสผ่านใหม่ และยืนยันรหัสผ่านใหม่</li>
            <li><b>ออกจากระบบ</b> — ปุ่มขอบแดงท้ายหน้า มีที่นี่ด้วย นอกเหนือจากที่มุมล่างซ้ายของเมนู</li>
          </ul>
          <Shot
            alt="หน้าข้อมูลส่วนตัว การ์ดเรียงลงมาคือ ข้อมูลส่วนตัว ธีมสีหน้าจอ เปลี่ยนรหัสผ่าน และออกจากระบบ บนคอมพิวเตอร์เข้าจากชื่อตัวเองที่มุมล่างซ้ายของแถบเมนู บนมือถือเข้าจากปุ่มตัวอักษรย่อมุมบนขวาแล้วเลือกในกลุ่มบัญชี"
            caption="ทางเข้าคนละที่ แต่เป็นหน้าเดียวกัน — ข้อมูลในการ์ดแรกอ่านได้อย่างเดียว แก้เองไม่ได้"
            desk={(
              <Desk
                title="ข้อมูลส่วนตัว"
                nav={(
                  <>
                    <span className="mk-side-h">ข้อมูลส่วนตัว</span>
                    <MkRow>บันทึกและประวัติ OT</MkRow>
                    <span className="mk-side-foot">
                      <MkRow on pin="›">ชื่อของคุณ · {p.label}</MkRow>
                      <MkRow>ออกจากระบบ</MkRow>
                    </span>
                  </>
                )}
              >
                <MkCols>ข้อมูลส่วนตัว · รหัสพนักงาน · ชื่อ-สกุล · ตำแหน่ง · วันเกิด · แผนก · บทบาท · บริษัท</MkCols>
                <MkRow>ธีมสีหน้าจอ · ตามเครื่อง / สว่าง / มืด</MkRow>
                <MkRow>เปลี่ยนรหัสผ่าน</MkRow>
                <MkRow>ออกจากระบบ</MkRow>
              </Desk>
            )}
            phone={(
              <Phone title="ข้อมูลส่วนตัว" bar={<MkSlot icon="clock" label="ประวัติ OT" />}>
                <MkNote>ปุ่มตัวอักษรย่อมุมบนขวา → กลุ่ม บัญชี → ข้อมูลส่วนตัว</MkNote>
                <MkCols>ข้อมูลส่วนตัว · รหัสพนักงาน · ชื่อ-สกุล · ตำแหน่ง · วันเกิด · แผนก · บทบาท · บริษัท</MkCols>
                <MkRow>ธีมสีหน้าจอ</MkRow>
                <MkRow>เปลี่ยนรหัสผ่าน</MkRow>
                <MkRow>ออกจากระบบ</MkRow>
              </Phone>
            )}
          />
        </li>
      </ol>
    ),
  },

  {
    key: 'menu',
    group: 'อ่านก่อนใช้งาน',
    icon: 'users',
    title: 'เมนูของคุณ',
    blurb: (p) => `บทบาท ${p.label} เห็นเมนูอะไรบ้าง และเมนูอยู่ตรงไหนของแต่ละเครื่อง`,
    gate: () => true,
    gateLabel: () => 'ทุกบทบาท · เนื้อหาตรงกับเมนูจริงของคุณ',
    Body: ({ p, navGroups, barSlots }) => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            เมนูขึ้นตามบทบาทที่ฝ่ายบุคคลตั้งไว้ในทะเบียนพนักงาน
            ภาพข้างล่างคือ<b>เมนูของคุณเอง</b> ไม่ใช่ตัวอย่าง — บทบาท <b>{p.label}</b> เห็นเท่านี้
          </p>
          <Shot
            alt={`เมนูของบทบาท${p.label} บนคอมพิวเตอร์เป็นแถบด้านซ้ายแบ่งเป็นบล็อก บนมือถือเป็นแถบล่างสูงสุดสี่ปุ่ม`}
            caption="แถบซ้ายลิสต์ทุกหน้าเป็นชื่อเต็ม · แถบล่างมีได้สูงสุดสี่ปุ่ม ปุ่มที่มีหลายหน้าอยู่ข้างในจะเปิดเป็นรายการขึ้นมา"
            desk={(
              <Desk
                title="คู่มือการใช้งาน"
                nav={(
                  <>
                    {navGroups.map((g) => (
                      <React.Fragment key={g.key}>
                        <span className="mk-side-h">{g.label}</span>
                        {/* A HEADING AND THEN ITS ROWS, WITH NOTHING BETWEEN.
                            `{g.parent ? <MkRow pin="›">…` was drawn here until
                            2026-09-10: ข้อมูลส่วนตัว collapsed behind a row
                            reading OT ส่วนตัว, and `parent` came down with the
                            group. The field left NAV_GROUPS with the fold on
                            that day and all three blocks are flat lists now —
                            see components/App.jsx. */}
                        {g.items.map((t) => (
                          <MkRow key={t.key} badge={t.badge || null}>{t.label}</MkRow>
                        ))}
                      </React.Fragment>
                    ))}
                    {/* No heading over it on a desktop — the row sits in a
                        second `<nav>` of its own with the name only where a
                        screen reader can hear it. The phone's drawer is where
                        ช่วยเหลือ is written out. */}
                    <MkRow on>คู่มือการใช้งาน</MkRow>
                    <span className="mk-side-foot">
                      <MkRow pin="›">ชื่อของคุณ · {p.label}</MkRow>
                      <MkRow>ออกจากระบบ</MkRow>
                    </span>
                  </>
                )}
              >
                <MkNote>หน้าที่เปิดอยู่จะถูกทำเครื่องหมายไว้บนแถบซ้าย</MkNote>
              </Desk>
            )}
            phone={(
              <Phone
                title="คู่มือการใช้งาน"
                bar={barSlots.map((s) => (
                  <MkSlot key={s.key} icon={s.icon} label={s.label} badge={s.badge || null} />
                ))}
              >
                <MkNote>
                  ปุ่มวงกลม<b>ตัวอักษรย่อของคุณ</b>มุมบนขวา เปิดเมนูทั้งชุดเป็นแผ่นซ้อน —
                  บล็อกเดียวกับแถบซ้าย แล้วต่อด้วยกลุ่ม ช่วยเหลือ (คู่มือการใช้งาน) และกลุ่ม บัญชี
                  (ข้อมูลส่วนตัว · ออกจากระบบ)
                </MkNote>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>อ่านตัวเลขและปุ่มบนแถบ</p>
          <ul>
            <li><b>ตัวเลขสีเหลือง</b>บนปุ่มคือจำนวนใบที่รอคุณอยู่ ถ้าไม่มีก็ไม่มีตัวเลข</li>
            <li><b>โลโก้มุมบนซ้ายคือปุ่มย้อนกลับ</b> — ปิดฟอร์มหรือหน้าซ้อนทีละชั้น จนกลับถึงหน้าแรกของบทบาทตัวเอง</li>
            <li>บนคอมพิวเตอร์ <b>ลูกศรข้าง PRIMUS หัวแถบซ้าย</b>ย่อแถบให้เหลือเฉพาะไอคอน · ชี้ค้างที่ไอคอนแล้วชื่อเต็มจะขึ้นมา · หน้าต่างแคบระบบย่อให้เอง กดลูกศรเพื่อกางค้างไว้ได้</li>
            <li>บนคอมพิวเตอร์ แต่ละบล็อกเป็น<b>รายการหน้าจอเรียงใต้หัวข้อ</b>ตรง ๆ ไม่มีแถวพับให้กดก่อน</li>
            <li>บนมือถือ ปุ่มที่มีหลายหน้าอยู่ข้างในจะเปิดเป็น<b>แผ่นรายการ</b>ขึ้นมาก่อน แล้วจึงเลือกหน้า</li>
          </ul>
          <Shot
            alt="สิ่งที่อยู่บนแถบเมนู บนคอมพิวเตอร์คือหัวแถบ PRIMUS พร้อมลูกศรย่อแถบ หัวข้อบล็อก แถวหน้าจอพร้อมตัวเลขสีเหลือง และชื่อตัวเองที่ก้นแถบ บนมือถือคือโลโก้ย้อนกลับมุมบนซ้าย ปุ่มตัวอักษรย่อมุมบนขวา และแถบล่างที่มีตัวเลขบนปุ่ม"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — ตัวเลขสีเหลืองคือจำนวนใบที่รอคุณ ไม่มีใบค้างก็ไม่มีตัวเลข"
            desk={(
              <Desk
                title="รายการรออนุมัติ"
                nav={(
                  <>
                    <span className="mk-side-h">ข้อมูลส่วนตัว</span>
                    <MkRow>บันทึกและประวัติ OT</MkRow>
                    <span className="mk-side-h">การอนุมัติ &amp; รายงาน</span>
                    <MkRow on badge="3">รายการรออนุมัติ</MkRow>
                    <span className="mk-side-foot">
                      <MkRow pin="›">ชื่อของคุณ · {p.label}</MkRow>
                    </span>
                  </>
                )}
              >
                <MkNote>ลูกศร ‹ ที่หัวแถบย่อทั้งแถบให้เหลือเฉพาะไอคอน · ชี้ค้างแล้วชื่อเต็มจะขึ้นมา</MkNote>
              </Desk>
            )}
            phone={(
              <Phone
                title="รายการรออนุมัติ"
                bar={(
                  <>
                    <MkSlot icon="clock" label="ประวัติ OT" />
                    <MkSlot icon="inbox" label="รออนุมัติ" on badge="3" />
                    <MkSlot icon="chart" label="รายงาน" />
                    <MkSlot icon="sliders" label="เพิ่มเติม" />
                  </>
                )}
              >
                <MkNote>ซ้ายบนคือโลโก้ = ย้อนกลับ · ขวาบนคือตัวอักษรย่อของคุณ = เมนูทั้งชุด</MkNote>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            <b>คู่มือหน้านี้เปิดได้ทุกบทบาท</b> แต่แสดงเฉพาะหัวข้อที่บทบาทของคุณใช้งานได้จริง —
            คุณกำลังอ่านฉบับของ <b>{p.label}</b> หน้าจอที่คุณเปิดไม่ได้จะไม่มีวิธีใช้อยู่ในนี้
          </p>
          <Shot
            alt="หน้าคู่มือที่คุณกำลังอ่านอยู่ บนคอมพิวเตอร์รายชื่อหัวข้อเป็นแถบอยู่ข้างซ้ายของเนื้อหา บนมือถือรายชื่อเดียวกันกลายเป็นแถวปุ่มกลมอยู่เหนือเนื้อหาและปัดซ้ายขวาได้"
            caption="รายการหัวข้อไม่ใช่หน้าแยก — เนื้อหาทั้งหมดอยู่หน้าเดียวเลื่อนอ่านต่อกันได้ กดหัวข้อคือการกระโดดไปที่จุดนั้น ไม่ต้องกดย้อนกลับ"
            desk={(
              <Desk title="คู่มือการใช้งาน" nav={<MkRow on>คู่มือการใช้งาน</MkRow>}>
                <span className="mk-split">
                  <span className="mk-col">
                    <span className="mk-side-h">อ่านก่อนใช้งาน</span>
                    <MkRow on>เริ่มต้นใช้งาน</MkRow>
                    <MkRow>เมนูของคุณ</MkRow>
                    <span className="mk-side-h">ใบของคุณเอง</span>
                    <MkRow>บันทึกใบขอ OT</MkRow>
                  </span>
                  <span className="mk-col">
                    <MkRow>เริ่มต้นใช้งาน</MkRow>
                    <MkNote>ขั้นตอนของหัวข้อนั้นเรียงเป็นข้อ ๆ พร้อมภาพประกอบ</MkNote>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="คู่มือการใช้งาน" bar={<MkSlot icon="sliders" label="เพิ่มเติม" />}>
                <MkTabs on="เริ่มต้นใช้งาน" items={['เริ่มต้นใช้งาน', 'เมนูของคุณ', 'บันทึกใบขอ OT']} />
                <MkNote>แถวปุ่มนี้ปัดซ้าย-ขวาได้ และค้างอยู่บนสุดขณะเลื่อนอ่าน</MkNote>
              </Phone>
            )}
          />
        </li>
      </ol>
    ),
  },

  {
    key: 'file',
    group: 'ใบของคุณเอง',
    icon: 'pencil',
    title: 'บันทึกใบขอ OT',
    blurb: () => 'กรอกอะไรบ้าง และระบบตรวจอะไรให้ก่อนบันทึก',
    gate: (p) => p.submit,
    gateLabel: () => 'ทุกบทบาทที่ยื่น OT ได้',
    Body: () => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            เปิดเมนู <b>บันทึกและประวัติ OT</b> หน้าแรกคือยอดของเดือนที่เลือกอยู่ —
            <b>ชั่วโมง OT</b> ของเดือนนั้น ยอด<b>อนุมัติแล้ว</b>กับที่ยัง<b>รออนุมัติ</b>
            {' '}และการ์ดสามใบแยกตามช่องอัตรา แล้วจึงกดปุ่มเพิ่มรายการ — ปุ่มอยู่คนละที่บนสองเครื่อง
          </p>
          <Shot
            alt="หน้าบันทึกและประวัติ OT บนคอมพิวเตอร์มีปุ่ม + บันทึก OT ใหม่ อยู่ท้ายแถบยอดชั่วโมง บนมือถือเป็นปุ่มกลมมุมขวาล่าง"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — บนคอมพิวเตอร์ปุ่มอยู่บนแถบยอดชั่วโมง บนมือถือเป็นปุ่มกลม + มุมขวาล่าง ลอยอยู่เหนือแถบล่าง"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>ชั่วโมง OT · กันยายน 2569</MkRow>
                  <span className="mk-acts">
                    <MkBtn>+ บันทึก OT ใหม่</MkBtn>
                    <MkBtn ghost>ดูประวัติทั้งหมด</MkBtn>
                  </span>
                </span>
                <span className="mk-three">
                  <span className="mk-cell"><span className="mk-cell-k">OT วันปกติ ×1.5</span><span className="mk-cell-v">6.0</span></span>
                  <span className="mk-cell"><span className="mk-cell-k">OT วันหยุด ×1.5</span><span className="mk-cell-v">0.0</span></span>
                  <span className="mk-cell"><span className="mk-cell-k">OT วันหยุด ×3</span><span className="mk-cell-v">2.5</span></span>
                </span>
                <MkNote>ใต้ลงมาคือ รายการล่าสุด · เลือกเดือนได้ที่ช่อง ประจำเดือน บนหัวการ์ด</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" fab bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkRow>ชั่วโมง OT · กันยายน 2569</MkRow>
                <span className="mk-cell"><span className="mk-cell-k">OT วันปกติ ×1.5</span><span className="mk-cell-v">6.0</span></span>
                <MkNote>ปุ่มกลม + มุมขวาล่างคือปุ่มเดียวกับ + บันทึก OT ใหม่</MkNote>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>กรอกวันที่และเวลา — <b>หนึ่งใบอยู่ในวันเดียว</b></p>
          <ul>
            <li><b>วันที่เริ่ม</b> — วันที่ลงมือทำงาน · กดที่ช่องแล้วปฏิทินของระบบจะเปิดขึ้นมา วันที่นอกช่วงที่ยื่นได้จะเป็นสีจางกดไม่ได้</li>
            <li><b>เวลาเริ่ม (จาก)</b> และ <b>เวลาสิ้นสุด (ถึง)</b> — <b>เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มเสมอ</b> ถ้าใส่เวลาสิ้นสุดน้อยกว่าหรือเท่ากับเวลาเริ่ม ระบบจะไม่รับใบนั้น</li>
            <li><b>ทำงานเลยเที่ยงคืน</b> — <b>ให้แยกเป็นสองใบ ใบละวัน</b> เช่น ทำ 21:00 ถึง 02:00 ให้ยื่นใบแรก 21:00–23:59 ของวันที่เริ่ม และใบที่สอง 00:01–02:00 ของวันถัดไป · ทั้งสองใบไม่ผิดกฎหนึ่งวันหนึ่งใบ เพราะเป็นคนละวันที่กัน</li>
            <li><b>รายละเอียดงานที่ทำ</b> — จำกัดความยาว เพราะช่องบนใบที่พิมพ์ออกมามีบรรทัดเดียว ตัวนับจำนวนตัวอักษรอยู่มุมขวาของหัวช่อง</li>
          </ul>
          <Shot
            alt="ฟอร์มบันทึก OT บนคอมพิวเตอร์ช่องวันที่เริ่ม เวลาเริ่ม และเวลาสิ้นสุดอยู่บรรทัดเดียวกัน บนมือถือเรียงลงมาทีละช่อง"
            caption="ช่องเหมือนกันทั้งสองเครื่อง — บนคอมพิวเตอร์สามช่องแรกอยู่บรรทัดเดียวกัน บนมือถือเรียงลงมาทีละช่อง · วันและเวลาในภาพเป็นตัวอย่าง"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-two">
                  <MkField label="วันที่เริ่ม" on>10/09/2569</MkField>
                  <span className="mk-two">
                    <MkField label="เวลาเริ่ม (จาก)" on>21:00</MkField>
                    <MkField label="เวลาสิ้นสุด (ถึง)" on>23:59</MkField>
                  </span>
                </span>
                <MkField label="รายละเอียดงานที่ทำ">ตรวจสอบสายการผลิต 3</MkField>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkField label="วันที่เริ่ม" on>10/09/2569</MkField>
                <MkField label="เวลาเริ่ม (จาก)" on>21:00</MkField>
                <MkField label="เวลาสิ้นสุด (ถึง)" on>23:59</MkField>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            อ่านช่อง <b>ระบบคำนวณได้</b> ที่ขึ้นมาเองใต้ฟอร์ม ก่อนกด <b>ส่งขออนุมัติ</b> —
            แยกให้เห็นทีละช่องอัตราพร้อมยอดรวม ไม่ต้องคิดชั่วโมงเอง
          </p>
          <Shot
            alt="ช่องระบบคำนวณได้ แยกสามช่องอัตราและช่องรวมชั่วโมง OT บนคอมพิวเตอร์เรียงในบรรทัดเดียว บนมือถือเรียงลงมา"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — ยอดจริงขึ้นกับเวลาที่กรอกและค่าที่ฝ่ายบุคคลตั้งไว้ · บนหน้าจอจริง ชื่อช่องวันหยุดสองช่องมีช่วงเวลางานปกติกำกับไว้ด้วย"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-lab">ระบบคำนวณได้</span>
                <MkNote>เวลาทั้งหมด 5.0 ชม. · หักพัก 0.0 ชม.</MkNote>
                <span className="mk-four">
                  <span className="mk-cell"><span className="mk-cell-k">OT วันปกติ ×1.5</span><span className="mk-cell-v">2.0</span></span>
                  <span className="mk-cell"><span className="mk-cell-k">OT วันหยุด ×1.5</span><span className="mk-cell-v">0.0</span></span>
                  <span className="mk-cell"><span className="mk-cell-k">OT วันหยุด ×3</span><span className="mk-cell-v">2.5</span></span>
                  <span className="mk-cell"><span className="mk-cell-k">รวมชั่วโมง OT</span><span className="mk-cell-v">4.5</span></span>
                </span>
                <MkNote>ใต้ลงมาเป็นรายการช่วงที่ระบบตัดให้ทีละวัน แล้วจึงถึงปุ่ม ส่งขออนุมัติ</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <span className="mk-lab">ระบบคำนวณได้</span>
                <span className="mk-cell"><span className="mk-cell-k">OT วันปกติ ×1.5</span><span className="mk-cell-v">2.0</span></span>
                <span className="mk-cell"><span className="mk-cell-k">OT วันหยุด ×3</span><span className="mk-cell-v">2.5</span></span>
                <span className="mk-cell"><span className="mk-cell-k">รวมชั่วโมง OT</span><span className="mk-cell-v">4.5</span></span>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            อ่านแถบข้อความที่ขึ้นรอบ ๆ ตัวเลข — <b>สีฟ้าคือบอกให้ทราบ สีเหลืองคือเตือนแล้วยังบันทึกได้
            {' '}สีแดงคือระบบไม่รับใบ</b>
          </p>
          <ul>
            <li><b>วันเกิดของคุณเอง</b> — บอกว่าวันนั้นนับเป็นวันหยุดของคุณคนเดียว คิดให้อัตโนมัติ ไม่ต้องติ๊กอะไรเพิ่ม</li>
            <li>
              <b>วันนั้นมีใบอยู่แล้ว</b> หรือ <b>เวลาทับกับใบอื่น</b> — ระบบยกใบที่ชนขึ้นมาเป็นแถวพร้อมป้ายสถานะให้ดู
              และ<b>ไม่รับใบใหม่</b> ให้กลับไปแก้เวลาในใบเดิมแทน เพราะใบ F-HR-027 มีบรรทัดเดียวต่อหนึ่งวัน
            </li>
            <li>
              <b>เพดานของแผนก</b> — บอกเพดาน ยอดที่ใช้ไปแล้ว และยอดรวมถ้านับใบนี้ด้วย ·
              ตามค่าปกติ เกินแล้วยังบันทึกได้แล้วส่งให้ฝ่ายบุคคลพิจารณา แต่ถ้าฝ่ายบุคคลตั้งไว้ให้ปิดกั้น ระบบจะไม่รับใบ
            </li>
            <li>
              <b>ต่ำกว่าเวลาขั้นต่ำ</b> — ทำอย่างไรขึ้นกับค่าที่ฝ่ายบุคคลตั้งไว้ที่ <b>ตั้งค่าระบบ</b>:
              รับตามชั่วโมงจริงแล้วติดธงไว้ · ปัดขึ้นเป็นขั้นต่ำ · หรือไม่รับรายการ
            </li>
            <li><b>แผนกนี้ไม่คิดโอที</b> — ยังคำนวณให้ดู แต่ปุ่มบันทึกจะกดไม่ได้</li>
          </ul>
          <Shot
            alt="แถบข้อความบนฟอร์มสามสี ฟ้าคือบอกให้ทราบ เหลืองคือเตือนแต่ยังบันทึกได้ แดงคือระบบไม่รับใบ ท้ายฟอร์มเป็นปุ่มส่งขออนุมัติที่จะกดไม่ได้ตราบใดที่ยังมีแถบสีแดง"
            caption="ข้อความในภาพเป็นตัวอย่างของสามสี — ตัวเลขเพดานและเวลาขั้นต่ำที่ขึ้นจริงมาจากค่าที่ฝ่ายบุคคลตั้งไว้ ไม่ได้อยู่ในคู่มือ"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-alert info">
                  <span className="mk-alert-t">วันที่เลือกเป็นวันเกิดของคุณ — เป็นวันหยุดของคุณทั้งวัน</span>
                </span>
                <span className="mk-alert">
                  <span className="mk-alert-t">เกินเพดาน ระบบจะส่งให้ HR พิจารณา</span>
                </span>
                <span className="mk-alert no">
                  <span className="mk-alert-t">กรุณาแก้เวลาให้ไม่ทับกัน หรือยกเลิก/แก้ไขใบเดิมก่อน — บันทึกซ้ำไม่ได้</span>
                </span>
                <span className="mk-headrow">
                  <MkNote>มีแถบแดงค้างอยู่ ปุ่มท้ายฟอร์มจะจางและกดไม่ได้</MkNote>
                  <span className="mk-acts"><MkBtn>ส่งขออนุมัติ</MkBtn></span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <span className="mk-alert info">
                  <span className="mk-alert-t">วันที่เลือกเป็นวันเกิดของคุณ</span>
                </span>
                <span className="mk-alert">
                  <span className="mk-alert-t">เกินเพดาน ระบบจะส่งให้ HR พิจารณา</span>
                </span>
                <span className="mk-alert no">
                  <span className="mk-alert-t">เวลาทับกับใบเดิม — บันทึกซ้ำไม่ได้</span>
                </span>
                <MkBtn>ส่งขออนุมัติ</MkBtn>
              </Phone>
            )}
          />
          <p className="hint">
            ปุ่ม <b>ส่งขออนุมัติ</b> ท้ายฟอร์มจะจางและกดไม่ได้ตราบใดที่ยังมีข้อที่ระบบไม่รับ ·
            ใบที่เปิดมาแก้ ปุ่มจะเป็น <b>บันทึกการแก้ไข</b> และใบที่กด ส่งใหม่ จะเป็น <b>ส่งคำขอใหม่</b>
          </p>
        </li>

        <li className="manual-step">
          <p>ช่องติ๊กที่<b>อาจขึ้นหรือไม่ขึ้น</b> ขึ้นกับตำแหน่งและวันที่</p>
          <ul>
            <li>
              <b>เหมารายวัน (นับ 8 ชม. ต่อวัน)</b> — ขึ้นเฉพาะบางตำแหน่งที่ฝ่ายบุคคลกำหนด
              ติ๊กแล้วระบบเติมเวลาให้ตามเวลางานปกติ แก้เวลาเริ่มเองได้ ส่วนเวลาสิ้นสุดระบบบวกตามให้เอง
              และช่องเวลาสิ้นสุดจะถูกปิดไว้
            </li>
            <li><b>ไม่พักเที่ยง</b> — ขึ้นเฉพาะวันที่ทั้งบริษัทหยุด (เสาร์-อาทิตย์ หรือวันหยุดตามประกาศ) ไม่ขึ้นในวันเกิดของตัวเอง</li>
            <li>ไม่มีช่องติ๊กวันเกิด — ระบบตอบเองจากวันที่ที่กรอกกับวันเกิดในทะเบียน · ช่องติ๊กข้ามคืนก็ไม่มี เพราะระบบไม่รับใบที่ข้ามคืนแล้ว</li>
          </ul>
          <Shot
            alt="ช่องติ๊กบนฟอร์ม เหมารายวัน และ ไม่พักเที่ยง ติ๊กเหมารายวันแล้วช่องเวลาสิ้นสุดถูกปิดไว้และมีคำว่าล็อกกำกับ สองช่องนี้ขึ้นเฉพาะบางตำแหน่งและบางวันเท่านั้น"
            caption="สองช่องนี้ไม่ได้ขึ้นทุกใบ — เหมารายวันขึ้นตามตำแหน่งที่ฝ่ายบุคคลกำหนด ไม่พักเที่ยงขึ้นเฉพาะวันที่ทั้งบริษัทหยุด"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-two">
                  <MkTick on>เหมารายวัน (นับ 8 ชม. ต่อวัน)</MkTick>
                  <MkTick>ไม่พักเที่ยง</MkTick>
                </span>
                <span className="mk-two">
                  <MkField label="เวลาเริ่ม (จาก)" on>แก้เองได้</MkField>
                  <MkField label="เวลาสิ้นสุด (ถึง)" pin="ล็อก">ระบบบวกให้เอง</MkField>
                </span>
                <MkNote>ติ๊กเหมารายวันแล้วเวลาสิ้นสุดระบบบวกให้เอง แก้เองไม่ได้</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkTick on>เหมารายวัน (นับ 8 ชม. ต่อวัน)</MkTick>
                <MkTick>ไม่พักเที่ยง</MkTick>
                <MkField label="เวลาสิ้นสุด (ถึง)" pin="ล็อก">ระบบบวกให้เอง</MkField>
              </Phone>
            )}
          />
        </li>
      </ol>
    ),
  },

  {
    key: 'flow',
    group: 'ใบของคุณเอง',
    icon: 'check',
    title: 'ใบของคุณเดินไปทางไหน',
    blurb: (p) => (p.firstStep.length
      ? 'ใบเดินสองขั้น และป้ายสถานะแต่ละอันแปลว่าอะไร'
      : 'ใบของบทบาทนี้ไปรอฝ่ายบุคคลตั้งแต่ยื่น'),
    gate: () => true,
    gateLabel: () => 'ทุกบทบาท · เส้นทางตรงกับบทบาทของคุณ',
    Body: ({ p }) => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            {p.firstStep.length ? (
              <>
                ใบที่ <b>{p.label}</b> ยื่น เดินสองขั้น — ผู้เซ็นขั้นแรกคือคนที่ถือแผนกนั้นอยู่
                แล้วจึงถึงฝ่ายบุคคลเป็นขั้นสุดท้าย
              </>
            ) : (
              <>
                ใบที่ <b>{p.label}</b> ยื่น <b>ไม่มีขั้นแรก</b> ไปรอฝ่ายบุคคลตั้งแต่ยื่น
                เพราะลายเซ็นที่จะเก็บก่อนคือของฝ่ายบุคคลเอง
              </>
            )}
          </p>
          <FlowDiagram p={p} />
        </li>

        <li className="manual-step">
          <p>อ่านป้ายสถานะบนแถวของใบ — มีห้าแบบ และเรียงตามลำดับที่ใบหนึ่งใบได้พบ</p>
          <div className="manual-table-wrap">
            <table className="manual-table">
              <tbody>
                {STATUS_ROWS.map(([label, tone, meaning]) => (
                  <tr key={label}>
                    <td className="nowrap"><MkChip tone={tone}>{label}</MkChip></td>
                    <td>{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Shot
            alt="ที่อยู่ของป้ายสถานะ บนคอมพิวเตอร์เป็นคอลัมน์สถานะท้ายแถวในตารางประวัติ บนมือถือป้ายเดียวกันอยู่บนการ์ดของใบ ใต้วันที่และเวลา"
            caption="วันที่และเวลาในภาพเป็นตัวอย่าง — ปุ่มที่ขึ้นท้ายแถวเปลี่ยนไปตามป้าย ไม่ใช่ทุกแถวมีปุ่มเหมือนกัน"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <MkCols>วันที่ · เวลา · ปกติ · วันหยุด · รวม · สถานะ</MkCols>
                <span className="mk-headrow">
                  <MkRow>10/09/2569 · 21:00–02:00</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="wait">รอหัวหน้า</MkChip>
                    <MkBtn ghost>แก้ไข</MkBtn>
                  </span>
                </span>
                <span className="mk-headrow">
                  <MkRow>05/09/2569 · 18:00–20:00</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="ok">อนุมัติ</MkChip>
                    <MkBtn ghost>ขอถอนใบ</MkBtn>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkRow badge="›">10/09/2569 · 21:00–02:00</MkRow>
                <span className="mk-acts"><MkChip tone="wait">รอหัวหน้า</MkChip></span>
                <MkRow badge="›">05/09/2569 · 18:00–20:00</MkRow>
                <span className="mk-acts"><MkChip tone="ok">อนุมัติ</MkChip></span>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>กติกาที่ใช้กับทุกบทบาท ไม่มีข้อยกเว้น</p>
          <ul>
            <li><b>ไม่มีใครเซ็นใบของตัวเองได้</b> ไม่ว่าบทบาทใด</li>
            <li><b>หัวหน้างานกับการเงินอยู่ระดับเดียวกันแต่คนละโต๊ะ</b> — เซ็นใบของกันและกันไม่ได้</li>
            <li>ตำแหน่งที่สูงกว่า<b>เห็น</b>ใบของทุกชั้นที่อยู่ใต้บังคับบัญชา แต่คนที่<b>เซ็น</b>คือชั้นถัดไปชั้นเดียว</li>
          </ul>
          {/* A rule about WHO, which is a fact about the system and not about a
              screen — so one drawing, not two. Same reason FlowDiagram takes no
              device: a picture of this per device would say there are two. */}
          <Diagram
            alt="กติกาการเซ็น ใบของคุณเซ็นเองไม่ได้ คนที่เซ็นคือชั้นถัดไปหนึ่งชั้น ส่วนตำแหน่งที่สูงกว่านั้นเห็นใบแต่ไม่ใช่ผู้เซ็นของใบนี้"
            caption="หัวหน้างานกับการเงินอยู่คนละกล่องที่ความสูงเดียวกัน — ต่างคนต่างถือแผนกของตัวเอง จึงเซ็นใบของกันและกันไม่ได้"
          >
            <div className="mflow">
              <div className="mflow-node acc">
                <span className="mflow-k">ใบของคุณ</span>
                <span className="mflow-n">คุณเซ็นเองไม่ได้</span>
                <span className="mflow-s">ไม่ว่าบทบาทใด</span>
              </div>
              <span className="mflow-arrow" aria-hidden="true">→</span>
              <div className="mflow-node">
                <span className="mflow-k">ผู้เซ็น</span>
                <span className="mflow-n">ชั้นถัดไปหนึ่งชั้น</span>
                <span className="mflow-s">คนที่ถือแผนกนั้นอยู่</span>
              </div>
              <span className="mflow-arrow" aria-hidden="true">→</span>
              <div className="mflow-node gone">
                <span className="mflow-k">เหนือขึ้นไป</span>
                <span className="mflow-n">เห็น แต่ไม่ใช่ผู้เซ็น</span>
                <span className="mflow-s">เห็นใบของทุกชั้นที่อยู่ใต้บังคับบัญชา</span>
              </div>
            </div>
          </Diagram>
        </li>
      </ol>
    ),
  },

  {
    key: 'fix',
    group: 'ใบของคุณเอง',
    icon: 'trash',
    title: 'ยื่นผิดแล้วทำอย่างไร',
    blurb: () => 'แก้ ยกเลิก หรือขอถอน — ขึ้นอยู่กับว่ามีใครเซ็นไปแล้วหรือยัง',
    gate: (p) => p.submit,
    gateLabel: () => 'ทุกบทบาทที่ยื่น OT ได้',
    Body: () => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>ดู<b>สถานะของใบ</b>ก่อน แล้วค่อยเลือกทาง — สามทาง ไม่ใช่สามทางเลือก</p>
          <div className="manual-table-wrap">
            <table className="manual-table">
              <tbody>
                <tr>
                  <td className="nowrap"><MkChip tone="wait">รอหัวหน้า</MkChip></td>
                  <td><b>ยังไม่มีใครเซ็น</b> — แก้เองได้ ยกเลิกเองได้ ไม่ต้องขอใคร</td>
                </tr>
                <tr>
                  <td className="nowrap"><MkChip tone="ok">เซ็นไปแล้ว</MkChip></td>
                  <td>กด <b>ขอถอนใบ</b> — ต้องกรอกเหตุผล และต้องได้รับอนุมัติ ถอนผ่านแล้วใบกลายเป็น ยกเลิก จึงยื่นใหม่ได้ · ระหว่างรอ แถวจะขึ้นว่า ขอถอนใบแล้ว · รอพิจารณา</td>
                </tr>
                <tr>
                  <td className="nowrap"><MkChip tone="no">ไม่อนุมัติ</MkChip></td>
                  <td>กด <b>ส่งใหม่</b> — ใบเดิมแก้ไม่ได้ ระบบเปิดใบใหม่ให้โดยเก็บสายของเดิมไว้ · ใบหนึ่งใบกด ส่งใหม่ ได้ <b>1 ครั้ง</b> ใช้ไปแล้วปุ่มจะเปลี่ยนเป็น ส่งใหม่แล้ว</td>
                </tr>
              </tbody>
            </table>
          </div>
          <Shot
            alt="สามแถวที่สถานะต่างกันในตารางประวัติ แถวรอหัวหน้ามีปุ่มแก้ไขและยกเลิก แถวอนุมัติมีปุ่มขอถอนใบ แถวไม่อนุมัติมีปุ่มส่งใหม่ บนมือถือปุ่มเหล่านี้อยู่ในแผ่นรายละเอียดที่เปิดจากแถว"
            caption="ปุ่มที่ขึ้นคือทางที่เหลืออยู่จริงของแถวนั้น — ไม่ได้เลือกได้ทั้งสามทางพร้อมกัน"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>10/09/2569 · 21:00–02:00</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="wait">รอหัวหน้า</MkChip>
                    <MkBtn ghost>แก้ไข</MkBtn>
                    <MkBtn ghost>ยกเลิก</MkBtn>
                  </span>
                </span>
                <span className="mk-headrow">
                  <MkRow>05/09/2569 · 18:00–20:00</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="ok">อนุมัติ</MkChip>
                    <MkBtn ghost>ขอถอนใบ</MkBtn>
                  </span>
                </span>
                <span className="mk-headrow">
                  <MkRow>02/09/2569 · 19:00–21:00</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="no">ไม่อนุมัติ</MkChip>
                    <MkBtn ghost>ส่งใหม่</MkBtn>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />} fab>
                <MkRow badge="›">10/09/2569 · รอหัวหน้า</MkRow>
                <MkRow badge="›">05/09/2569 · อนุมัติ</MkRow>
                <MkRow badge="›">02/09/2569 · ไม่อนุมัติ</MkRow>
                <MkNote>กดที่แถว → ปุ่มของแถวนั้นอยู่ท้ายแผ่นรายละเอียด</MkNote>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            ปุ่มพวกนี้อยู่สองที่ — บน<b>ตารางประวัติทั้งหมด</b>ปุ่มอยู่ท้ายแถว
            ส่วนในรายการล่าสุดและบนมือถือ ให้<b>กดที่แถว</b>แล้วปุ่มจะอยู่ท้ายแผ่นรายละเอียดที่เปิดขึ้นมา
          </p>
          <Shot
            alt="ปุ่มจัดการใบ บนคอมพิวเตอร์ในตารางประวัติทั้งหมดปุ่มอยู่ท้ายแถว บนมือถือกดที่แถวแล้วปุ่มอยู่ในแผ่นรายละเอียดที่เปิดขึ้นมา"
            caption="ชื่อปุ่มในแผ่นรายละเอียดยาวกว่าบนแถวเล็กน้อย — ยกเลิกคำขอ และ ยื่นขอถอนใบ OT คือปุ่มเดียวกับ ยกเลิก และ ขอถอนใบ ท้ายแถว"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>10/09/2569 · 21:00–02:00</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="wait">รอหัวหน้า</MkChip>
                    <MkBtn ghost>แก้ไข</MkBtn>
                    <MkBtn ghost>ยกเลิก</MkBtn>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkRow badge="›">10/09/2569 · 21:00–02:00</MkRow>
                <MkNote>กดที่แถว → เปิดแผ่นรายละเอียด ปุ่มอยู่ท้ายแผ่น</MkNote>
                <span className="mk-sheet">
                  <MkBtn ghost>ปิดหน้าต่าง</MkBtn>
                  <MkBtn ghost>ยกเลิกคำขอ</MkBtn>
                  <MkBtn>แก้ไข</MkBtn>
                </span>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>สองปุ่มนี้ถามไม่เหมือนกัน และถามคนละแบบ</p>
          <ul>
            <li><b>ยกเลิก</b> — ช่อง <b>เหตุผลที่ยกเลิก</b> ไม่บังคับ กรอกแล้วจะถูกเก็บไว้ในประวัติรายการ · ยกเลิกแล้ว<b>แก้กลับไม่ได้</b> แถวยังอยู่ในตารางโดยขึ้นสถานะ ยกเลิก ไม่ได้ถูกลบทิ้ง</li>
            <li><b>ขอถอนใบ</b> — ช่อง <b>เหตุผลที่ขอถอน</b> <b>บังคับกรอก</b> ผู้พิจารณาจะเห็นข้อความนี้ · นี่คือคำขอ ไม่ใช่การยกเลิก ใบยังมีสถานะเดิมจนกว่าจะมีคนตอบ</li>
          </ul>
          <Shot
            alt="กล่องยืนยันสองกล่อง กล่องยกเลิกคำขอนี้มีช่องเหตุผลที่ยกเลิกซึ่งไม่บังคับ กล่องขอถอนใบที่อนุมัติแล้วมีช่องเหตุผลที่ขอถอนซึ่งจำเป็นต้องกรอก บนคอมพิวเตอร์เป็นกล่องกลางจอ บนมือถือเป็นแผ่นเลื่อนขึ้นจากขอบล่าง"
            caption="ต่างกันที่บรรทัดใต้ช่อง — ไม่บังคับ กับ จำเป็นต้องกรอก · และต่างกันที่ผลลัพธ์ กล่องซ้ายจบเรื่องทันที กล่องขวาเป็นคำขอที่ต้องมีคนตอบ"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-two">
                  <span className="mk-dlg">
                    <span className="mk-dlg-h">ยกเลิกคำขอนี้</span>
                    <MkField label="เหตุผลที่ยกเลิก">เช่น หัวหน้าให้เลื่อนงานไปวันอื่น</MkField>
                    <MkNote>ไม่บังคับ — ถ้ากรอก จะบันทึกไว้ในประวัติรายการ</MkNote>
                    <span className="mk-acts">
                      <MkBtn ghost>ไม่ยกเลิกแล้ว</MkBtn>
                      <MkBtn>ยืนยันการยกเลิก</MkBtn>
                    </span>
                  </span>
                  <span className="mk-dlg">
                    <span className="mk-dlg-h">ขอถอนใบที่อนุมัติแล้ว</span>
                    <MkField label="เหตุผลที่ขอถอน" on>เช่น งานถูกยกเลิกกะทันหัน</MkField>
                    <MkNote>จำเป็นต้องกรอก — ผู้พิจารณาจะเห็นข้อความนี้</MkNote>
                    <span className="mk-acts">
                      <MkBtn ghost>ปิด</MkBtn>
                      <MkBtn>ส่งคำขอถอนใบ</MkBtn>
                    </span>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">ยกเลิกคำขอนี้</span>
                  <MkField label="เหตุผลที่ยกเลิก">ไม่บังคับ</MkField>
                  <MkBtn>ยืนยันการยกเลิก</MkBtn>
                </span>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">ขอถอนใบที่อนุมัติแล้ว</span>
                  <MkField label="เหตุผลที่ขอถอน" on>จำเป็นต้องกรอก</MkField>
                  <MkBtn>ส่งคำขอถอนใบ</MkBtn>
                </span>
                <MkNote>ทั้งสองกล่องบนมือถือเลื่อนขึ้นมาจากขอบล่างจอ</MkNote>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            ทุกการแก้และทุกคำขอถอน<b>ขึ้นในประวัติของใบ</b> พร้อมชื่อคนทำและเวลา
            และเก็บข้อมูลเดิมก่อนการแก้แต่ละครั้งไว้ด้วย — อ่านได้สองที่
          </p>
          <ul>
            <li>
              บน<b>ตารางประวัติทั้งหมด</b> ปุ่ม <b>ข้อมูลเดิม</b> ท้ายแถวจะกางแถวออกมาใต้แถวนั้น
              หัวข้อ <b>ประวัติการแก้ไข</b> · ปุ่มนี้ขึ้นเฉพาะแถวที่มีของเก่าให้ดูจริง
            </li>
            <li>ใน<b>แผ่นรายละเอียด</b>ของใบ หัวข้อ <b>ประวัติรายการ</b> ซึ่งเป็นทั้งสายตั้งแต่ยื่น ไม่ใช่เฉพาะส่วนที่ถูกแก้</li>
          </ul>
          <Shot
            alt="ประวัติของใบสองที่ บนคอมพิวเตอร์กดปุ่มข้อมูลเดิมท้ายแถวแล้วแถวประวัติการแก้ไขกางออกใต้แถวนั้น บนมือถือกดที่แถวแล้วหัวข้อประวัติรายการอยู่ในแผ่นรายละเอียด"
            caption="ทั้งสองที่เก็บของอย่างเดียวกัน — ต่างกันที่ปุ่มท้ายแถวตอบว่า ของเดิมคืออะไร ส่วนแผ่นรายละเอียดตอบว่า ใบนี้ผ่านมือใครมาบ้าง"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>10/09/2569 · 21:00–02:00</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="wait">รอหัวหน้า</MkChip>
                    <MkBtn ghost>ข้อมูลเดิม</MkBtn>
                  </span>
                </span>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">ประวัติการแก้ไข</span>
                  <MkNote>แถวด้านบนคือข้อมูลล่าสุดที่พิมพ์ลงใบ F-HR-027 · ด้านล่างคือข้อมูลเดิมก่อนการแก้แต่ละครั้ง</MkNote>
                  <MkRow>แก้เวลาสิ้นสุด · โดยฝ่ายบุคคล · 11/09/2569 09:14</MkRow>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkRow badge="›">10/09/2569 · 21:00–02:00</MkRow>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">ประวัติรายการ</span>
                  <MkRow>ยื่นคำขอ · 10/09/2569 17:02</MkRow>
                  <MkRow>หัวหน้างานอนุมัติ · 10/09/2569 18:31</MkRow>
                </span>
              </Phone>
            )}
          />
        </li>
      </ol>
    ),
  },

  {
    key: 'print',
    group: 'ใบของคุณเอง',
    icon: 'document',
    title: 'พิมพ์ใบ F-HR-027 ของตัวเอง',
    blurb: () => 'พิมพ์ได้ตั้งแต่ยื่น ช่องลงชื่อขึ้นเมื่ออนุมัติ',
    gate: (p) => p.submit,
    gateLabel: () => 'ทุกบทบาทที่ยื่น OT ได้',
    Body: () => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            เปิดเมนู <b>พิมพ์ใบขออนุมัติ OT</b> แล้วเลือกเดือนที่ช่อง <b>ประจำเดือน · PERIOD</b>
            {' '}— ใบจะรวมรายการที่อนุมัติแล้วและที่ยังรออนุมัติของเดือนนั้นให้เอง
            หน้านี้<b>ไม่ได้ใช้ยื่นใบ</b> เป็นที่พิมพ์ใบที่ยื่นไปแล้วเท่านั้น การยื่นอยู่ที่ บันทึกและประวัติ OT
          </p>
          <Shot
            alt="หน้าพิมพ์ใบ F-HR-027 มีปุ่มพิมพ์และปุ่มบันทึกเป็น PDF เหนือกระดาษ บนคอมพิวเตอร์เห็นทั้งแผ่น บนมือถือแผ่นกว้างกว่าจอจึงปัดซ้ายขวาได้"
            caption="แผ่นเดียวกัน — บนมือถือกระดาษกว้างกว่าจอ จึงปัดซ้าย-ขวาได้ และมีคำใบ้บอกไว้ใต้แผ่น"
            desk={(
              <Desk title="พิมพ์ใบขออนุมัติ OT" nav={<MkRow on>พิมพ์ใบขออนุมัติ OT</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>ใบขออนุมัติทำงานล่วงเวลา · กันยายน 2569</MkRow>
                  <MkField label="ประจำเดือน · PERIOD">กันยายน 2569</MkField>
                </span>
                <span className="mk-acts">
                  <MkBtn>พิมพ์</MkBtn>
                  <MkBtn>บันทึกเป็น PDF</MkBtn>
                </span>
                <span className="mk-paper">
                  <span className="mk-paper-h">ใบขออนุมัติทำงานล่วงเวลา · F-HR-027</span>
                  <MkCols>วันที่ · เวลาทำ OT · จำนวนชั่วโมง 3 ช่อง · รายละเอียดงานที่ทำ · ลงชื่อพนักงาน · ลงชื่อหัวหน้างาน</MkCols>
                  <span className="mk-two">
                    <span className="mk-sign">เฉพาะฝ่ายบุคคล</span>
                    <span className="mk-sign">ฝ่ายบุคคล · ผู้ตรวจสอบ</span>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="พิมพ์ใบขออนุมัติ OT" bar={<MkSlot icon="document" label="พิมพ์ใบ OT" on />}>
                <MkField label="ประจำเดือน · PERIOD">กันยายน 2569</MkField>
                <span className="mk-acts">
                  <MkBtn>พิมพ์</MkBtn>
                  <MkBtn>บันทึกเป็น PDF</MkBtn>
                </span>
                <span className="mk-paper narrow">
                  <span className="mk-paper-h">F-HR-027</span>
                  <MkCols>วันที่ · เวลาทำ OT · จำนวนชั่วโมง · ลงชื่อ</MkCols>
                </span>
                <MkNote>← ปัดซ้าย-ขวาเพื่อดูทั้งใบ →</MkNote>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>สองปุ่มเหนือกระดาษทำคนละอย่าง และบรรทัดใต้ปุ่มบอกวิธีตั้งหน้ากระดาษไว้แล้ว</p>
          <ul>
            <li><b>พิมพ์</b> — เปิดกล่องพิมพ์ของเบราว์เซอร์ (เลือกบันทึกเป็น PDF ในนั้นได้)</li>
            <li><b>บันทึกเป็น PDF</b> — ได้ไฟล์ทันที ไม่ต้องผ่านกล่องพิมพ์</li>
            <li>ตั้งค่าพิมพ์เป็น <b>A4 แนวตั้ง</b> ขอบกระดาษ “เริ่มต้น” · และ<b>ติ๊กเปิด “กราฟิกพื้นหลัง”</b> เพื่อให้แถบสีเหลืองบนใบติดไปด้วย</li>
          </ul>
          <Shot
            alt="แถบปุ่มเหนือกระดาษ ปุ่มพิมพ์และปุ่มบันทึกเป็น PDF พร้อมบรรทัดวิธีตั้งหน้ากระดาษใต้ปุ่ม บนมือถือปุ่มสองปุ่มเรียงเต็มความกว้างและบรรทัดวิธีตั้งอยู่ใต้ลงมา"
            caption="บรรทัดใต้ปุ่มเป็นของหน้าพิมพ์เอง ไม่ต้องจำ — หน้าที่พิมพ์ได้ทุกหน้าในระบบมีแถบเดียวกันนี้"
            desk={(
              <Desk title="พิมพ์ใบขออนุมัติ OT" nav={<MkRow on>พิมพ์ใบขออนุมัติ OT</MkRow>}>
                <span className="mk-acts">
                  <MkBtn>พิมพ์</MkBtn>
                  <MkBtn>บันทึกเป็น PDF</MkBtn>
                </span>
                <MkNote>ตั้งค่าพิมพ์ · A4 แนวตั้ง | ขอบกระดาษ “เริ่มต้น” (ไม่ต้องปรับขนาด)</MkNote>
                <MkNote>ตัวเลือกเพิ่มเติม · ติ๊กเปิด “กราฟิกพื้นหลัง” เพื่อให้แถบสีเหลืองติดมาด้วย</MkNote>
                <MkNote>สองปุ่มต่างกันตรงนี้ · พิมพ์ = เปิดกล่องพิมพ์ของเบราว์เซอร์ · บันทึกเป็น PDF = ได้ไฟล์ทันที</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="พิมพ์ใบขออนุมัติ OT" bar={<MkSlot icon="document" label="พิมพ์ใบ OT" on />}>
                <MkBtn>พิมพ์</MkBtn>
                <MkBtn>บันทึกเป็น PDF</MkBtn>
                <MkNote>ตั้งค่าพิมพ์ · A4 แนวตั้ง | ขอบกระดาษ “เริ่มต้น”</MkNote>
                <MkNote>ติ๊กเปิด “กราฟิกพื้นหลัง” เพื่อให้แถบสีเหลืองติดมาด้วย</MkNote>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            <b>ยังไม่อนุมัติก็พิมพ์ได้</b> — แถวที่ยังไม่ผ่านฝ่ายบุคคลจะมีคำว่า <b>(รออนุมัติ)</b>
            {' '}ต่อท้ายช่องรายละเอียดงาน และมีข้อความบอกไว้เหนือกระดาษด้วยว่ามีกี่รายการ วันไหนบ้าง
          </p>
          <ul>
            <li><b>ลงชื่อพนักงาน</b> และ <b>ลงชื่อหัวหน้างาน</b> เป็นสองคอลัมน์ท้ายตาราง ขั้นที่อนุมัติผ่านแล้วระบบพิมพ์ชื่อผู้เซ็นลงไปให้เอง</li>
            <li>ช่อง <b>เฉพาะฝ่ายบุคคล</b> ท้ายใบเป็นของฝ่ายบุคคล กรอกและเซ็นด้วยมือตามเดิม</li>
          </ul>
          <Shot
            alt="ใบที่ยังมีรายการรออนุมัติ เหนือกระดาษมีแถบบอกจำนวนรายการที่ยังไม่อนุมัติ และในช่องรายละเอียดงานของแถวนั้นมีคำว่า วงเล็บรออนุมัติ ต่อท้าย ท้ายตารางเป็นสองคอลัมน์ลงชื่อ พนักงาน และ หัวหน้างาน"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — ขั้นที่อนุมัติผ่านแล้วระบบพิมพ์ชื่อผู้เซ็นลงช่องให้เอง ส่วนช่องเฉพาะฝ่ายบุคคลยังเซ็นด้วยมือ"
            desk={(
              <Desk title="พิมพ์ใบขออนุมัติ OT" nav={<MkRow on>พิมพ์ใบขออนุมัติ OT</MkRow>}>
                <span className="mk-alert">
                  <span className="mk-alert-t">ใบนี้มี 2 รายการที่ยังไม่อนุมัติ และถูกนับรวมใน สรุปรวม แล้ว</span>
                </span>
                <span className="mk-paper">
                  <span className="mk-paper-h">ใบขออนุมัติทำงานล่วงเวลา · F-HR-027</span>
                  <MkCols>วันที่ · เวลาทำ OT · จำนวนชั่วโมง · รายละเอียดงานที่ทำ</MkCols>
                  <MkRow>10/09/2569 · ซ่อมเครื่องจักรสายผลิต (รออนุมัติ)</MkRow>
                  <span className="mk-two">
                    <span className="mk-sign">ลงชื่อ · พนักงาน</span>
                    <span className="mk-sign">ลงชื่อ · หัวหน้างาน</span>
                  </span>
                  <span className="mk-sign">เฉพาะฝ่ายบุคคล</span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="พิมพ์ใบขออนุมัติ OT" bar={<MkSlot icon="document" label="พิมพ์ใบ OT" on />}>
                <span className="mk-alert">
                  <span className="mk-alert-t">ใบนี้มี 2 รายการที่ยังไม่อนุมัติ</span>
                </span>
                <span className="mk-paper narrow">
                  <MkRow>10/09/2569 · ซ่อมเครื่องจักร (รออนุมัติ)</MkRow>
                  <span className="mk-two">
                    <span className="mk-sign">ลงชื่อ · พนักงาน</span>
                    <span className="mk-sign">ลงชื่อ · หัวหน้างาน</span>
                  </span>
                </span>
                <MkNote>← ปัดซ้าย-ขวาเพื่อดูทั้งใบ →</MkNote>
              </Phone>
            )}
          />
          <p className="hint">กระดาษที่เซ็นแล้วยังเป็นตัวจริงของเรื่องนี้ ระบบไม่ได้มาแทนแฟ้ม</p>
        </li>
      </ol>
    ),
  },

  {
    key: 'approve',
    group: 'งานอนุมัติ',
    icon: 'inbox',
    title: 'อนุมัติใบของทีม',
    blurb: () => 'คิวรออนุมัติ — เปิด อ่าน แล้วตัดสิน',
    gate: (p) => p.sign,
    gateLabel: () => 'คุณเห็นหัวข้อนี้เพราะคุณเซ็นขั้นแรกให้แผนกหนึ่ง',
    Body: ({ p }) => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            เปิด <b>รายการรออนุมัติ</b> ตัวเลขบนปุ่มคือจำนวนใบที่รอคุณ
            เห็นเฉพาะแผนกที่คุณถืออยู่ รวมแผนกที่ถูกติ๊กเพิ่มให้คุณ
          </p>
          <ul>
            <li>ใบที่คุณรับช่วงมาจากคนอื่นจะติดป้าย <b>รับช่วง</b> ไว้บนแถว และมีแถบบอกไว้เหนือคิวว่ากำลังรับช่วงของใครถึงวันไหน</li>
            <li>ถ้ามีคนขอถอนใบที่เซ็นไปแล้ว การ์ด <b>คำขอถอนใบที่อนุมัติแล้ว</b> จะขึ้นเหนือคิว พร้อมปุ่ม <b>อนุมัติให้ถอน</b> และ <b>ไม่อนุมัติการถอน</b></li>
            <li>ปุ่ม <b>+ บันทึก OT แทนพนักงาน</b> อยู่มุมขวาบนของการ์ดคิวนี้ — ดูหัวข้อถัดไป</li>
          </ul>
          <Shot
            alt="หัวการ์ดคิวรออนุมัติ มีจำนวนรายการและปุ่มบันทึก OT แทนพนักงานอยู่มุมขวาบน เหนือการ์ดมีแถบบอกว่ากำลังรับช่วงคิวของใครถึงวันไหน และการ์ดคำขอถอนใบที่อนุมัติแล้วพร้อมปุ่มสองปุ่ม"
            caption="ตัวเลขและชื่อในภาพเป็นตัวอย่าง — แถบรับช่วงและการ์ดคำขอถอนขึ้นเฉพาะเมื่อมีเรื่องนั้นอยู่จริง ไม่ได้อยู่ประจำ"
            desk={(
              <Desk title="รายการรออนุมัติ" nav={<MkRow on badge="3">รายการรออนุมัติ</MkRow>}>
                <span className="mk-alert">
                  <span className="mk-alert-t">คุณกำลังรับช่วงอนุมัติแทน วิภา สุขใจ ถึง 17/09/2569</span>
                </span>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">คำขอถอนใบที่อนุมัติแล้ว (1 รายการ)</span>
                  <MkNote>รายการเหล่านี้ยังมีผลและยังถูกนับอยู่ จนกว่าจะอนุมัติให้ถอน</MkNote>
                  <span className="mk-acts">
                    <MkBtn ghost>ไม่อนุมัติการถอน</MkBtn>
                    <MkBtn>อนุมัติให้ถอน</MkBtn>
                  </span>
                </span>
                <span className="mk-headrow">
                  <MkRow>รออนุมัติ</MkRow>
                  <span className="mk-acts">
                    <MkChip>3 รายการ</MkChip>
                    <MkBtn ghost>+ บันทึก OT แทนพนักงาน</MkBtn>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="รายการรออนุมัติ" bar={<MkSlot icon="inbox" label="รออนุมัติ" on badge="3" />}>
                <span className="mk-alert">
                  <span className="mk-alert-t">คุณกำลังรับช่วงอนุมัติแทน วิภา สุขใจ</span>
                </span>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">คำขอถอนใบที่อนุมัติแล้ว (1 รายการ)</span>
                  <MkBtn>อนุมัติให้ถอน</MkBtn>
                </span>
                <MkRow>รออนุมัติ · 3 รายการ</MkRow>
                <MkBtn ghost>+ บันทึก OT แทนพนักงาน</MkBtn>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            แถวหนึ่งแถวคือใบหนึ่งใบ — ชื่อ วันที่ เวลา ชั่วโมงแยกสามช่องอัตราและยอดรวม
            {' '}ช่อง <b>สะสม / เพดาน</b> ของคนนั้นในเดือนนั้น และ <b>รายละเอียด</b>งานที่ทำ
            {' '}· <b>กดที่แถว</b>เพื่อเปิดแผ่นรายละเอียดทั้งใบ รวมประวัติของใบ
          </p>
          <Shot
            alt="แถวในคิวรออนุมัติ บนคอมพิวเตอร์เป็นตารางกว้าง ปุ่มอนุมัติและไม่อนุมัติย่อเหลือไอคอนถูกกับผิดท้ายแถว บนมือถือแถวกลายเป็นการ์ดและปุ่มมีคำกำกับเต็ม"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — บนคอมพิวเตอร์ปุ่มสองปุ่มย่อเหลือไอคอนเพื่อไม่ให้ตารางต้องเลื่อนซ้ายขวา บนมือถือแถวเป็นการ์ดและปุ่มกลับมามีคำ"
            desk={(
              <Desk title="รายการรออนุมัติ" nav={<MkRow on badge="3">รายการรออนุมัติ</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>รออนุมัติ</MkRow>
                  <span className="mk-acts">
                    <MkChip>3 รายการ</MkChip>
                    <MkBtn ghost>+ บันทึก OT แทนพนักงาน</MkBtn>
                  </span>
                </span>
                <MkCols>พนักงาน · วันที่ · เวลา · ×1.5 ปกติ · ×1.5 วันหยุด · ×3 วันหยุด · รวม · สะสม / เพดาน · รายละเอียด</MkCols>
                <span className="mk-headrow">
                  <MkTick>สมชาย ใจดี · PM-0620 · 21:00–02:00</MkTick>
                  <span className="mk-acts">
                    <span className="mk-cell"><span className="mk-cell-k">สะสม / เพดาน</span><span className="mk-cell-v">28 / 36</span></span>
                    <MkIconBtn icon="tick" tone="ok" />
                    <MkIconBtn icon="cross" tone="no" />
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="รายการรออนุมัติ" bar={<MkSlot icon="inbox" label="รออนุมัติ" on badge="3" />}>
                <MkTick>สมชาย ใจดี · PM-0620</MkTick>
                <MkRow badge="›">10/09/2569 · 21:00–02:00 · รวม 4.5 ชม.</MkRow>
                <span className="mk-acts">
                  <MkIconBtn icon="tick" tone="ok">อนุมัติ</MkIconBtn>
                  <MkIconBtn icon="cross" tone="no">ไม่อนุมัติ</MkIconBtn>
                </span>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>ตัดสินได้<b>ทีละใบ หรือทีละหลายใบ</b></p>
          <ul>
            <li><b>ทีละใบ</b> — กดปุ่มถูกเพื่ออนุมัติ หรือปุ่มกากบาทเพื่อไม่อนุมัติ ที่ท้ายแถวนั้น</li>
            <li><b>ทีละหลายใบ</b> — ติ๊กช่องหน้าแถว (หรือ <b>เลือกทั้งหมด</b> ที่หัวตาราง) แล้วใช้แถบที่ขึ้นมา · บนมือถือแถบนี้ยึดอยู่เหนือแถบเมนูล่าง</li>
            <li><b>ไม่อนุมัติต้องใส่เหตุผล</b> เหตุผลนั้นไปขึ้นบนใบที่ผู้ยื่นเห็น ผู้ยื่นแก้ใบที่ถูกปฏิเสธไม่ได้ ต้องกด ส่งใหม่ — เหตุผลจึงเป็นสิ่งเดียวที่บอกเขาว่าต้องแก้อะไร</li>
          </ul>
          <Shot
            alt="การอนุมัติทีละหลายใบ ติ๊กหน้าแถวแล้วแถบสรุปขึ้นมาบอกว่าเลือกไว้กี่รายการรวมกี่ชั่วโมง พร้อมปุ่มอนุมัติทั้งหมดที่เลือกและไม่อนุมัติทั้งหมดที่เลือก และกล่องเหตุผลที่ไม่อนุมัติซึ่งบังคับกรอก"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — บนมือถือแถบนี้ยึดอยู่เหนือแถบเมนูล่าง ไม่เลื่อนหายไปกับรายการ"
            desk={(
              <Desk title="รายการรออนุมัติ" nav={<MkRow on badge="3">รายการรออนุมัติ</MkRow>}>
                <MkTick>เลือกทั้งหมด</MkTick>
                <MkTick on>สมชาย ใจดี · 10/09/2569</MkTick>
                <MkTick on>ปรีชา ตั้งใจ · 10/09/2569</MkTick>
                <span className="mk-headrow">
                  <MkRow>เลือกไว้ 2 รายการ · รวม 7.5 ชม.</MkRow>
                  <span className="mk-acts">
                    <MkBtn>✓ อนุมัติทั้งหมดที่เลือก (2 รายการ)</MkBtn>
                    <MkBtn ghost>✕ ไม่อนุมัติทั้งหมดที่เลือก (2 รายการ)</MkBtn>
                  </span>
                </span>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">ไม่อนุมัติรายการนี้</span>
                  <MkField label="เหตุผลที่ไม่อนุมัติ *" on>เช่น เวลาที่ขอไม่ตรงกับเวลาสแกนนิ้ว</MkField>
                  <MkNote>ต้องกรอกเหตุผลก่อนจึงจะไม่อนุมัติได้ · พนักงานจะเห็นข้อความนี้</MkNote>
                  <MkBtn>ยืนยันไม่อนุมัติ</MkBtn>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="รายการรออนุมัติ" bar={<MkSlot icon="inbox" label="รออนุมัติ" on badge="3" />}>
                <MkTick on>สมชาย ใจดี · 10/09/2569</MkTick>
                <MkTick on>ปรีชา ตั้งใจ · 10/09/2569</MkTick>
                <span className="mk-sheet">
                  <MkRow>เลือกไว้ 2 รายการ · รวม 7.5 ชม.</MkRow>
                  <MkBtn>✓ อนุมัติทั้งหมดที่เลือก (2 รายการ)</MkBtn>
                  <MkBtn ghost>✕ ไม่อนุมัติทั้งหมดที่เลือก (2 รายการ)</MkBtn>
                </span>
                <MkNote>แถบนี้ยึดอยู่เหนือแถบเมนูล่างจนกว่าจะยกเลิกการเลือก</MkNote>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>สิ่งที่คุณ<b>ทำไม่ได้</b>ในคิวนี้</p>
          <ul>
            <li>เซ็นใบของตัวเอง</li>
            {p.role === 'finance' ? (
              <li>เซ็นใบของหัวหน้างาน — คุณกับหัวหน้างานอยู่ระดับเดียวกันคนละโต๊ะ</li>
            ) : null}
            <li>แก้ตัวเลขในใบ — ถ้าเลขผิดให้ไม่อนุมัติพร้อมเหตุผล หรือแจ้งฝ่ายบุคคลแก้ให้</li>
          </ul>
          <Shot
            alt="แถวที่คุณกดปุ่มไม่ได้ แถวที่คุณเป็นผู้บันทึกเองขึ้นข้อความว่าต้องให้คนอื่นเป็นผู้อนุมัติ และแถวที่ไม่ใช่ใบที่คุณเซ็นขึ้นข้อความว่าดูได้อย่างเดียว ทั้งสองแถวไม่มีปุ่มถูกและกากบาทท้ายแถว"
            caption="แถวแบบนี้ยังอยู่ในคิวและเปิดอ่านได้ — สิ่งที่หายไปคือปุ่ม ไม่ใช่ทั้งแถว"
            desk={(
              <Desk title="รายการรออนุมัติ" nav={<MkRow on badge="3">รายการรออนุมัติ</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>สมชาย ใจดี · 10/09/2569</MkRow>
                  <span className="mk-acts">
                    <MkIconBtn icon="tick" tone="ok" />
                    <MkIconBtn icon="cross" tone="no" />
                  </span>
                </span>
                <MkRow>ใบที่คุณคีย์เอง · 10/09/2569</MkRow>
                <MkNote>คุณเป็นผู้บันทึกรายการนี้ — ต้องให้คนอื่นเป็นผู้อนุมัติ</MkNote>
                <MkRow>ใบของแผนกอื่น · 09/09/2569</MkRow>
                <MkNote>ไม่ใช่ใบที่คุณเซ็น — ดูได้อย่างเดียว</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="รายการรออนุมัติ" bar={<MkSlot icon="inbox" label="รออนุมัติ" on badge="3" />}>
                <MkRow badge="›">ใบที่คุณคีย์เอง · 10/09/2569</MkRow>
                <MkNote>คุณเป็นผู้บันทึกรายการนี้ — ต้องให้คนอื่นเป็นผู้อนุมัติ</MkNote>
                <MkRow badge="›">ใบของแผนกอื่น · 09/09/2569</MkRow>
                <MkNote>ไม่ใช่ใบที่คุณเซ็น — ดูได้อย่างเดียว</MkNote>
              </Phone>
            )}
          />
        </li>
      </ol>
    ),
  },

  {
    key: 'proxy',
    group: 'งานอนุมัติ',
    icon: 'users',
    title: 'บันทึก OT แทนคนอื่น',
    blurb: () => 'บันทึกแทนลูกทีมที่เข้าระบบไม่ได้ — จากปุ่มบนคิวของคุณเอง',
    /**
     * ผู้เซ็นขั้นแรก AND NOBODY ELSE — narrowed on 2026-09-10, when the section
     * was walked against the screen it describes.
     *
     * It read `p.sign || p.correct` and told ฝ่ายบุคคล they could file for
     * anybody on the roster. There is no such button and no such route: the
     * only way into `mode="proxy"` is `+ บันทึก OT แทนพนักงาน` on the queue
     * card, which is drawn `!isHr && !delegatedOnly && isSigner(user.role)`,
     * and `proxyPermission` in lib/proxyFiling.js refuses ฝ่ายบุคคล and
     * ผู้ดูแลระบบ at the route as well — "both would be filing for people they
     * do not work beside". A section describing a button its reader does not
     * have is the exact failure the สิทธิ์ cut exists to end.
     */
    gate: (p) => p.sign,
    gateLabel: () => 'คุณเห็นหัวข้อนี้เพราะคุณเซ็นขั้นแรกให้แผนกหนึ่ง',
    Body: () => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            กด <b>+ บันทึก OT แทนพนักงาน</b> ที่มุมขวาบนของการ์ด <b>รายการรออนุมัติ</b>
            {' '}— ทางเข้าอยู่ที่นั่นทางเดียว เพราะเป็นหน้าที่คุณอยู่ตอนที่เห็นว่าใบขาด
          </p>
          <Shot
            alt="ทางเข้าของการบันทึกแทน ปุ่มบันทึก OT แทนพนักงาน อยู่มุมขวาบนของการ์ดรายการรออนุมัติ กดแล้วฟอร์มเปิดขึ้นมาใต้ปุ่มนั้น ไม่ได้อยู่ที่เมนูอื่น"
            caption="ไม่มีเมนูของตัวเอง — ทางเข้าอยู่บนคิวของคุณเท่านั้น ทั้งบนคอมพิวเตอร์และบนมือถือ"
            desk={(
              <Desk title="รายการรออนุมัติ" nav={<MkRow on badge="3">รายการรออนุมัติ</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>รออนุมัติ</MkRow>
                  <span className="mk-acts">
                    <MkBtn ghost>+ บันทึก OT แทนพนักงาน</MkBtn>
                  </span>
                </span>
                <MkNote>กดแล้วฟอร์มบันทึก OT เปิดขึ้นมาตรงนี้</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="รายการรออนุมัติ" bar={<MkSlot icon="inbox" label="รออนุมัติ" on badge="3" />}>
                <MkRow>รออนุมัติ · 3 รายการ</MkRow>
                <MkBtn ghost>+ บันทึก OT แทนพนักงาน</MkBtn>
                <MkNote>ปุ่มอยู่เหนือรายการ ไม่ได้อยู่ในแถบเมนูล่าง</MkNote>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>ติ๊ก<b>คนที่จะบันทึกแทน</b>ในช่อง <b>บันทึกแทนพนักงาน</b> ก่อน แล้วจึงกรอกวันเวลาตามปกติ</p>
          <ul>
            <li>รายชื่อที่ขึ้นคือคนในแผนกที่คุณเซ็นให้ · ติ๊กได้<b>หลายคนพร้อมกัน</b> หัวข้อช่องบอกจำนวนที่เลือกไว้ และมีปุ่ม เลือกทั้งหมด อยู่ใต้รายการ</li>
            <li>ฟอร์มที่เปิดมาเป็นฟอร์มเดียวกับที่เจ้าตัวใช้ กฎการตรวจเหมือนกันทุกข้อ</li>
            <li>ติ๊กหลายคน ตัวอย่างชั่วโมงจะคิดจาก<b>คนแรกในรายการ</b>เป็นตัวอย่าง และช่องเพดานจะไม่แสดง เพราะเพดานเป็นของแต่ละคน ระบบตรวจให้ทีละคนตอนบันทึก</li>
            <li>ติ๊กมากกว่าหนึ่งคน <b>ปุ่มบันทึกจะต่อท้ายว่ากี่คน</b> — จำนวนที่กำลังจะยื่นอยู่บนปุ่มที่กำลังจะกด</li>
          </ul>
          <Shot
            alt="ฟอร์มบันทึกแทน ช่องบันทึกแทนพนักงานเป็นรายชื่อให้ติ๊ก หัวช่องบอกจำนวนที่เลือกไว้ ใต้รายการมีปุ่มเลือกทั้งหมดและล้างที่เลือก ท้ายฟอร์มปุ่มบันทึกต่อท้ายด้วยจำนวนคน"
            caption="ชื่อในภาพเป็นตัวอย่าง — รายชื่อที่ขึ้นคือคนในแผนกที่คุณเซ็นให้ ติ๊กหลายคนแล้วระบบแยกบันทึกเป็นคนละใบ"
            desk={(
              <Desk title="รายการรออนุมัติ" nav={<MkRow on badge="3">รายการรออนุมัติ</MkRow>}>
                <span className="mk-lab">บันทึกแทนพนักงาน * (เลือกแล้ว 2 คน)</span>
                <MkTick on>สมชาย ใจดี · PM-0620</MkTick>
                <MkTick on>ปรีชา ตั้งใจ · PM-0733</MkTick>
                <MkTick>วิภา สุขใจ · PM-0781</MkTick>
                <span className="mk-acts">
                  <MkBtn ghost>เลือกทั้งหมด (12)</MkBtn>
                  <MkBtn ghost>ล้างที่เลือก</MkBtn>
                </span>
                <MkNote>เพดานของแต่ละคนต่างกัน จึงยังไม่แสดงตรงนี้ — ระบบจะตรวจให้ทีละคนตอนบันทึก</MkNote>
                <MkBtn>บันทึกแทนและส่งให้หัวหน้า · 2 คน</MkBtn>
              </Desk>
            )}
            phone={(
              <Phone title="รายการรออนุมัติ" bar={<MkSlot icon="inbox" label="รออนุมัติ" on badge="3" />}>
                <span className="mk-lab">บันทึกแทนพนักงาน * (เลือกแล้ว 2 คน)</span>
                <MkTick on>สมชาย ใจดี · PM-0620</MkTick>
                <MkTick on>ปรีชา ตั้งใจ · PM-0733</MkTick>
                <MkBtn>บันทึกแทนและส่งให้หัวหน้า · 2 คน</MkBtn>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>
            ใบที่บันทึกแทน<b>ติดป้ายไว้ว่าใครเป็นคนคีย์</b> และเจ้าของใบยังเป็นเจ้าตัว
            ทั้งสองชื่อขึ้นในประวัติของใบ ไม่ถูกยุบเป็นชื่อเดียว
          </p>
          <Shot
            alt="ป้ายบนใบที่บันทึกแทน ในแผ่นรายละเอียดของใบมีแถบบอกว่ารายการนี้มีผู้อื่นเป็นผู้บันทึกแทนพนักงาน พร้อมชื่อผู้บันทึก ส่วนเจ้าของใบยังเป็นชื่อพนักงานคนนั้น"
            caption="ชื่อในภาพเป็นตัวอย่าง — สองชื่ออยู่คนละบรรทัดและไม่ถูกยุบเป็นชื่อเดียว ทั้งบนหน้าจอและในประวัติของใบ"
            desk={(
              <Desk title="รายการรออนุมัติ" nav={<MkRow on badge="3">รายการรออนุมัติ</MkRow>}>
                <span className="mk-alert">
                  <span className="mk-alert-t">รายการนี้มีผู้อื่นเป็นผู้บันทึกแทนพนักงาน — ผู้บันทึก: สุชาติ หัวหน้าฝ่าย</span>
                </span>
                <MkRow>เจ้าของใบ · สมชาย ใจดี · PM-0620</MkRow>
                <MkRow>ประวัติรายการ · หัวหน้างานบันทึกแทนพนักงาน · 10/09/2569 17:40</MkRow>
              </Desk>
            )}
            phone={(
              <Phone title="รายการรออนุมัติ" bar={<MkSlot icon="inbox" label="รออนุมัติ" on badge="3" />}>
                <span className="mk-alert">
                  <span className="mk-alert-t">รายการนี้มีผู้อื่นเป็นผู้บันทึกแทนพนักงาน</span>
                </span>
                <MkRow>ผู้บันทึก: สุชาติ หัวหน้าฝ่าย</MkRow>
                <MkRow>เจ้าของใบ · สมชาย ใจดี</MkRow>
              </Phone>
            )}
          />
        </li>
        {/* ADDED 2026-09-09 WITH `proxySkipsOwnApproval: false`. Until that day
            a filing typed by the หัวหน้า went straight to รอ HR and there was no
            second press to describe — the manual would have been wrong to
            mention one. It is the only step on this page a reader can miss
            entirely and never find out about, because a ใบ that is waiting
            looks exactly like a ใบ that is done from the form they typed it in.

            IT WAS A `p.correct` TERNARY UNTIL 2026-09-10, carrying a second
            paragraph for ฝ่ายบุคคล — who waited for the employee's own หัวหน้า
            and needed no instruction here. The gate above narrowed to `p.sign`
            on that day, which left the branch unreachable AND left this Body
            reading a `p` it is not handed: `Body: () =>` with `p.correct`
            inside it is a ReferenceError the moment a ผู้เซ็น opens the manual.
            One reader, one paragraph. */}
        <li className="manual-step">
          <p>
            ใบที่คุณบันทึกแทนจะไป<b>รออยู่ในคิว รายการรออนุมัติ ของคุณเอง</b> ต้องเปิดแล้ว
            กด <b>อนุมัติ</b> อีกครั้ง ใบจึงจะไปถึงฝ่ายบุคคล — กรอกใบกับรับรองตัวเลขเป็นคนละเรื่อง
            และตรงนั้นกด <b>ไม่อนุมัติ</b> ได้ถ้าคีย์ผิด
          </p>
          <Diagram
            alt="ใบที่บันทึกแทนเดินสามขั้น กรอกแทนแล้วใบไปรออยู่ในคิวของคุณเอง ต้องกดอนุมัติอีกครั้ง แล้วจึงถึงฝ่ายบุคคล"
            caption="สองการกดนี้เป็นคนละเรื่องกัน — ครั้งแรกคือคีย์ให้ ครั้งที่สองคือรับรองว่าตัวเลขถูก"
          >
            <div className="mflow">
              <div className="mflow-node acc">
                <span className="mflow-k">คุณกรอก</span>
                <span className="mflow-n">บันทึกแทนพนักงาน</span>
                <span className="mflow-s">เจ้าของใบคือพนักงาน</span>
              </div>
              <span className="mflow-arrow" aria-hidden="true">→</span>
              <div className="mflow-node">
                <span className="mflow-k">ยังไม่จบ</span>
                <span className="mflow-n">รออยู่ในคิวของคุณ</span>
                <span className="mflow-s">รอหัวหน้า · ต้องกด อนุมัติ อีกครั้ง</span>
              </div>
              <span className="mflow-arrow" aria-hidden="true">→</span>
              <div className="mflow-node done">
                <span className="mflow-k">ขั้นสุดท้าย</span>
                <span className="mflow-n">ฝ่ายบุคคล</span>
                <span className="mflow-s">รอ HR</span>
              </div>
            </div>
          </Diagram>
        </li>
      </ol>
    ),
  },

  {
    key: 'delegate',
    group: 'งานอนุมัติ',
    icon: 'users',
    title: 'ตั้งผู้รับช่วงอนุมัติแทน',
    blurb: (p) => (p.sign
      ? 'ตอนที่คุณจะไม่อยู่ — เป็นช่วงเวลา ไม่ใช่สวิตช์'
      : 'ตั้งผู้รับช่วงให้หัวหน้าที่ไม่อยู่ และคิวใบที่รับช่วงมา'),
    gate: (p) => p.sign || p.correct,
    gateLabel: (p) => (p.sign
      ? 'คุณเห็นหัวข้อนี้เพราะคุณเซ็นขั้นแรกให้แผนกหนึ่ง'
      : 'ฝ่ายบุคคลและผู้ดูแลระบบ'),
    Body: ({ p }) => (p.sign ? (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            เปิด <b>ข้อมูลส่วนตัว</b> แล้วหาการ์ด <b>ผู้รับช่วงอนุมัติแทน</b> กดปุ่ม
            {' '}<b>มอบหมายผู้รับช่วง</b> กล่องจะเปิดขึ้นมาให้กรอกสี่ช่อง
          </p>
          <ul>
            <li><b>ผู้รับช่วง</b> · <b>ตั้งแต่วันที่</b> · <b>ถึงวันที่</b> (นับรวมวันสุดท้าย) · <b>เหตุผล</b> ซึ่งไม่บังคับ แต่จะขึ้นในตารางให้คนอื่นเห็นว่ามาจากอะไร</li>
            <li><b>เป็นหน้าต่างเวลา ไม่ใช่สวิตช์</b> — หมดเองเมื่อพ้นวันที่ตั้งไว้ ไม่ต้องกลับมาปิด</li>
            <li><b>เพิ่มลายเซ็น ไม่ได้ย้าย</b> — คุณยังเซ็นเองได้ตลอด กลับมาก่อนกำหนดไม่ต้องยกเลิกอะไร ถ้าจะปิดก่อนมีปุ่ม <b>ถอน</b> อยู่ท้ายแถวในตาราง</li>
            <li>ระบบบันทึกว่า<b>ใครกด</b>และ<b>ใช้สิทธิ์ของใคร</b> แยกกันเสมอ</li>
          </ul>
          <Shot
            alt="กล่องมอบหมายผู้รับช่วง มีช่องผู้รับช่วง ตั้งแต่วันที่ ถึงวันที่ และเหตุผล บนคอมพิวเตอร์วันที่สองช่องอยู่บรรทัดเดียวกัน บนมือถือกล่องกลายเป็นแผ่นเลื่อนขึ้นจากขอบล่างและเรียงช่องลงมา"
            caption="วันที่ในภาพเป็นตัวอย่าง — บนมือถือกล่องเดียวกันนี้เปิดเป็นแผ่นจากขอบล่างจอ ปุ่มบันทึกอยู่ท้ายแผ่น"
            desk={(
              <Desk title="ข้อมูลส่วนตัว" nav={<MkRow on>ข้อมูลส่วนตัว</MkRow>}>
                <MkRow>ผู้รับช่วงอนุมัติแทน</MkRow>
                <MkField label="ผู้รับช่วง" on>วิภา สุขใจ · หัวหน้างาน</MkField>
                <span className="mk-two">
                  <MkField label="ตั้งแต่วันที่">10/09/2569</MkField>
                  <MkField label="ถึงวันที่">17/09/2569</MkField>
                </span>
                <MkField label="เหตุผล">ลาป่วย</MkField>
                <span className="mk-acts">
                  <MkBtn ghost>ยกเลิก</MkBtn>
                  <MkBtn>บันทึกการมอบหมาย</MkBtn>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="ข้อมูลส่วนตัว" bar={<MkSlot icon="inbox" label="รออนุมัติ" />}>
                <MkField label="ผู้รับช่วง" on>วิภา สุขใจ</MkField>
                <MkField label="ตั้งแต่วันที่">10/09/2569</MkField>
                <MkField label="ถึงวันที่">17/09/2569</MkField>
                <MkBtn>บันทึกการมอบหมาย</MkBtn>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>ใบที่ผู้รับช่วงเห็นจะติดป้าย <b>รับช่วง</b> บนแถว เพื่อให้รู้ว่ากำลังเซ็นด้วยสิทธิ์ของใคร</p>
          <Shot
            alt="แถวที่รับช่วงมา มีป้ายรับช่วงตามด้วยชื่อแผนกอยู่บนแถว และเหนือคิวมีแถบบอกว่ากำลังรับช่วงคิวของใครถึงวันไหน"
            caption="ชื่อและวันที่ในภาพเป็นตัวอย่าง — ป้ายอยู่บนแถว ไม่ใช่บนหัวคิว เพราะคิวหนึ่งคิวมีทั้งใบของคุณเองและใบที่รับช่วงมาปนกัน"
            desk={(
              <Desk title="รายการรออนุมัติ" nav={<MkRow on badge="4">รายการรออนุมัติ</MkRow>}>
                <span className="mk-alert">
                  <span className="mk-alert-t">คุณกำลังรับช่วงอนุมัติแทน วิภา สุขใจ ถึง 17/09/2569</span>
                </span>
                <span className="mk-headrow">
                  <MkRow>สมชาย ใจดี · 10/09/2569</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="off">รับช่วง · ฝ่ายผลิต</MkChip>
                    <MkIconBtn icon="tick" tone="ok" />
                  </span>
                </span>
                <span className="mk-headrow">
                  <MkRow>ปรีชา ตั้งใจ · 10/09/2569</MkRow>
                  <span className="mk-acts">
                    <MkIconBtn icon="tick" tone="ok" />
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="รายการรออนุมัติ" bar={<MkSlot icon="inbox" label="รออนุมัติ" on badge="4" />}>
                <span className="mk-alert">
                  <span className="mk-alert-t">คุณกำลังรับช่วงอนุมัติแทน วิภา สุขใจ</span>
                </span>
                <MkRow badge="›">สมชาย ใจดี · 10/09/2569</MkRow>
                <span className="mk-acts"><MkChip tone="off">รับช่วง · ฝ่ายผลิต</MkChip></span>
              </Phone>
            )}
          />
        </li>
      </ol>
    ) : (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            <b>คุณตั้งผู้รับช่วงให้หัวหน้าคนอื่นได้</b> — ที่ <b>ตั้งค่าระบบ</b> หัวข้อ
            {' '}<b>ผู้รับช่วงอนุมัติ</b> ช่องแรกคือ <b>คิวของหัวหน้างาน</b> ให้เลือกว่ากำลังมอบคิวของใคร
            {' '}ที่เหลือเหมือนกับที่หัวหน้าตั้งเอง — เผื่อกรณีที่หัวหน้าล้มป่วยกะทันหันจนเข้าระบบมาตั้งเองไม่ได้
          </p>
          <Shot
            alt="หน้าตั้งค่าระบบ หัวข้อผู้รับช่วงอนุมัติ กล่องมอบหมายมีช่องคิวของหัวหน้างานเป็นช่องแรก ตามด้วยผู้รับช่วง ตั้งแต่วันที่ ถึงวันที่ และเหตุผล ใต้ลงมาเป็นตารางการมอบหมายที่มีอยู่พร้อมปุ่มยกเลิกท้ายแถว"
            caption="ชื่อและวันที่ในภาพเป็นตัวอย่าง — ช่องแรกคือสิ่งที่ต่างจากหน้าของหัวหน้าเอง เพราะคุณกำลังมอบคิวของคนอื่น"
            desk={(
              <Desk title="ตั้งค่าระบบ" nav={<MkRow on>ตั้งค่าระบบ</MkRow>}>
                <MkTabs
                  on="ผู้รับช่วงอนุมัติ"
                  items={['แผนกและเพดาน', 'พนักงาน', 'วันหยุดบริษัท', 'นโยบายการคำนวณ', 'ผู้รับช่วงอนุมัติ']}
                />
                <MkField label="คิวของหัวหน้างาน" on>สมหญิง ผู้ดูแลสาย · หัวหน้างาน</MkField>
                <MkField label="ผู้รับช่วง">วิภา สุขใจ · หัวหน้างาน</MkField>
                <span className="mk-two">
                  <MkField label="ตั้งแต่วันที่">10/09/2569</MkField>
                  <MkField label="ถึงวันที่">17/09/2569</MkField>
                </span>
                <MkCols>สถานะ · คิวของ · ผู้รับช่วง · ช่วงเวลา · เหตุผล · ผู้ตั้ง</MkCols>
                <span className="mk-headrow">
                  <MkRow>สมหญิง → วิภา · 10–17/09/2569</MkRow>
                  <span className="mk-acts"><MkBtn ghost>ยกเลิก</MkBtn></span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="ตั้งค่าระบบ" bar={<MkSlot icon="sliders" label="เพิ่มเติม" on />}>
                <MkField label="หน้าตั้งค่า" on>ผู้รับช่วงอนุมัติ</MkField>
                <MkField label="คิวของหัวหน้างาน" on>สมหญิง ผู้ดูแลสาย</MkField>
                <MkField label="ผู้รับช่วง">วิภา สุขใจ</MkField>
                <MkBtn>บันทึกการมอบหมาย</MkBtn>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>
            เมนู <b>รออนุมัติแทน</b> จะขึ้นเมื่อคุณกำลังรับช่วงคิวของหัวหน้าอยู่
            เป็นคิวแยกจาก รออนุมัติ OT ของคุณเอง เพราะเป็นคนละความรับผิดชอบ
          </p>
          <ul>
            <li>คิวนี้ยังอยู่แม้ไม่มีใบค้าง — ความรับผิดชอบไม่ได้หายไปพร้อมแถวสุดท้าย</li>
          </ul>
          <Shot
            alt="เมนูรออนุมัติแทน เป็นอีกแถวหนึ่งในเมนูแยกจากรออนุมัติ OT ของตัวเอง หัวคิวเขียนว่ารออนุมัติ ทีมที่รับช่วง พร้อมบรรทัดบอกว่าการอนุมัติจะบันทึกว่าทำแทนเจ้าของคิว"
            caption="สองคิวคนละแถวในเมนู และตัวเลขบนแต่ละแถวก็นับแยกกัน — คิวที่รับช่วงมาไม่ได้ถูกเทรวมเข้ากับคิวของคุณ"
            desk={(
              <Desk
                title="รออนุมัติแทน"
                nav={(
                  <>
                    <span className="mk-side-h">การอนุมัติ &amp; รายงาน</span>
                    <MkRow badge="5">รออนุมัติ OT</MkRow>
                    <MkRow on badge="2">รออนุมัติแทน</MkRow>
                  </>
                )}
              >
                <MkRow>รออนุมัติ · ทีมที่รับช่วง</MkRow>
                <MkNote>คิวของหัวหน้างานที่คุณรับช่วงมา · การอนุมัติจะบันทึกว่าทำแทนเจ้าของคิว</MkNote>
              </Desk>
            )}
            phone={(
              <Phone
                title="รออนุมัติแทน"
                bar={<MkSlot icon="check" label="รออนุมัติ" on badge="7" />}
              >
                <MkNote>ปุ่มรออนุมัติปุ่มเดียวถือสองคิว กดแล้วเปิดเป็นแผ่นรายการให้เลือกก่อน</MkNote>
                <MkRow on badge="2">รออนุมัติแทน</MkRow>
                <MkRow badge="5">รออนุมัติ OT</MkRow>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>
            ทุกครั้งที่คุณเซ็นแทน ระบบบันทึกว่า<b>คุณกด</b> และ<b>ใช้สิทธิ์ของใคร</b>
            สองอย่างนี้ไม่ถูกยุบเป็นชื่อเดียว เพราะคำถามตอนตัวเลขถูกโต้แย้งคือ “ทำไมคนนี้เซ็นได้”
          </p>
          <Shot
            alt="บรรทัดในประวัติของใบเมื่อเซ็นแทน เขียนว่าหัวหน้างานอนุมัติ โดยชื่อคนที่กด ตามด้วยคำว่าทำแทนและชื่อหัวหน้าเจ้าของคิว"
            caption="ชื่อในภาพเป็นตัวอย่าง — บรรทัดเดียวกันนี้ขึ้นบนใบที่พิมพ์ออกมาด้วย ไม่ได้อยู่แค่บนหน้าจอ"
            desk={(
              <Desk title="รออนุมัติแทน" nav={<MkRow on badge="2">รออนุมัติแทน</MkRow>}>
                <MkRow>ประวัติรายการ</MkRow>
                <MkRow>ยื่นคำขอ · โดย สมชาย ใจดี · 10/09/2569 17:02</MkRow>
                <MkRow>หัวหน้างานอนุมัติ · โดย คุณ · ทำแทน สมหญิง ผู้ดูแลสาย</MkRow>
              </Desk>
            )}
            phone={(
              <Phone title="รออนุมัติแทน" bar={<MkSlot icon="check" label="รออนุมัติ" on badge="7" />}>
                <MkRow>ประวัติรายการ</MkRow>
                <MkRow>หัวหน้างานอนุมัติ · โดย คุณ · ทำแทน สมหญิง</MkRow>
              </Phone>
            )}
          />
        </li>
      </ol>
    )),
  },

  {
    key: 'team',
    group: 'รายงาน',
    icon: 'chart',
    title: 'รายงาน OT ประจำทีม',
    blurb: () => 'เดือนของแผนกที่คุณเซ็นให้ — ไม่ใช่ทั้งบริษัท',
    gate: (p) => p.sign,
    gateLabel: () => 'คุณเห็นหัวข้อนี้เพราะคุณเซ็นขั้นแรกให้แผนกหนึ่ง',
    Body: ({ p }) => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            เลือกเดือนที่ช่อง <b>ประจำเดือน</b> แล้วอ่านยอดรายคนของ<b>แผนกที่คุณถืออยู่</b> —
            ขอบเขตคือแผนกที่ลายเซ็นขั้นแรกเป็นของคุณ · ช่อง <b>สถานะที่นับ</b> ข้าง ๆ กันคือตัวตัดสินว่า
            ตัวเลขทั้งตารางนับใบสถานะไหน — เฉพาะที่อนุมัติแล้ว · เฉพาะที่ค้างอยู่ขั้นเดียว
            (<b>รอ HR เท่านั้น</b> หรือ <b>รอหัวหน้าเท่านั้น</b>) · หรือรวมกัน · ช่อง <b>ค้นหาพนักงาน</b>
            {' '}กรองเฉพาะหน้าจอ และเอกสารที่สั่งพิมพ์จะได้เท่าที่กรองไว้
          </p>
          <Shot
            alt="หัวหน้ารายงาน OT ประจำทีม มีช่องประจำเดือน ช่องสถานะที่นับ และช่องค้นหาพนักงานอยู่เหนือตาราง ใต้ลงมาเป็นปุ่มเอกสารของเดือน"
            caption="เดือนในภาพเป็นตัวอย่าง — สองช่องบนตัดสินว่าตัวเลขทั้งตารางนับอะไร ส่วนช่องค้นหากรองเฉพาะสิ่งที่เห็นบนจอ"
            desk={(
              <Desk title="รายงาน OT ประจำทีม" nav={<MkRow on>รายงาน OT ประจำทีม</MkRow>}>
                <span className="mk-two">
                  <MkField label="สถานะที่นับ" on>อนุมัติแล้ว + รอ HR</MkField>
                  <MkField label="ประจำเดือน">กันยายน 2569</MkField>
                </span>
                <MkField label="ค้นหาพนักงาน">ค้นหาชื่อ หรือ รหัสพนักงาน…</MkField>
                <MkNote>เฉพาะแผนกที่คุณเซ็นอนุมัติ</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="รายงาน OT ประจำทีม" bar={<MkSlot icon="chart" label="รายงานทีม" on />}>
                <MkField label="สถานะที่นับ" on>อนุมัติแล้ว + รอ HR</MkField>
                <MkField label="ประจำเดือน">กันยายน 2569</MkField>
                <MkField label="ค้นหาพนักงาน">ค้นหาชื่อ หรือ รหัสพนักงาน…</MkField>
              </Phone>
            )}
          />
          {p.company ? (
            <p className="hint">
              คุณมีอีกหน้าหนึ่งที่กว้างกว่านี้คือ <b>ตรวจสอบประจำเดือน</b> ซึ่งเป็นของทั้งบริษัท — อยู่หัวข้อถัดไป
            </p>
          ) : null}
        </li>
        <li className="manual-step">
          <p><b>เพดานในตารางนี้วัดรายคน</b> ไม่ใช่โควตารวมที่ทั้งแผนกแบ่งกันใช้</p>
          <ul>
            <li>นับชั่วโมงจริง ไม่ใช่ชั่วโมงคูณอัตรา และนับรวมใบที่ยังรออนุมัติด้วย</li>
            <li>ค่าเพดานจริงของแต่ละแผนก ฝ่ายบุคคลตั้งที่หน้า <b>ตั้งค่าระบบ</b></li>
          </ul>
          <Shot
            alt="ตารางรายคนของทีม คอลัมน์เรียงเป็นชื่อพนักงาน แผนก ชั่วโมงสามช่องอัตรา รวม จำนวนรายการ และช่องสะสมทับเพดานของคนนั้น ท้ายแถวมีปุ่มดูรายการ"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — ช่องสะสม / เพดาน เป็นของคนในแถวนั้นคนเดียว ไม่ใช่ยอดที่ทั้งแผนกแบ่งกันใช้"
            desk={(
              <Desk title="รายงาน OT ประจำทีม" nav={<MkRow on>รายงาน OT ประจำทีม</MkRow>}>
                <MkCols>พนักงาน · แผนก · ×1.5 ปกติ · ×1.5 วันหยุด · ×3 วันหยุด · รวม ชม. · รายการ · สะสม / เพดาน</MkCols>
                <span className="mk-headrow">
                  <MkRow>สมชาย ใจดี · PM-0620</MkRow>
                  <span className="mk-acts">
                    <span className="mk-cell"><span className="mk-cell-k">สะสม / เพดาน</span><span className="mk-cell-v">28 / 36</span></span>
                    <MkBtn ghost>ดูรายการ</MkBtn>
                  </span>
                </span>
                <span className="mk-headrow">
                  <MkRow>ปรีชา ตั้งใจ · PM-0733</MkRow>
                  <span className="mk-acts">
                    <span className="mk-cell"><span className="mk-cell-k">สะสม / เพดาน</span><span className="mk-cell-v warn">37 / 36</span></span>
                    <MkBtn ghost>ดูรายการ</MkBtn>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="รายงาน OT ประจำทีม" bar={<MkSlot icon="chart" label="รายงานทีม" on />}>
                <MkRow badge="›">สมชาย ใจดี · รวม 28 ชม.</MkRow>
                <span className="mk-cell"><span className="mk-cell-k">สะสม / เพดาน</span><span className="mk-cell-v">28 / 36</span></span>
                <MkRow badge="›">ปรีชา ตั้งใจ · รวม 37 ชม.</MkRow>
                <span className="mk-cell"><span className="mk-cell-k">สะสม / เพดาน</span><span className="mk-cell-v warn">37 / 36</span></span>
              </Phone>
            )}
          />
        </li>
      </ol>
    ),
  },

  {
    key: 'company',
    group: 'รายงาน',
    icon: 'calendar',
    title: 'ตรวจสอบประจำเดือน และรายงาน OT การเงิน',
    blurb: () => 'เดือนของทั้งบริษัท สองมุมมองของเดือนเดียวกัน',
    gate: (p) => p.company,
    gateLabel: (p) => (p.readOnly
      ? 'คุณเปิดอ่านได้ แต่แก้ไขข้อมูลไม่ได้'
      : 'ฝ่ายบุคคลและผู้ดูแลระบบ'),
    Body: ({ p }) => (
      <ol className="manual-steps">
        {p.readOnly ? (
          <li className="manual-step">
            <p>
              <b>คุณเปิดสองหน้านี้ได้ แต่แก้ไขอะไรไม่ได้</b> — บนหน้าจอจะไม่มีปุ่มที่เขียนข้อมูลให้กดเลย
              ตัวเลขผิดให้แจ้งฝ่ายบุคคลแก้ให้
            </p>
            <Shot
              alt="แถวในตารางตรวจสอบประจำเดือนของบทบาทที่เปิดอ่านได้อย่างเดียว ท้ายแถวมีปุ่มดูรายการปุ่มเดียว ไม่มีปุ่มแก้ไข และหน้าที่เปิดต่อไปก็ไม่มีปุ่มแก้ไขที่แถวใบ"
              caption="ปุ่มเอกสารและปุ่มส่งออกยังกดได้ตามปกติ — สิ่งที่ไม่มีคือปุ่มที่เปลี่ยนตัวเลขของใคร"
              desk={(
                <Desk title="ตรวจสอบประจำเดือน" nav={<MkRow on>ตรวจสอบประจำเดือน</MkRow>}>
                  <span className="mk-headrow">
                    <MkRow>สมชาย ใจดี · PM-0620</MkRow>
                    <span className="mk-acts"><MkBtn ghost>ดูรายการ</MkBtn></span>
                  </span>
                  <MkNote>ฝ่ายบุคคลและผู้ดูแลระบบเห็นปุ่มนี้เป็น ดู / แก้ไขรายการ</MkNote>
                </Desk>
              )}
              phone={(
                <Phone title="ตรวจสอบประจำเดือน" bar={<MkSlot icon="chart" label="รายงาน" on />}>
                  <MkRow badge="›">สมชาย ใจดี · PM-0620</MkRow>
                  <MkBtn ghost>ดูรายการ</MkBtn>
                </Phone>
              )}
            />
          </li>
        ) : null}

        <li className="manual-step">
          <p>
            <b>ตรวจสอบประจำเดือน</b> — ยอดรายคนของทุกแผนก ทั้งสองบริษัท
            ใช้กระทบยอดกับ <b>รายงาน OT การเงิน</b> ซึ่งเป็นสรุปของเดือนเดียวกัน
          </p>
          <Shot
            alt="ตารางตรวจสอบประจำเดือน หนึ่งแถวต่อพนักงานหนึ่งคน มีคอลัมน์แผนก ชั่วโมงสามช่องอัตรา รวม จำนวนรายการ จำนวนครั้งที่แก้ไข และสะสมทับเพดาน ท้ายแถวเป็นปุ่มดูหรือแก้ไขรายการ"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — คอลัมน์ แก้ไข บอกว่าแถวนั้นเคยถูกแตะกี่ครั้ง กดแล้วดูได้ว่าใครแก้อะไรและค่าเดิมคืออะไร"
            desk={(
              <Desk title="ตรวจสอบประจำเดือน" nav={<MkRow on>ตรวจสอบประจำเดือน</MkRow>}>
                <MkCols>พนักงาน · แผนก · ×1.5 ปกติ · ×1.5 วันหยุด · ×3 วันหยุด · รวม ชม. · รายการ · แก้ไข · สะสม / เพดาน</MkCols>
                <span className="mk-headrow">
                  <MkRow>สมชาย ใจดี · ฝ่ายผลิต</MkRow>
                  <span className="mk-acts">
                    <span className="mk-cell"><span className="mk-cell-k">รวม ชม.</span><span className="mk-cell-v">28</span></span>
                    <MkBtn ghost>ดู / แก้ไขรายการ</MkBtn>
                  </span>
                </span>
                <span className="mk-headrow">
                  <MkRow>วิภา สุขใจ · ฝ่ายบัญชี</MkRow>
                  <span className="mk-acts">
                    <span className="mk-cell"><span className="mk-cell-k">รวม ชม.</span><span className="mk-cell-v">9.5</span></span>
                    <MkBtn ghost>ดู / แก้ไขรายการ</MkBtn>
                  </span>
                </span>
                <MkNote>รวมทั้งหมด — ยอดของทั้งเดือน ไม่ใช่ยอดของผลการค้นหา</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="ตรวจสอบประจำเดือน" bar={<MkSlot icon="chart" label="รายงาน" on />}>
                <MkRow badge="›">สมชาย ใจดี · ฝ่ายผลิต · 28 ชม.</MkRow>
                <MkRow badge="›">วิภา สุขใจ · ฝ่ายบัญชี · 9.5 ชม.</MkRow>
                <MkNote>รวมทั้งหมด — ยอดของทั้งเดือน ไม่ใช่ยอดของผลการค้นหา</MkNote>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>ก่อนพิมพ์ทั้งเดือน อ่าน <b>สรุปสถานะงวด</b> ว่ายังมีใบค้างใครอยู่หรือเปล่า</p>
          <Shot
            alt="การ์ดสรุปสถานะงวด เป็นข้อความบรรทัดเดียวบอกว่าเดือนนี้มีอะไรค้างอยู่กี่ใบ พร้อมบรรทัดเล็กใต้ลงมาบอกว่าค้างแล้วเป็นอย่างไร"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — เป็นประโยคเดียว ไม่ใช่ช่องตัวเลขหลายช่อง · เดือนที่ไม่มีอะไรค้างการ์ดจะขึ้นเครื่องหมายถูกแทน · หน้านี้ถามอย่างเดียว ไม่ได้ปิดกั้นอะไร ระบบนี้ไม่มีการปิดงวด"
            desk={(
              <Desk title="ตรวจสอบประจำเดือน" nav={<MkRow on>ตรวจสอบประจำเดือน</MkRow>}>
                <span className="mk-alert col">
                  <span className="mk-alert-t">⚠ งวด กันยายน 2569 — มีใบรออนุมัติค้างอยู่ 4 ใบ</span>
                  <MkNote>ยังไม่มีชื่อผู้อนุมัติในใบ OT ที่พิมพ์ออกมา</MkNote>
                </span>
                <MkNote>เดือนก่อน · สิงหาคม 2569 — มีใบรออนุมัติค้างอยู่ 12 ใบ · เลือกเดือนนั้นในช่อง ประจำเดือน เพื่อตรวจก่อนพิมพ์</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="ตรวจสอบประจำเดือน" bar={<MkSlot icon="chart" label="รายงาน" on />}>
                <span className="mk-alert col">
                  <span className="mk-alert-t">⚠ งวด กันยายน 2569 — มีใบรออนุมัติค้างอยู่ 4 ใบ</span>
                  <MkNote>ยังไม่มีชื่อผู้อนุมัติในใบ OT ที่พิมพ์ออกมา</MkNote>
                </span>
              </Phone>
            )}
          />
          <ul>
            <li>ที่ค้างมีได้สี่แบบ — <b>ใบรออนุมัติ</b> · <b>คำขอถอนใบค้างพิจารณา</b> · <b>ใบที่เกินเพดานของแผนก</b> · <b>ใบที่ต่ำกว่าเกณฑ์ขั้นต่ำ</b> แต่ละแบบมีบรรทัดบอกว่าค้างแล้วมีผลอย่างไร</li>
            <li>ถ้า<b>เดือนก่อนหน้า</b>ยังมีของค้าง การ์ดนี้จะเตือนไว้ด้วย พร้อมบอกให้ย้อนไปเลือกเดือนนั้น</li>
          </ul>
          <p className="hint">
            ใบที่ยังไม่อนุมัติจะไม่ขึ้นบนแผ่นที่พิมพ์ — แผ่นที่เข้าแฟ้มโดยขาดแถวคือความผิดพลาดที่หาทีหลังยาก
          </p>
        </li>

        <li className="manual-step">
          <p>ปุ่มเอกสารของเดือนอยู่เป็นแถวเดียวกันใต้ช่องค้นหา และทุกปุ่มทำงานกับ<b>สิ่งที่อยู่บนตารางตอนนั้น</b></p>
          <ul>
            <li><b>พิมพ์ใบขออนุมัติ OT ทุกคน</b> — รวมใบของทุกคนในตารางเป็นเอกสารเดียว หนึ่งคนต่อหนึ่งหน้า</li>
            <li><b>ส่งออกรายการ OT (CSV)</b> — ทีละใบ</li>
            <li><b>ส่งออกรายงานสรุปประจำเดือน (CSV)</b> — ยอดรวมรายคน</li>
          </ul>
          <Shot
            alt="แถวปุ่มเอกสารใต้ช่องค้นหา ปุ่มพิมพ์ใบขออนุมัติ OT ทุกคนพร้อมจำนวนคนในวงเล็บ ปุ่มส่งออกรายการ OT และปุ่มส่งออกรายงานสรุปประจำเดือน"
            caption="จำนวนในวงเล็บบนปุ่มพิมพ์คือจำนวนคนที่จะได้ออกมา — ค้นหาไว้เท่าไร ปุ่มพิมพ์ได้เท่านั้น ส่วนไฟล์ CSV ยังเป็นของทั้งเดือน"
            desk={(
              <Desk title="ตรวจสอบประจำเดือน" nav={<MkRow on>ตรวจสอบประจำเดือน</MkRow>}>
                <MkField label="ค้นหาพนักงาน">ค้นหาชื่อ หรือ รหัสพนักงาน…</MkField>
                <span className="mk-acts">
                  <MkBtn ghost>พิมพ์ใบขออนุมัติ OT ทุกคน (24 คน)</MkBtn>
                  <MkBtn ghost>ส่งออกรายการ OT (CSV)</MkBtn>
                  <MkBtn ghost>ส่งออกรายงานสรุปประจำเดือน (CSV)</MkBtn>
                </span>
                <MkNote>ไฟล์ CSV และยอด “รวมทั้งหมด” ยังเป็นของทั้งเดือน ไม่ใช่เฉพาะผลการค้นหา</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="ตรวจสอบประจำเดือน" bar={<MkSlot icon="chart" label="รายงาน" on />}>
                <MkBtn ghost>พิมพ์ใบขออนุมัติ OT ทุกคน (24 คน)</MkBtn>
                <MkBtn ghost>ส่งออกรายการ OT (CSV)</MkBtn>
                <MkBtn ghost>ส่งออกรายงานสรุปประจำเดือน (CSV)</MkBtn>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p><b>รายงาน OT การเงิน</b> — แผ่นที่ส่งบัญชี พิมพ์ออกไปได้ทั้งเดือน</p>
          <Shot
            alt="หน้ารายงาน OT การเงิน เลือกบริษัทและเดือนได้ ตารางเรียงตามแผนกพร้อมรวมแผนกและรวมทั้งหมด ปุ่มด้านบนคือส่งออกไฟล์บัญชีและพิมพ์แบบฟอร์ม"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — หน้านี้นับเฉพาะรายการที่อนุมัติครบและ HR ยืนยันแล้ว ใบที่ยังค้างอยู่จะมีแถบเตือนไว้เหนือตาราง"
            desk={(
              <Desk title="รายงาน OT การเงิน" nav={<MkRow on>รายงาน OT การเงิน</MkRow>}>
                <span className="mk-two">
                  <MkField label="บริษัท" on>ทุกบริษัท</MkField>
                  <MkField label="ประจำเดือน">กันยายน 2569</MkField>
                </span>
                <span className="mk-acts">
                  <MkBtn ghost>ส่งออกไฟล์บัญชี (CSV/Excel)</MkBtn>
                  <MkBtn ghost>พิมพ์แบบฟอร์ม / บันทึกเป็น PDF</MkBtn>
                </span>
                <MkCols>พนักงาน · แผนก · ปกติ · วันหยุด · รวม ชม. · หมายเหตุ / บริษัท</MkCols>
                <MkRow>รวมแผนก · ฝ่ายผลิต · 96 ชม.</MkRow>
                <MkRow>รวมทั้งหมด · 214 ชม.</MkRow>
              </Desk>
            )}
            phone={(
              <Phone title="รายงาน OT การเงิน" bar={<MkSlot icon="chart" label="รายงาน" on />}>
                <MkField label="บริษัท" on>ทุกบริษัท</MkField>
                <MkBtn ghost>ส่งออกไฟล์บัญชี (CSV/Excel)</MkBtn>
                <MkRow>รวมแผนก · ฝ่ายผลิต · 96 ชม.</MkRow>
                <MkRow>รวมทั้งหมด · 214 ชม.</MkRow>
              </Phone>
            )}
          />
        </li>
      </ol>
    ),
  },

  {
    key: 'dept',
    group: 'รายงาน',
    icon: 'org',
    title: 'รายงาน OT แยกแผนก',
    blurb: () => 'แต่ละแผนกทำไปกี่ชั่วโมง นับสองบริษัทรวมกัน',
    gate: (p) => p.correct,
    gateLabel: () => 'ฝ่ายบุคคลและผู้ดูแลระบบ',
    Body: () => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            คนละคำถามกับ รายงาน OT การเงิน แม้จะเป็นเดือนเดียวกัน —
            ใบนี้ตอบว่า<b>แผนกไหนทำไปเท่าไร</b> ส่วนใบการเงินตอบว่า<b>ส่งบัญชีเท่าไร</b>
          </p>
          <Shot
            alt="หน้ารายงาน OT แยกแผนก เลือกแผนกและเดือนได้ ตารางเรียงเป็นลำดับที่ ชื่อ บริษัท และรวมชั่วโมง ปุ่มด้านบนคือส่งออกไฟล์แยกแผนกและพิมพ์แบบฟอร์ม"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — ไฟล์และแบบฟอร์มออกครบทุกแผนกเสมอ ไม่ขึ้นกับแผนกที่เลือกไว้ด้านบน"
            desk={(
              <Desk title="รายงาน OT แยกแผนก" nav={<MkRow on>รายงาน OT แยกแผนก</MkRow>}>
                <span className="mk-two">
                  <MkField label="แผนก" on>ทุกแผนก</MkField>
                  <MkField label="ประจำเดือน">กันยายน 2569</MkField>
                </span>
                <span className="mk-acts">
                  <MkBtn ghost>ส่งออกไฟล์แยกแผนก (CSV/Excel)</MkBtn>
                  <MkBtn ghost>พิมพ์แบบฟอร์ม / บันทึกเป็น PDF</MkBtn>
                </span>
                <MkCols>ลำดับที่ · ชื่อ-นามสกุล · บริษัท · รวม ชม.</MkCols>
                <MkRow>ฝ่ายผลิต · 6 คนมี OT · รวม 96 ชม.</MkRow>
              </Desk>
            )}
            phone={(
              <Phone title="รายงาน OT แยกแผนก" bar={<MkSlot icon="chart" label="รายงาน" on />}>
                <MkField label="แผนก" on>ทุกแผนก</MkField>
                <MkBtn ghost>ส่งออกไฟล์แยกแผนก (CSV/Excel)</MkBtn>
                <MkRow>ฝ่ายผลิต · 6 คนมี OT · รวม 96 ชม.</MkRow>
              </Phone>
            )}
          />
          <p className="hint">พิมพ์แยกใบกันได้ เพราะเป็นคนละแผ่นสำหรับคนละคนอ่าน</p>
        </li>
      </ol>
    ),
  },

  {
    key: 'confirm',
    group: 'งานฝ่ายบุคคลและผู้ดูแลระบบ',
    icon: 'check',
    title: 'ยืนยันขั้นที่สอง — รออนุมัติ OT',
    blurb: () => 'ลายเซ็นสุดท้ายของทุกแผนก',
    gate: (p) => p.correct,
    gateLabel: () => 'ฝ่ายบุคคลและผู้ดูแลระบบ',
    Body: () => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            ทุกใบในบริษัทผ่านคิวนี้ ไม่ว่าจะเริ่มจากแผนกไหน
            ใบที่ยื่นโดยการเงิน ผู้จัดการฝ่าย ฝ่ายบุคคล หรือผู้ดูแลระบบ มาถึงคิวนี้ตั้งแต่แรก ไม่ผ่านขั้นหัวหน้า
          </p>
          <ul>
            <li>หน้าตาและวิธีใช้เหมือนคิวของหัวหน้า ต่างกันที่<b>คำบนปุ่มเป็น ยืนยัน</b> แทน อนุมัติ เพราะเป็นลายเซ็นขั้นสุดท้าย</li>
            <li>
              และต่างกันที่มี<b>คอลัมน์สถานะ</b>เพิ่มมา เพราะคิวนี้เห็นใบตั้งแต่ขั้นหัวหน้า —
              แถวที่ยังเป็น <b>รอหัวหน้า</b> เปิดอ่านได้แต่ยังกดยืนยันไม่ได้ และจะเข้าคิวนี้เองเมื่อหัวหน้าเซ็นแล้ว
            </li>
            <li>ติ๊กหลายแถวแล้วยืนยันทีเดียวได้เหมือนกัน</li>
          </ul>
          <Shot
            alt="คิวรออนุมัติ OT ของฝ่ายบุคคล หน้าตาเหมือนคิวของหัวหน้าแต่ปุ่มท้ายแถวเขียนว่ายืนยัน และมีคอลัมน์สถานะเพิ่มมาให้เห็นว่าแต่ละใบอยู่ขั้นไหน"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — คิวนี้เห็นทุกแผนกทั้งสองบริษัท และเห็นใบตั้งแต่ขั้นหัวหน้าด้วย จึงมีคอลัมน์สถานะที่คิวของหัวหน้าไม่มี"
            desk={(
              <Desk title="รออนุมัติ OT" nav={<MkRow on badge="8">รออนุมัติ OT</MkRow>}>
                <MkCols>พนักงาน · วันที่ · เวลา · รวม · สถานะ · สะสม / เพดาน · รายละเอียด</MkCols>
                <span className="mk-headrow">
                  <MkTick>สมชาย ใจดี · 10/09/2569</MkTick>
                  <span className="mk-acts">
                    <MkChip tone="wait">รอ HR</MkChip>
                    <MkIconBtn icon="tick" tone="ok" />
                    <MkIconBtn icon="cross" tone="no" />
                  </span>
                </span>
                <span className="mk-headrow">
                  <MkRow>ปรีชา ตั้งใจ · 10/09/2569</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="wait">รอหัวหน้า</MkChip>
                    <MkNote>ยังไม่ถึงขั้นยืนยัน</MkNote>
                  </span>
                </span>
                <MkBtn>✓ ยืนยันทั้งหมด (2 รายการ)</MkBtn>
              </Desk>
            )}
            phone={(
              <Phone title="รออนุมัติ OT" bar={<MkSlot icon="check" label="รออนุมัติ" on badge="8" />}>
                <MkTick>สมชาย ใจดี · 10/09/2569</MkTick>
                <span className="mk-acts">
                  <MkChip tone="wait">รอ HR</MkChip>
                  <MkIconBtn icon="tick" tone="ok">ยืนยัน</MkIconBtn>
                </span>
                <MkRow>ปรีชา ตั้งใจ · รอหัวหน้า</MkRow>
                <MkNote>ยังไม่ถึงขั้นยืนยัน — รอหัวหน้าแผนกเซ็นก่อน</MkNote>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>ตัวเลขบนปุ่มรวม<b>คำขอถอนที่ยังไม่ตอบ</b>ของใบที่รออยู่ในคิวนี้ด้วย</p>
          <Shot
            alt="ตัวเลขบนเมนูรออนุมัติ OT นับทั้งใบที่รอยืนยันและคำขอถอนใบที่ยังไม่ตอบ ซึ่งแสดงเป็นการ์ดอยู่เหนือคิว"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — ตัวเลขลดลงเมื่อตอบคำขอถอนด้วย ไม่ใช่เฉพาะตอนยืนยันใบ"
            desk={(
              <Desk title="รออนุมัติ OT" nav={<MkRow on badge="8">รออนุมัติ OT</MkRow>}>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">คำขอถอนใบที่อนุมัติแล้ว (2 รายการ)</span>
                  <MkNote>ยังมีผลและยังถูกนับอยู่ จนกว่าจะอนุมัติให้ถอน</MkNote>
                </span>
                <MkRow>รออนุมัติ · 6 รายการ</MkRow>
              </Desk>
            )}
            phone={(
              <Phone title="รออนุมัติ OT" bar={<MkSlot icon="check" label="รออนุมัติ" on badge="8" />}>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">คำขอถอนใบที่อนุมัติแล้ว (2 รายการ)</span>
                </span>
                <MkRow>รออนุมัติ · 6 รายการ</MkRow>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>
            ไม่อนุมัติที่ขั้นนี้ ใบจะย้อนกลับไปตามที่ตั้งไว้ในนโยบาย
            ปลายทางของการตีกลับตั้งได้ที่หน้า <b>ตั้งค่าระบบ</b> หัวข้อ <b>นโยบายการคำนวณ</b>
            {' '}ข้อ <b>เมื่อ HR ปฏิเสธ ส่งกลับไปที่</b>
          </p>
          <Shot
            alt="ข้อในนโยบายการคำนวณที่ชื่อว่า เมื่อ HR ปฏิเสธ ส่งกลับไปที่ มีสองตัวเลือกคือ พนักงาน แก้ไขและส่งใหม่ กับ หัวหน้างาน"
            caption="สองตัวเลือกนี้เป็นค่าที่ฝ่ายบุคคลเลือกเอง คู่มือจึงไม่เขียนว่าตอนนี้ตั้งไว้แบบไหน — ดูจากหน้านั้น"
            desk={(
              <Desk title="ตั้งค่าระบบ" nav={<MkRow on>ตั้งค่าระบบ</MkRow>}>
                <MkTabs on="นโยบายการคำนวณ" items={['วันหยุดบริษัท', 'นโยบายการคำนวณ', 'ผู้รับช่วงอนุมัติ']} />
                <span className="mk-lab">เมื่อ HR ปฏิเสธ ส่งกลับไปที่</span>
                <MkRow on>พนักงาน (แก้ไขและส่งใหม่)</MkRow>
                <MkRow>หัวหน้างาน</MkRow>
              </Desk>
            )}
            phone={(
              <Phone title="ตั้งค่าระบบ" bar={<MkSlot icon="sliders" label="เพิ่มเติม" on />}>
                <MkField label="หน้าตั้งค่า" on>นโยบายการคำนวณ</MkField>
                <span className="mk-lab">เมื่อ HR ปฏิเสธ ส่งกลับไปที่</span>
                <MkRow on>พนักงาน (แก้ไขและส่งใหม่)</MkRow>
                <MkRow>หัวหน้างาน</MkRow>
              </Phone>
            )}
          />
        </li>
      </ol>
    ),
  },

  {
    key: 'correct',
    group: 'งานฝ่ายบุคคลและผู้ดูแลระบบ',
    icon: 'pencil',
    title: 'แก้ใบย้อนหลัง',
    blurb: () => 'บทบาทเดียวที่แก้ตัวเลขในใบของคนอื่นได้',
    gate: (p) => p.correct,
    gateLabel: () => 'ฝ่ายบุคคลและผู้ดูแลระบบ',
    Body: () => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            <b>ระบบนี้ไม่มีการปิดงวด</b> — เดือนเก่ายังกลับเข้าไปแก้ได้
            ของจริงคือแฟ้มกระดาษที่เซ็นแล้ว ระบบจึงไม่ล็อกเดือน แต่บันทึกทุกการแก้ไว้แทน
          </p>
          <Diagram
            alt="เดือนเก่าไม่ถูกล็อก เลือกเดือนย้อนหลังได้ตามปกติ แก้ได้ และทุกการแก้ถูกบันทึกไว้พร้อมชื่อและเวลา"
            caption="ไม่มีปุ่มปิดงวดและไม่มีสถานะปิดงวดในระบบนี้ — สิ่งที่ทำหน้าที่แทนคือบันทึกว่าใครแก้อะไร"
          >
            <div className="mflow">
              <div className="mflow-node">
                <span className="mflow-k">เดือนเก่า</span>
                <span className="mflow-n">เลือกย้อนหลังได้</span>
                <span className="mflow-s">ไม่มีเดือนไหนถูกล็อก</span>
              </div>
              <span className="mflow-arrow" aria-hidden="true">→</span>
              <div className="mflow-node acc">
                <span className="mflow-k">แก้ได้</span>
                <span className="mflow-n">คงสถานะอนุมัติเดิม</span>
                <span className="mflow-s">ไม่ต้องให้ใครเซ็นซ้ำ</span>
              </div>
              <span className="mflow-arrow" aria-hidden="true">→</span>
              <div className="mflow-node done">
                <span className="mflow-k">แลกกับอะไร</span>
                <span className="mflow-n">ทุกการแก้ถูกบันทึก</span>
                <span className="mflow-s">ชื่อ เวลา ค่าเดิม และเหตุผล</span>
              </div>
            </div>
          </Diagram>
        </li>
        <li className="manual-step">
          <p>
            ทางเข้าอยู่ที่ <b>ตรวจสอบประจำเดือน</b> — หาคนที่ต้องการแล้วกด
            {' '}<b>ดู / แก้ไขรายการ</b> ท้ายแถว หน้าที่เปิดมาชื่อ <b>รายการ OT — ชื่อคนนั้น</b>
            {' '}แล้วจึงกด <b>แก้ไข</b> ที่ใบที่ต้องการ
          </p>
          <ul>
            <li>ฟอร์มที่เปิดมามีช่อง <b>เหตุผลการแก้ไข *</b> เพิ่มมาหนึ่งช่อง และ<b>บังคับกรอก</b> ปุ่มบันทึกจะกดไม่ได้จนกว่าจะกรอก</li>
            <li>แก้แล้วระบบคิดชั่วโมงใหม่ให้ทันที <b>โดยคงสถานะอนุมัติเดิมไว้</b> — ไม่ต้องสั่งคำนวณใหม่ และไม่ต้องให้ใครเซ็นซ้ำ</li>
          </ul>
          <Shot
            alt="ทางเข้าแก้ใบย้อนหลัง กดดูหรือแก้ไขรายการท้ายแถวในตรวจสอบประจำเดือน แล้วเปิดหน้ารายการ OT ของคนนั้น กดแก้ไขที่ใบที่ต้องการ ฟอร์มที่เปิดมามีช่องเหตุผลการแก้ไขที่บังคับกรอก"
            caption="ชื่อและวันที่ในภาพเป็นตัวอย่าง — ปุ่มบันทึกจะกดไม่ได้จนกว่าช่องเหตุผลจะมีข้อความ"
            desk={(
              <Desk title="ตรวจสอบประจำเดือน" nav={<MkRow on>ตรวจสอบประจำเดือน</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>สมชาย ใจดี · PM-0620</MkRow>
                  <span className="mk-acts"><MkBtn ghost>ดู / แก้ไขรายการ</MkBtn></span>
                </span>
                <span className="mk-headrow">
                  <MkRow>รายการ OT — สมชาย ใจดี</MkRow>
                  <span className="mk-acts"><MkBtn ghost>แก้ไข</MkBtn></span>
                </span>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">แก้ไขรายละเอียด (ฝ่ายบุคคล)</span>
                  <MkField label="เหตุผลการแก้ไข *" on>เช่น ปรับตามเวลาสแกนออกจริง</MkField>
                  <MkNote>บันทึกในประวัติรายการคู่กับค่าเดิมก่อนแก้</MkNote>
                  <MkBtn>บันทึกการแก้ไข</MkBtn>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="ตรวจสอบประจำเดือน" bar={<MkSlot icon="chart" label="รายงาน" on />}>
                <MkRow badge="›">สมชาย ใจดี · PM-0620</MkRow>
                <MkBtn ghost>ดู / แก้ไขรายการ</MkBtn>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">แก้ไขรายละเอียด (ฝ่ายบุคคล)</span>
                  <MkField label="เหตุผลการแก้ไข *" on>บังคับกรอก</MkField>
                  <MkBtn>บันทึกการแก้ไข</MkBtn>
                </span>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>
            ทุกการแก้<b>ขึ้นในประวัติของใบ</b> พร้อมชื่อและเวลา เก็บทั้งค่าเดิมและค่าใหม่
            และเข้า<b>บันทึกประวัติระบบ</b>ด้วย
          </p>
          <Shot
            alt="ประวัติของใบหลังการแก้ไขของฝ่ายบุคคล คอลัมน์แก้ไขในตารางบอกจำนวนครั้ง กดแล้วเห็นว่าใครแก้อะไร ค่าเดิมคืออะไร และเหตุผลว่าอย่างไร"
            caption="ตัวเลขและชื่อในภาพเป็นตัวอย่าง — คอลัมน์ แก้ไข บนตารางเดือนคือทางลัดไปที่บรรทัดเหล่านี้"
            desk={(
              <Desk title="ตรวจสอบประจำเดือน" nav={<MkRow on>ตรวจสอบประจำเดือน</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>สมชาย ใจดี · PM-0620</MkRow>
                  <span className="mk-acts">
                    <span className="mk-cell"><span className="mk-cell-k">แก้ไข</span><span className="mk-cell-v">2 ครั้ง</span></span>
                  </span>
                </span>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">ประวัติการแก้ไข</span>
                  <MkRow>แก้เวลาสิ้นสุด · โดยฝ่ายบุคคล · 11/09/2569 09:14</MkRow>
                  <MkNote>ค่าเดิมก่อนแก้ · เหตุผล: ปรับตามเวลาสแกนออกจริง</MkNote>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="ตรวจสอบประจำเดือน" bar={<MkSlot icon="chart" label="รายงาน" on />}>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">ประวัติการแก้ไข</span>
                  <MkRow>แก้เวลาสิ้นสุด · โดยฝ่ายบุคคล</MkRow>
                  <MkNote>ค่าเดิมก่อนแก้ · เหตุผล: ปรับตามเวลาสแกนออกจริง</MkNote>
                </span>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>
            แก้แล้วอย่าลืมว่า<b>แผ่นที่พิมพ์ไปแล้วยังเป็นของเก่า</b> ถ้าเข้าแฟ้มไปแล้วต้องพิมพ์ไปแทน
          </p>
          <Shot
            alt="ทางพิมพ์ใบใหม่หลังแก้ไข ปุ่มพิมพ์ F-HR-027 ท้ายแถวของคนนั้น หรือปุ่มพิมพ์ใบขออนุมัติ OT ทุกคนเมื่อจะพิมพ์ทั้งเดือนอีกครั้ง"
            caption="ระบบไม่รู้ว่าแผ่นไหนเข้าแฟ้มไปแล้ว — การพิมพ์ทับของเก่าจึงเป็นขั้นตอนของคน ไม่ใช่ของระบบ"
            desk={(
              <Desk title="ตรวจสอบประจำเดือน" nav={<MkRow on>ตรวจสอบประจำเดือน</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>สมชาย ใจดี · PM-0620</MkRow>
                  <span className="mk-acts">
                    <MkBtn ghost>พิมพ์ F-HR-027</MkBtn>
                    <MkBtn ghost>ดู / แก้ไขรายการ</MkBtn>
                  </span>
                </span>
                <MkBtn ghost>พิมพ์ใบขออนุมัติ OT ทุกคน (24 คน)</MkBtn>
              </Desk>
            )}
            phone={(
              <Phone title="ตรวจสอบประจำเดือน" bar={<MkSlot icon="chart" label="รายงาน" on />}>
                <MkRow badge="›">สมชาย ใจดี · PM-0620</MkRow>
                <MkBtn ghost>พิมพ์ F-HR-027</MkBtn>
              </Phone>
            )}
          />
        </li>
      </ol>
    ),
  },

  {
    key: 'settings',
    group: 'งานฝ่ายบุคคลและผู้ดูแลระบบ',
    icon: 'sliders',
    title: 'ตั้งค่าระบบ',
    blurb: () => 'นโยบายการคำนวณ · ทะเบียนพนักงาน · วันหยุด · แผนก',
    gate: (p) => p.correct,
    gateLabel: () => 'ฝ่ายบุคคลและผู้ดูแลระบบ',
    Body: () => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            <b>ตัวเลขจริงทั้งหมดอยู่ที่หน้านี้ ไม่ได้อยู่ในคู่มือ</b> — หน้านี้แบ่งเป็น
            {' '}<b>เจ็ดหัวข้อ</b> เปลี่ยนหัวข้อแล้วเนื้อข้างใต้เปลี่ยนตาม
          </p>
          <Shot
            alt="หน้าตั้งค่าระบบ บนคอมพิวเตอร์หัวข้อทั้งเจ็ดเป็นแถบปุ่มเรียงอยู่บนสุด บนมือถือหัวข้อเดียวกันกลายเป็นช่องเลือกชื่อ หน้าตั้งค่า"
            caption="เจ็ดหัวข้อเดียวกันทั้งสองเครื่อง — บนคอมพิวเตอร์เป็นแถบปุ่ม บนมือถือเป็นช่องเลือกที่กดแล้วเปิดเป็นแผ่นรายการ · เข้าถึงได้จากปุ่ม เพิ่มเติม ของแถบล่าง"
            desk={(
              <Desk title="ตั้งค่าระบบ" nav={<MkRow on>ตั้งค่าระบบ</MkRow>}>
                <MkTabs
                  on="แผนกและเพดาน"
                  items={['แผนกและเพดาน', 'พนักงาน', 'วันหยุดบริษัท', 'นโยบายการคำนวณ', 'ผู้รับช่วงอนุมัติ', 'ประวัติการแก้ทะเบียน', 'รหัสเอกสาร OT']}
                />
                <MkNote>หัวข้อที่เปิดอยู่เป็นปุ่มทึบ ที่เหลือเป็นปุ่มโปร่ง</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="ตั้งค่าระบบ" bar={<MkSlot icon="sliders" label="เพิ่มเติม" on />}>
                <MkField label="หน้าตั้งค่า" on>แผนกและเพดาน</MkField>
                <MkNote>กดที่ช่องแล้วหัวข้อทั้งเจ็ดเปิดขึ้นมาเป็นแผ่นรายการ</MkNote>
              </Phone>
            )}
          />
          <ul>
            <li><b>แผนกและเพดาน</b> — เพดานต่อเดือนและต่อสัปดาห์ · รูปแบบโอที · ผู้ถือลายเซ็นของแต่ละแผนก · มีตัวเลขเตือนบนหัวข้อนี้ถ้ามีแผนกที่ยังไม่มีหัวหน้าเซ็น</li>
            <li><b>พนักงาน</b> — ทะเบียนพนักงาน เพิ่มคน แก้บทบาท ย้ายแผนก รีเซ็ตรหัสผ่าน และนำเข้าจากไฟล์ CSV หรือ Excel</li>
            <li><b>วันหยุดบริษัท</b> — ปฏิทินวันหยุดตามประกาศของทั้งบริษัท</li>
            <li><b>นโยบายการคำนวณ</b> — เวลางานปกติ · การปัดเศษ · เวลาขั้นต่ำ · จำนวนวันที่ยื่นล่วงหน้าได้ · ปลายทางของใบที่ฝ่ายบุคคลตีกลับ</li>
            <li><b>ผู้รับช่วงอนุมัติ</b> — ตั้งผู้รับช่วงให้หัวหน้าที่ไม่อยู่</li>
            <li><b>ประวัติการแก้ทะเบียน</b> — ใครแก้ทะเบียนพนักงานไปบ้าง</li>
            <li><b>รหัสเอกสาร OT</b> — เลขคุมเอกสารที่พิมพ์อยู่บนใบ</li>
          </ul>
        </li>
        <li className="manual-step">
          <p>
            แก้<b>นโยบาย</b>ที่มีผลต่อการคำนวณแล้ว ระบบ<b>คำนวณใบที่ยังไม่อนุมัติใหม่ให้ทันที</b>
            {' '}ส่วน<b>ใบที่อนุมัติแล้วไม่ขยับ</b>
          </p>
          <ul>
            <li>ข้อความหลังบันทึกจะบอกว่าคำนวณใหม่ไปกี่รายการ และข้ามไปกี่รายการเพราะคำนวณใหม่ไม่ได้</li>
            <li>ระบบเก็บ<b>เวอร์ชันของนโยบาย</b>ไว้ พร้อมประวัติว่าใครแก้อะไรเมื่อไร และใบแต่ละใบจำได้ว่าคิดด้วยกฎเวอร์ชันไหน</li>
            <li>ข้อที่ไม่กระทบชั่วโมง หน้านั้นเขียนบอกไว้เองว่าไม่มีการคำนวณใหม่</li>
          </ul>
          <Shot
            alt="ข้อความหลังบันทึกนโยบาย บอกว่าบันทึกแล้ว บันทึกเป็นเวอร์ชันที่เท่าไร คำนวณรายการที่ยังไม่อนุมัติใหม่กี่รายการ และข้ามไปกี่รายการที่คำนวณใหม่ไม่ได้"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — บรรทัดนี้ขึ้นครั้งเดียวหลังกดบันทึก ถ้าต้องการอ่านย้อนหลังให้ดูที่ประวัติของนโยบาย"
            desk={(
              <Desk title="ตั้งค่าระบบ" nav={<MkRow on>ตั้งค่าระบบ</MkRow>}>
                <MkTabs on="นโยบายการคำนวณ" items={['วันหยุดบริษัท', 'นโยบายการคำนวณ', 'ผู้รับช่วงอนุมัติ']} />
                <span className="mk-alert ok">
                  <span className="mk-alert-t">บันทึกแล้ว · บันทึกเป็นเวอร์ชัน 7 · คำนวณรายการที่ยังไม่อนุมัติใหม่ 12 รายการ</span>
                </span>
                <MkNote>· ข้าม 2 รายการที่คำนวณใหม่ไม่ได้ ยังคงชั่วโมงเดิมไว้</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="ตั้งค่าระบบ" bar={<MkSlot icon="sliders" label="เพิ่มเติม" on />}>
                <span className="mk-alert ok">
                  <span className="mk-alert-t">บันทึกแล้ว · คำนวณรายการที่ยังไม่อนุมัติใหม่ 12 รายการ</span>
                </span>
                <MkNote>· ข้าม 2 รายการที่คำนวณใหม่ไม่ได้ ยังคงชั่วโมงเดิมไว้</MkNote>
              </Phone>
            )}
          />
        </li>
      </ol>
    ),
  },

  {
    key: 'logs',
    group: 'งานฝ่ายบุคคลและผู้ดูแลระบบ',
    icon: 'shield',
    title: 'บันทึกประวัติระบบ',
    blurb: () => 'หน้าจอเดียวที่ฝ่ายบุคคลเปิดไม่ได้',
    gate: (p) => p.logs,
    gateLabel: () => 'ผู้ดูแลระบบเท่านั้น',
    Body: () => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            <b>บันทึกประวัติระบบ</b> — ใครทำอะไรกับใบไหนและเมื่อไร
            ฝ่ายบุคคลเปิดหน้านี้ไม่ได้ เพราะบัญชีฝ่ายบุคคลใช้ร่วมกันหลายคน และชื่อฝ่ายบุคคลเองก็อยู่ในบันทึกนี้
          </p>
          <Shot
            alt="หน้าบันทึกประวัติระบบ อยู่ในบล็อกการตั้งค่าระบบของแถบเมนู ใต้ชื่อหน้ามีบรรทัดบอกว่าเก็บตามกฎหมาย เพิ่มได้อย่างเดียว ไม่เก็บรหัสผ่าน และรวมอยู่ในไฟล์สำรองข้อมูลรายวัน"
            caption="บรรทัดใต้ชื่อหน้าเป็นข้อความของหน้านั้นเอง — ไม่ต้องจำ และเป็นคำตอบสำเร็จรูปเวลาถูกถามว่าเก็บอะไรไว้บ้าง"
            desk={(
              <Desk
                title="บันทึกประวัติระบบ"
                nav={(
                  <>
                    <span className="mk-side-h">การตั้งค่าระบบ</span>
                    <MkRow>ตั้งค่าระบบ</MkRow>
                    <MkRow on>บันทึกประวัติระบบ</MkRow>
                  </>
                )}
              >
                <MkNote>
                  ระบบเก็บบันทึกตาม พ.ร.บ. คอมพิวเตอร์ มาตรา ๒๖ (ไม่น้อยกว่า 90 วัน) · เพิ่มได้อย่างเดียว
                  แก้หรือลบย้อนหลังไม่ได้ · ไม่เก็บเนื้อหาที่ส่งเข้ามาไม่ว่ารูปแบบใด รวมทั้งรหัสผ่าน ·
                  รวมอยู่ในไฟล์สำรองข้อมูลรายวัน
                </MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกประวัติระบบ" bar={<MkSlot icon="sliders" label="เพิ่มเติม" on />}>
                <MkNote>
                  ระบบเก็บบันทึกตาม พ.ร.บ. คอมพิวเตอร์ มาตรา ๒๖ (ไม่น้อยกว่า 90 วัน) · เพิ่มได้อย่างเดียว
                  แก้หรือลบย้อนหลังไม่ได้ · ไม่เก็บรหัสผ่าน
                </MkNote>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>หน้านี้มี<b>ห้าหัวข้อ</b> เรียงตามลำดับที่คนเดินมาถึงมัน</p>
          <ul>
            <li><b>ภาพรวม</b> — มีอะไรที่ควรดูไหม ถามก่อนที่จะรู้ว่ากำลังหาอะไร กดที่ตัวเลขแล้วกระโดดไปที่รายการที่กรองไว้ให้แล้ว</li>
            <li><b>การเข้าใช้งาน</b> — เข้าระบบ เข้าไม่สำเร็จ และออกจากระบบ</li>
            <li><b>การแก้ไขข้อมูล</b> — ทุกคำขอที่ตั้งใจจะเปลี่ยนอะไรสักอย่าง</li>
            <li><b>ทั้งหมด</b> — รวมการเปิดอ่านด้วย ใช้ตอบว่าบัญชีนี้เปิดดูอะไรไปบ้าง</li>
            <li><b>การใช้สิทธิ์พิเศษ</b> — สิ่งที่ตามกฎแล้วจะถูกปฏิเสธ แต่ถูกอนุญาตไว้พร้อมเหตุผล</li>
          </ul>
          <Shot
            alt="ห้าหัวข้อของบันทึกประวัติระบบเป็นแถบปุ่มบนสุด หัวข้อภาพรวมเป็นการ์ดตัวเลขที่กดแล้วกระโดดไปที่รายการที่กรองไว้ให้แล้ว"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — การ์ดในภาพรวมกดได้ทุกใบ กดแล้วไปโผล่ที่รายการที่กรองไว้ตามการ์ดนั้น"
            desk={(
              <Desk title="บันทึกประวัติระบบ" nav={<MkRow on>บันทึกประวัติระบบ</MkRow>}>
                <MkTabs
                  on="ภาพรวม"
                  items={['ภาพรวม', 'การเข้าใช้งาน', 'การแก้ไขข้อมูล', 'ทั้งหมด', 'การใช้สิทธิ์พิเศษ']}
                />
                <span className="mk-three">
                  <span className="mk-cell"><span className="mk-cell-k">เข้าสู่ระบบสำเร็จ</span><span className="mk-cell-v">142</span></span>
                  <span className="mk-cell"><span className="mk-cell-k">กรอกรหัสผ่านผิด</span><span className="mk-cell-v warn">9</span></span>
                  <span className="mk-cell"><span className="mk-cell-k">คำสั่งที่แก้ไขข้อมูล</span><span className="mk-cell-v">63</span></span>
                </span>
                <MkRow>ปริมาณการใช้งานรายวัน</MkRow>
                <MkRow>รหัสที่ถูกลองแล้วไม่ผ่าน</MkRow>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกประวัติระบบ" bar={<MkSlot icon="sliders" label="เพิ่มเติม" on />}>
                <MkTabs
                  on="ภาพรวม"
                  items={['ภาพรวม', 'การเข้าใช้งาน', 'การแก้ไขข้อมูล', 'ทั้งหมด', 'การใช้สิทธิ์พิเศษ']}
                />
                <span className="mk-cell"><span className="mk-cell-k">เข้าสู่ระบบสำเร็จ</span><span className="mk-cell-v">142</span></span>
                <span className="mk-cell"><span className="mk-cell-k">กรอกรหัสผ่านผิด</span><span className="mk-cell-v warn">9</span></span>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>
            <b>ลบหรือแก้บันทึกไม่ได้ และไม่มีปุ่มให้กด</b> — บันทึกนี้เพิ่มได้อย่างเดียว
            เก็บตาม พ.ร.บ. คอมพิวเตอร์ ไม่น้อยกว่า 90 วัน ไม่เก็บเนื้อหาที่ส่งเข้ามารวมทั้งรหัสผ่าน
            และรวมอยู่ในไฟล์สำรองข้อมูลรายวัน — ข้อความนี้เขียนอยู่ใต้ชื่อหน้าแล้ว
          </p>
          <Shot
            alt="รายการในบันทึกประวัติระบบ แต่ละแถวมีเวลา บัญชีที่ทำ คำสั่ง และผลลัพธ์ ท้ายแถวไม่มีปุ่มใดเลย ทั้งลบและแก้"
            caption="สิ่งที่ไม่มีในภาพคือประเด็น — ไม่มีปุ่มลบ ไม่มีปุ่มแก้ และไม่มีทางกดให้แถวหายไป"
            desk={(
              <Desk title="บันทึกประวัติระบบ" nav={<MkRow on>บันทึกประวัติระบบ</MkRow>}>
                <MkCols>เวลา · บัญชี · คำสั่ง · ผลลัพธ์ · หมายเลขไอพี</MkCols>
                <MkRow>11/09/2569 09:14 · hr01 · แก้ไขรายการ OT · สำเร็จ</MkRow>
                <MkRow>11/09/2569 08:02 · PM-0620 · เข้าสู่ระบบ · สำเร็จ</MkRow>
                <MkNote>ไม่มีปุ่มท้ายแถว — บันทึกนี้เพิ่มได้อย่างเดียว</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกประวัติระบบ" bar={<MkSlot icon="sliders" label="เพิ่มเติม" on />}>
                <MkRow>11/09/2569 09:14 · hr01 · แก้ไขรายการ OT</MkRow>
                <MkRow>11/09/2569 08:02 · PM-0620 · เข้าสู่ระบบ</MkRow>
                <MkNote>ไม่มีปุ่มท้ายแถว — บันทึกนี้เพิ่มได้อย่างเดียว</MkNote>
              </Phone>
            )}
          />
        </li>
      </ol>
    ),
  },

  {
    key: 'rules',
    group: 'อ่านก่อนใช้งาน',
    icon: 'clock',
    title: 'ระบบคิดชั่วโมงให้อย่างไร',
    blurb: () => 'ช่องอัตรา · พักเที่ยง · การปัดเศษ · เพดาน · วันเกิด',
    gate: () => true,
    gateLabel: () => 'ทุกบทบาท',
    Body: () => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p><b>ไม่ต้องคิดชั่วโมงเอง</b> ระบบคิดให้ตั้งแต่ตอนกรอก และคิดใหม่ทุกครั้งที่มีการแก้ใบ</p>
          <RateDiagram />
          <p className="hint">ระบบตัดเองว่าช่วงไหนอยู่ในเวลางานปกติ ช่วงไหนเป็น OT แล้วเข้าคนละช่องให้อัตโนมัติ</p>
        </li>
        <li className="manual-step">
          <p>สิ่งที่ระบบทำให้เงียบ ๆ</p>
          <ul>
            <li><b>หักพักเที่ยง</b> เฉพาะใบที่คร่อมช่วงพักกลางวัน ใบที่ไม่แตะช่วงนั้นไม่ถูกหัก</li>
            <li><b>ปัดเศษ</b> เป็นบล็อกเท่า ๆ กัน และปัดแยกทีละช่องอัตรา ยอดสามช่องจึงบวกกันได้เท่ากับยอดรวมพอดี</li>
            <li><b>เวลาขั้นต่ำ</b> ทำไม่ถึงเกณฑ์แล้วจะเป็นอย่างไร ฝ่ายบุคคลเป็นคนเลือก — รับตามจริงแล้วติดธง ปัดขึ้นเป็นขั้นต่ำ หรือไม่รับรายการ</li>
            <li><b>เสาร์-อาทิตย์และวันหยุดตามประกาศ</b> คิดเป็นวันหยุด ปฏิทินวันหยุดฝ่ายบุคคลเป็นคนตั้ง</li>
          </ul>
          <Diagram
            alt="ลำดับที่ระบบทำกับชั่วโมงของใบหนึ่งใบ เริ่มจากชั่วโมงตามนาฬิกา หักพักเที่ยงเฉพาะใบที่คร่อมช่วงพัก แล้วปัดเศษแยกทีละช่องอัตรา จึงได้ชั่วโมงที่บันทึก"
            caption="ไม่มีตัวเลขในภาพนี้โดยตั้งใจ — ช่วงพักและขนาดบล็อกการปัดเศษเป็นค่าที่ฝ่ายบุคคลตั้งเองที่ ตั้งค่าระบบ"
          >
            <div className="mflow">
              <div className="mflow-node acc">
                <span className="mflow-k">ตั้งต้น</span>
                <span className="mflow-n">ชั่วโมงตามนาฬิกา</span>
                <span className="mflow-s">จากเวลาเริ่มถึงเวลาสิ้นสุดที่กรอก</span>
              </div>
              <span className="mflow-arrow" aria-hidden="true">→</span>
              <div className="mflow-node">
                <span className="mflow-k">หักพักเที่ยง</span>
                <span className="mflow-n">เฉพาะใบที่คร่อมช่วงพัก</span>
                <span className="mflow-s">ใบที่ไม่แตะช่วงนั้นไม่ถูกหัก</span>
              </div>
              <span className="mflow-arrow" aria-hidden="true">→</span>
              <div className="mflow-node">
                <span className="mflow-k">ปัดเศษ</span>
                <span className="mflow-n">แยกทีละช่องอัตรา</span>
                <span className="mflow-s">สามช่องจึงบวกกันได้เท่ากับยอดรวมพอดี</span>
              </div>
              <span className="mflow-arrow" aria-hidden="true">→</span>
              <div className="mflow-node done">
                <span className="mflow-k">ผลลัพธ์</span>
                <span className="mflow-n">ชั่วโมงที่บันทึก</span>
                <span className="mflow-s">ตัวเลขเดียวกับที่พิมพ์ลงใบ</span>
              </div>
            </div>
          </Diagram>
        </li>
        <li className="manual-step">
          <p><b>เพดาน OT</b> ตั้งไว้ที่ระดับแผนก ทั้งต่อเดือนและต่อสัปดาห์ แต่ <b>วัดรายคน</b></p>
          <ul>
            <li>นับชั่วโมงจริงไม่ใช่ชั่วโมงคูณอัตรา และนับรวมใบที่ยังรออนุมัติด้วย</li>
            <li>
              <b>ตามค่าปกติ ชนเพดานแล้วระบบยังรับใบ แต่ติดธงไว้ให้ฝ่ายบุคคลเห็น</b> ไม่ได้ปฏิเสธทิ้ง ·
              ฝ่ายบุคคลเปลี่ยนเป็นให้ปิดกั้นไม่รับใบที่เกินได้ที่ <b>ตั้งค่าระบบ</b>
            </li>
          </ul>
          <Shot
            alt="ที่ที่เพดานถูกตั้ง หัวข้อแผนกและเพดานเป็นตารางที่มีช่องเพดานชั่วโมงต่อเดือนและต่อสัปดาห์ของแต่ละแผนก ส่วนพฤติกรรมเมื่อเกินเพดานอยู่ในหัวข้อนโยบายการคำนวณ"
            caption="คู่มือไม่เขียนตัวเลขเพดานไว้ เพราะเป็นค่าที่ตั้งได้รายแผนกและเปลี่ยนได้ทุกเมื่อ — หน้านี้คือที่ที่ค่าจริงอยู่"
            desk={(
              <Desk title="ตั้งค่าระบบ" nav={<MkRow on>ตั้งค่าระบบ</MkRow>}>
                <MkTabs on="แผนกและเพดาน" items={['แผนกและเพดาน', 'พนักงาน', 'วันหยุดบริษัท', 'นโยบายการคำนวณ']} />
                <MkCols>รหัส · ชื่อแผนก · หัวหน้างาน · จำนวนคน · เพดาน ชม./เดือน · เพดาน ชม./สัปดาห์ · สถานะ</MkCols>
                <MkRow>PRD · ฝ่ายผลิต · สมหญิง ผู้ดูแลสาย</MkRow>
                <span className="mk-lab">เมื่อเกินเพดานแผนก (อยู่ในหัวข้อ นโยบายการคำนวณ)</span>
                <MkRow on>เตือนแต่ให้ส่งได้ ให้ HR ตัดสิน</MkRow>
                <MkRow>ไม่ให้ส่ง</MkRow>
              </Desk>
            )}
            phone={(
              <Phone title="ตั้งค่าระบบ" bar={<MkSlot icon="sliders" label="เพิ่มเติม" on />}>
                <MkField label="หน้าตั้งค่า" on>แผนกและเพดาน</MkField>
                <MkRow>ฝ่ายผลิต · เพดาน ชม./เดือน · ชม./สัปดาห์</MkRow>
                <span className="mk-lab">เมื่อเกินเพดานแผนก</span>
                <MkRow on>เตือนแต่ให้ส่งได้ ให้ HR ตัดสิน</MkRow>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>
            <b>วันเกิด</b>ของพนักงานนับเป็นวันหยุดของคนนั้นคนเดียว มาทำงานวันนั้นได้อัตราวันหยุด
            ยื่นเหมือนใบ OT ปกติทุกอย่าง ไม่ต้องติ๊กอะไรเพิ่ม เลือกวันที่ให้ตรงก็พอ
            ระบบอ่านวันเกิดจากทะเบียนพนักงานแล้วขึ้นข้อความบอกบนฟอร์มก่อนกดบันทึก
            วันเกิดเป็นข้อมูลที่เพื่อนร่วมงานมองไม่เห็น
          </p>
          <Shot
            alt="ข้อความวันเกิดบนฟอร์ม เป็นแถบสีฟ้าใต้ช่องวันที่ บอกว่าช่วงเวลาที่ยื่นตรงกับวันเกิดของคุณ ซึ่งนับเป็นวันหยุดของคุณคนเดียว และระบบคิดให้อัตโนมัติ ไม่มีช่องติ๊กใดให้กด"
            caption="ไม่มีช่องติ๊กวันเกิดบนฟอร์ม — สิ่งที่ต้องทำคือเลือกวันที่ให้ตรง แล้วอ่านแถบนี้ว่าขึ้นหรือไม่"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <MkField label="วันที่เริ่ม" on>12/09/2569</MkField>
                <span className="mk-alert info">
                  <span className="mk-alert-t">
                    ช่วงเวลาที่ยื่นนี้ตรงกับวันเกิดของคุณ ซึ่งนับเป็นวันหยุดของคุณคนเดียว —
                    ระบบคิดสวัสดิการวันเกิดให้อัตโนมัติ ไม่ต้องติ๊กอะไรเพิ่ม
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkField label="วันที่เริ่ม" on>12/09/2569</MkField>
                <span className="mk-alert info">
                  <span className="mk-alert-t">ช่วงเวลาที่ยื่นนี้ตรงกับวันเกิดของคุณ — ระบบคิดให้อัตโนมัติ</span>
                </span>
              </Phone>
            )}
          />
          <p className="hint">
            ตัวเลขจริงที่ใช้อยู่ — เวลางานปกติ ขนาดบล็อกการปัดเศษ เวลาขั้นต่ำ เพดานของแต่ละแผนก
            และจำนวนวันที่ยื่นล่วงหน้าได้ — ฝ่ายบุคคลตั้งเองได้ที่หน้า <b>ตั้งค่าระบบ</b> จึงไม่เขียนไว้ในคู่มือ
            ให้ดูค่าที่ใช้อยู่จริงจากหน้านั้น
          </p>
        </li>
      </ol>
    ),
  },

  {
    key: 'help',
    group: 'อ่านก่อนใช้งาน',
    icon: 'search',
    title: 'ปัญหาที่พบบ่อย',
    blurb: () => 'อาการที่เจอบ่อย และให้ไปดูตรงไหน',
    gate: () => true,
    gateLabel: () => 'ทุกบทบาท',
    Body: ({ p }) => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p><b>เข้าระบบไม่ได้</b></p>
          <ul>
            <li>ขีดกลางในรหัสพนักงานไม่มีผล · แต่<b>รหัสผ่าน</b>ต้องตรงตัว เป็นตัวพิมพ์ใหญ่ตามที่อยู่บนบัตร รวมขีดกลางถ้ามี</li>
            <li>รหัสผ่านครั้งแรกคือรหัสพนักงานของตัวเอง · กรอกผิดหลายครั้งต้องรอสักครู่ · ยังไม่ได้ให้ติดต่อฝ่ายบุคคล</li>
          </ul>
          <Shot
            alt="หน้าเข้าสู่ระบบตอนกรอกไม่ผ่าน มีข้อความสีแดงว่ารหัสพนักงานหรือรหัสผ่านไม่ถูกต้องอยู่ใต้ช่องกรอก และไม่มีปุ่มลืมรหัสผ่านอยู่บนหน้าจอเลย"
            caption="ข้อความเดียวกันนี้ขึ้นทั้งกรณีรหัสพนักงานผิดและรหัสผ่านผิด — ระบบไม่บอกว่าผิดข้างไหน และไม่มีปุ่มลืมรหัสผ่านให้กด"
            desk={(
              <Desk nav={false}>
                <span className="mk-split">
                  <span className="mk-pane">
                    <span className="mk-pane-k">PRIMUS · OVERTIME SYSTEM</span>
                    <span className="mk-pane-h">ระบบบันทึกและอนุมัติค่าล่วงเวลา</span>
                  </span>
                  <span className="mk-col">
                    <MkField label="รหัสพนักงาน · EMPLOYEE ID">PM00111 / THT1111</MkField>
                    <MkField label="รหัสผ่าน · PASSWORD">••••••••</MkField>
                    <span className="mk-alert no">
                      <span className="mk-alert-t">รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง</span>
                    </span>
                    <MkBtn>เข้าสู่ระบบ</MkBtn>
                    <MkNote>เข้าไม่ได้จริง ๆ ให้ติดต่อฝ่ายบุคคล — ไม่มีปุ่มลืมรหัสผ่าน</MkNote>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone bar={false}>
                <MkField label="รหัสพนักงาน · EMPLOYEE ID">PM00111 / THT1111</MkField>
                <MkField label="รหัสผ่าน · PASSWORD">••••••••</MkField>
                <span className="mk-alert no">
                  <span className="mk-alert-t">รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง</span>
                </span>
                <MkBtn>เข้าสู่ระบบ</MkBtn>
                <MkNote>ไม่มีปุ่มลืมรหัสผ่าน — ติดต่อฝ่ายบุคคล</MkNote>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p><b>ยื่นใบแล้วเงียบ</b></p>
          <ul>
            <li>ดูป้ายสถานะบนแถวนั้น ถ้าเป็น <b>รอหัวหน้า</b> แปลว่ายังรอลายเซ็นขั้นแรกอยู่</li>
            <li>ถ้าแผนกไม่มีคนเซ็นขั้นแรก ใบจะไปรอฝ่ายบุคคลแทน</li>
          </ul>
          <Shot
            alt="การดูว่าใบค้างอยู่ที่ใคร กดที่แถวของใบแล้วในแผ่นรายละเอียดมีหัวข้อผู้อนุมัติ บอกว่าขั้นไหนเซ็นแล้วและขั้นไหนยังรออยู่"
            caption="วันที่และชื่อในภาพเป็นตัวอย่าง — ป้ายบนแถวบอกว่าค้างขั้นไหน ส่วนหัวข้อผู้อนุมัติในแผ่นรายละเอียดบอกว่าค้างอยู่ที่ใคร"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>10/09/2569 · 21:00–02:00</MkRow>
                  <span className="mk-acts"><MkChip tone="wait">รอหัวหน้า</MkChip></span>
                </span>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">ผู้อนุมัติ</span>
                  <MkRow>ขั้นที่ 1 · หัวหน้างาน · ยังไม่เซ็น</MkRow>
                  <MkRow>ขั้นที่ 2 · ฝ่ายบุคคล · ยังไม่ถึงคิว</MkRow>
                </span>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkRow badge="›">10/09/2569 · 21:00–02:00</MkRow>
                <span className="mk-acts"><MkChip tone="wait">รอหัวหน้า</MkChip></span>
                <span className="mk-dlg">
                  <span className="mk-dlg-h">ผู้อนุมัติ</span>
                  <MkRow>ขั้นที่ 1 · หัวหน้างาน · ยังไม่เซ็น</MkRow>
                </span>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p><b>ตัวเลขในใบผิด</b></p>
          <ul>
            {p.correct ? (
              <li>คุณแก้ได้เอง — ดูหัวข้อ <b>แก้ใบย้อนหลัง</b> และอย่าลืมว่าแผ่นที่พิมพ์ไปแล้วเป็นของเก่า</li>
            ) : (
              <li>ถ้ายังไม่มีใครเซ็น แก้เองได้ ถ้าเซ็นไปแล้วให้แจ้งฝ่ายบุคคลแก้ให้ หรือกดขอถอนใบแล้วยื่นใหม่</li>
            )}
          </ul>
          <Shot
            alt="ปุ่มที่มีให้เลือกเมื่อตัวเลขในใบผิด แถวที่ยังไม่มีใครเซ็นมีปุ่มแก้ไข ส่วนแถวที่เซ็นไปแล้วเหลือปุ่มขอถอนใบ และฝ่ายบุคคลแก้ให้ได้จากหน้าตรวจสอบประจำเดือน"
            caption="วันที่ในภาพเป็นตัวอย่าง — ทางไหนใช้ได้ขึ้นกับป้ายบนแถวนั้น ไม่ใช่เลือกได้ทุกทางเสมอ"
            desk={(
              <Desk title="บันทึกและประวัติ OT" nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>10/09/2569 · ยังไม่มีใครเซ็น</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="wait">รอหัวหน้า</MkChip>
                    <MkBtn ghost>แก้ไข</MkBtn>
                  </span>
                </span>
                <span className="mk-headrow">
                  <MkRow>05/09/2569 · เซ็นไปแล้ว</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="ok">อนุมัติ</MkChip>
                    <MkBtn ghost>ขอถอนใบ</MkBtn>
                  </span>
                </span>
                <MkNote>ฝ่ายบุคคลแก้ตัวเลขให้ได้จาก ตรวจสอบประจำเดือน → ดู / แก้ไขรายการ</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="บันทึกและประวัติ OT" bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkRow badge="›">10/09/2569 · รอหัวหน้า → แก้ไข</MkRow>
                <MkRow badge="›">05/09/2569 · อนุมัติ → ขอถอนใบ</MkRow>
                <MkNote>ปุ่มอยู่ท้ายแผ่นรายละเอียดที่เปิดจากแถว</MkNote>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p><b>ไม่เห็นเมนูที่เพื่อนเห็น</b></p>
          <ul>
            <li>เมนูขึ้นตามบทบาทที่ฝ่ายบุคคลตั้งไว้ในทะเบียนพนักงาน คู่มือหน้านี้ก็แสดงเฉพาะหัวข้อที่บทบาทของคุณใช้ได้เช่นกัน</li>
          </ul>
          <Shot
            alt="ที่ที่อ่านบทบาทของตัวเองได้ หน้าข้อมูลส่วนตัว การ์ดแรกมีบรรทัดบทบาทอยู่ในนั้น อ่านได้อย่างเดียว ถ้าไม่ถูกต้องต้องแจ้งฝ่ายบุคคล"
            caption="บทบาทเป็นสิ่งที่ฝ่ายบุคคลตั้งในทะเบียนพนักงาน — หน้านี้เป็นที่อ่าน ไม่ใช่ที่แก้"
            desk={(
              <Desk
                title="ข้อมูลส่วนตัว"
                nav={(
                  <span className="mk-side-foot">
                    <MkRow on pin="›">ชื่อของคุณ · {p.label}</MkRow>
                  </span>
                )}
              >
                <MkRow>ข้อมูลส่วนตัว</MkRow>
                <MkField label="บทบาท" on>{p.label}</MkField>
                <MkNote>หากมีข้อมูลใดไม่ถูกต้อง กรุณาแจ้งฝ่ายบุคคลเพื่อแก้ไข</MkNote>
              </Desk>
            )}
            phone={(
              <Phone title="ข้อมูลส่วนตัว" bar={<MkSlot icon="clock" label="ประวัติ OT" />}>
                <MkNote>ปุ่มตัวอักษรย่อมุมบนขวา → กลุ่ม บัญชี → ข้อมูลส่วนตัว</MkNote>
                <MkField label="บทบาท" on>{p.label}</MkField>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p><b>ระบบเข้าไม่ได้ทั้งระบบ</b></p>
          <ul>
            <li>กลับไปใช้กระดาษ F-HR-027 ตามปกติก่อน แล้วคีย์กลับเข้าระบบเมื่อใช้ได้ ฝ่ายบุคคลมีขั้นตอนสำหรับกรณีนี้อยู่แล้ว</li>
          </ul>
          {/* No screen to draw — the case is that there is no screen. One
              drawing, not two, for the same reason FlowDiagram takes no
              device. */}
          <Diagram
            alt="เมื่อระบบเข้าไม่ได้ทั้งระบบ ให้กลับไปใช้กระดาษ F-HR-027 เซ็นตามปกติ แล้วคีย์กลับเข้าระบบเมื่อใช้ได้ ชั่วโมงจึงไม่หายไป"
            caption="กระดาษที่เซ็นแล้วยังเป็นตัวจริงของเรื่องนี้อยู่ — ระบบล่มจึงเป็นเรื่องช้าลง ไม่ใช่เรื่องชั่วโมงหาย"
          >
            <div className="mflow">
              <div className="mflow-node gone">
                <span className="mflow-k">ตอนนี้</span>
                <span className="mflow-n">ระบบเข้าไม่ได้</span>
                <span className="mflow-s">ทั้งคอมพิวเตอร์และมือถือ</span>
              </div>
              <span className="mflow-arrow" aria-hidden="true">→</span>
              <div className="mflow-node acc">
                <span className="mflow-k">ระหว่างนั้น</span>
                <span className="mflow-n">ใช้กระดาษ F-HR-027</span>
                <span className="mflow-s">กรอกและเซ็นตามขั้นตอนเดิม</span>
              </div>
              <span className="mflow-arrow" aria-hidden="true">→</span>
              <div className="mflow-node done">
                <span className="mflow-k">เมื่อกลับมา</span>
                <span className="mflow-n">คีย์กลับเข้าระบบ</span>
                <span className="mflow-s">ฝ่ายบุคคลมีขั้นตอนสำหรับกรณีนี้อยู่แล้ว</span>
              </div>
            </div>
          </Diagram>
        </li>
      </ol>
    ),
  },
];

/**
 * The หัวข้อ this reader is shown, in the order `SECTIONS` stands them in.
 *
 * A FILTER AND NOT A SORT, the same cut `navGroups` makes and for the same
 * reason: the rail groups these under headings and the page prints them in one
 * column, and if either re-sorted, one manual would have two orders.
 */
export const sectionsFor = (p) => SECTIONS.filter((s) => s.gate(p));

/**
 * ── คู่มือเป็นไฟล์ PDF, หัวข้อไหนบ้างก็ได้ ─────────────────────────────────
 *
 * IT IS THE APP'S ONE PRINT PATH, NOT A SECOND ONE. `PrintChrome` draws the bar
 * and `savePdf` sends `printableBody()` — the DOM with everything `no-print`
 * taken out of it — to `/api/print/pdf`, exactly as F-HR-027, ใบบัญชี and
 * ใบสรุปแผนก do. So there is nothing here that assembles a document: what the
 * server turns into a PDF is the sheets below, as they stand on the screen, and
 * the ticks decide which of them are on the screen at all.
 *
 * THE LIST OFFERED IS THE GATED LIST, which is what the gating buys on paper.
 * ฝ่ายบุคคล printing the manual for a production line now gets the eight หัวข้อ
 * a พนักงาน has — no ตั้งค่าระบบ page in a stack being handed out at a training
 * session. It is also why `picked` is seeded from `visible` rather than from
 * `SECTIONS`: seeded from all of them, a พนักงาน's first press of บันทึกเป็น PDF
 * would silently drop ten ticks it never showed them.
 *
 * THE ORDER IS `SECTIONS`, NEVER THE ORDER THE TICKS WERE MADE. `picked` is a
 * set of keys and the sheets are `visible.filter(…)`, so a reader who ticks
 * ปัญหาที่พบบ่อย first and เริ่มต้นใช้งาน second still gets the manual in the
 * order the page lists it. A file whose pages are in the order somebody
 * happened to click is a file that reads differently every time it is made.
 *
 * ONE หัวข้อ PER PAGE — `.manual-sheet + .manual-sheet { break-before: page }`
 * in app/print.css, the same rule and the same spelling `.f027`, `.acct` and
 * `.otdept` use. A หัวข้อ longer than one side flows onto the next, which is
 * what a manual should do; what it must not do is start halfway down the page
 * the previous one ended on.
 */
function ManualPrint({ visible, ctx, picked, onPick, onClose }) {
  /* The file, in page order. `picked` decides membership and nothing else. */
  const sheets = visible.filter((s) => picked.includes(s.key));

  const toggle = (key) => onPick(
    picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key],
  );

  return (
    <div className="stack manual-page">
      <div className="card no-print">
        <h2>บันทึกคู่มือเป็นไฟล์ PDF</h2>
        <div className="hint">
          ติ๊กหัวข้อที่ต้องการ แล้วกดปุ่มด้านล่าง — หน้ากระดาษที่จะได้คือสิ่งที่เห็นอยู่ใต้ปุ่มนั้น
        </div>
        <div className="field">
          {/* THE COUNT IS DRAWN AT NOUGHT TOO, for the reason the same line on
              บันทึกแทนพนักงาน gives: it is the plainest statement of why the
              two buttons below are shut, and a counter that appears only once
              something is ticked is one a reader has to catch ARRIVING. */}
          <label>หัวข้อที่จะพิมพ์ (เลือกแล้ว {sheets.length} จาก {visible.length} หัวข้อ)</label>
          <div className="pick-list">
            {visible.map((s) => (
              <label key={s.key} className="check">
                <input
                  type="checkbox"
                  checked={picked.includes(s.key)}
                  onChange={() => toggle(s.key)}
                />
                {/* One element, not two text nodes — `.check` is a flex row and
                    bare siblings become separate flex items 9px apart. */}
                <span>{s.title}</span>
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8, gap: 12 }}>
            {/* Adds rather than replaces, the shape `เลือกทั้งหมด` on the OT
                form takes: it cannot lose a tick, and it stays correct on the
                day this list is narrowed by anything — which it now is, by
                บทบาท, on every render. */}
            <button
              type="button"
              className="btn ghost"
              onClick={() => onPick([
                ...picked,
                ...visible.map((s) => s.key).filter((k) => !picked.includes(k)),
              ])}
              disabled={sheets.length === visible.length}
            >
              เลือกทั้งหมด ({visible.length})
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => onPick([])}
              disabled={sheets.length === 0}
            >
              ล้างที่เลือก
            </button>
          </div>
        </div>
      </div>

      {/* `graphics={false}` — the hint about ticking กราฟิกพื้นหลัง is for the
          sheets whose meaning is carried by a coloured band behind a table
          heading. Nothing on these pages is: the mocks are hairline boxes and
          the tinted things — a chip, a highlighted field — all keep a border
          either way. A setup line telling somebody to change a setting that
          changes nothing is a line that costs trust in the other three. */}
      <PrintChrome
        onClose={onClose}
        disabled={sheets.length === 0}
        graphics={false}
        filename={printName.manual({ count: sheets.length })}
        hints={[{
          label: 'หมายเหตุ',
          text: '1 หัวข้อต่อ 1 หน้า · หัวข้อที่ยาวกว่าหนึ่งหน้าจะไหลต่อในหน้าถัดไป',
        }]}
      />

      {sheets.length === 0 ? (
        /* `no-print` — with nothing ticked both buttons are shut, so this can
           only be reached by a browser's own Ctrl+P, and a sheet of paper
           reading "ยังไม่ได้เลือกหัวข้อ" is not a document. */
        <div className="no-print">
          <Empty>ยังไม่ได้เลือกหัวข้อ — ติ๊กอย่างน้อยหนึ่งหัวข้อจึงจะพิมพ์ได้</Empty>
        </div>
      ) : (
        <div className="manual-print">
          {sheets.map((s) => (
            <article key={s.key} className="manual-sheet">
              {/* The running head. Every page of a manual that leaves the
                  building on paper has to say which manual it is — a หัวข้อ
                  photocopied on its own is otherwise four pages of unattributed
                  instructions about somebody's overtime. The บทบาท is on it
                  now as well, because the stack is no longer the same stack for
                  everybody: a page saying ตั้งค่าระบบ and a page saying
                  บันทึกใบขอ OT can come from two different printings. */}
              <header className="manual-sheet-head">
                <span>คู่มือการใช้งาน · ระบบขออนุมัติทำงานล่วงเวลา</span>
                <span>ฉบับของ {ctx.p.label} · Primus Instrument Co., Ltd.</span>
              </header>
              <h2 className="manual-sheet-title">{s.title}</h2>
              <div className="manual-body"><s.Body {...ctx} /></div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ── THE RAIL ───────────────────────────────────────────────────────────────
 *
 * The same list twice over is what this is NOT: it is one list, drawn as a
 * column beside the text on a desktop and as a list that opens downwards from a
 * pinned row on a phone — a phone has no room for a column beside anything, and
 * (since 2026-09-10) no patience for one laid on its side either.
 *
 * PLAIN ANCHORS AND NOT BUTTONS. `#sec-approve` is a real address: it survives
 * a reload, it can be sent to somebody, and the browser's own smooth scroll
 * (`scroll-behavior` on the page, honouring `prefers-reduced-motion`) does the
 * moving. A button with an `onClick` calling `scrollIntoView` would be a
 * hand-built copy of all three, and would take the หัวข้อ off the back stack.
 *
 * NO SCROLL-SPY, DELIBERATELY. A rail that re-marks itself while the reader
 * scrolls needs an observer, a threshold, and an answer for the last section
 * being too short to ever win — three things to get wrong in exchange for a
 * moving highlight on a page that is at most eighteen headings long. `:target`
 * marks the one the reader actually jumped to, which is the question they asked.
 *
 * ── ⚠ ON A PHONE IT WAS A STRIP OF CHIPS, AND IT WAS REPORTED AS UNUSABLE ───
 *
 * *แถบเลือกหัวข้อ ค่อนข้างใช้งานยาก*, 2026-09-10. Measured on a 390px screen
 * before it was changed: the strip is 366px wide and 54px tall, a chip is 116px
 * wide and **32px** tall, so **two and a half of the eight หัวข้อ a พนักงาน has
 * were on screen** — ผู้ดูแลระบบ has fifteen — and the rest were reached by
 * swiping a bar sideways with no scrollbar, no edge fade and nothing saying how
 * much of it is left. The chips are also under the 44px a finger is drawn
 * against, and the group headings were switched off (`.manual-rail-h`) because
 * a heading cannot be a chip in a row, so the strip was a flat list of Thai
 * titles with no orientation in it at all.
 *
 * IT IS THE SAME LIST, GIVEN THE AXIS THE PHONE HAS. A phone is short of width
 * and long on height, so the list opens DOWNWARDS: one full-width row saying
 * ไปที่หัวข้อ and how many there are, and under it the whole rail — headings
 * back, one 44px row per หัวข้อ, all of them visible without a sideways swipe.
 * The panel is what scrolls when there are fifteen, and it scrolls the way the
 * page does.
 *
 * ONE PIECE OF STATE AND NOTHING ELSE. `open` draws a class; the links under it
 * are the same plain anchors they are on a desktop, so the address, the back
 * stack and the browser's own scrolling are all untouched — see the paragraph
 * above. Pressing one closes the panel, which is the only thing the click
 * handler does: it does not scroll, and it does not know which หัวข้อ was
 * pressed. On a desktop the button is `display: none` and the panel is
 * `display: contents`, so the column is the column it always was and this state
 * is never true.
 */
function Rail({ sections }) {
  const groups = GROUPS
    .map((label) => ({ label, items: sections.filter((s) => s.group === label) }))
    .filter((g) => g.items.length > 0);

  /* Phone only — see the note above. Closed to begin with, because the หัวข้อ
     the reader wants first is the one at the top of the page they just opened. */
  const [open, setOpen] = useState(false);

  return (
    <nav className={`manual-rail no-print${open ? ' open' : ''}`} aria-label="หัวข้อในคู่มือ">
      <button
        type="button"
        className="manual-rail-btn"
        aria-expanded={open}
        aria-controls="manual-rail-list"
        onClick={() => setOpen((was) => !was)}
      >
        <span className="manual-rail-btn-t">ไปที่หัวข้อ</span>
        <span className="manual-rail-btn-n">{sections.length} หัวข้อ</span>
        {/* `▾` is the mark this app already uses for a list that opens
            downwards (components/App.jsx), turned by the stylesheet rather than
            swapped for a second character — one glyph cannot be half-turned,
            and a transition can. */}
        <span className="manual-rail-chev" aria-hidden="true">▾</span>
      </button>
      <div
        id="manual-rail-list"
        className="manual-rail-list"
        /* The press that navigates is the anchor's; this only puts the panel
           away, so the หัวข้อ lands on a screen with nothing over it. */
        onClick={() => setOpen(false)}
      >
        {groups.map((g) => (
          <React.Fragment key={g.label}>
            <span className="manual-rail-h">{g.label}</span>
            {g.items.map((s) => (
              <a key={s.key} className="manual-rail-a" href={`#sec-${s.key}`}>
                <Icon name={s.icon} className="manual-rail-i" />
                <span>{s.title}</span>
              </a>
            ))}
          </React.Fragment>
        ))}
      </div>
    </nav>
  );
}

export default function ManualView({ user, navGroups = [], barSlots = [] }) {
  const [printing, setPrinting] = useState(false);

  const p = useMemo(() => permissionsOf(user), [user]);
  const visible = useMemo(() => sectionsFor(p), [p]);
  const ctx = useMemo(() => ({ p, navGroups, barSlots }), [p, navGroups, barSlots]);

  /* Everything this reader HAS, until they say otherwise — see ManualPrint. */
  const [picked, setPicked] = useState(() => sectionsFor(permissionsOf(user)).map((s) => s.key));
  /* A key can only leave the visible set if `user` changed under us, which is a
     re-login rather than a render. Narrowing here costs nothing and keeps the
     counter honest if it ever does. */
  const keys = visible.map((s) => s.key);
  const safePicked = picked.filter((k) => keys.includes(k));

  /* Joins the shell's back stack, so ‹ closes the print view before it leaves
     the screen — the same registration the OT form makes. There is no second
     state to register any more: the หัวข้อ overlay is gone, and the page is
     what the reader sees when nothing is open. */
  useBackHandler(printing, () => setPrinting(false));

  if (printing) {
    return (
      <ManualPrint
        visible={visible}
        ctx={ctx}
        picked={safePicked}
        onPick={setPicked}
        onClose={() => setPrinting(false)}
      />
    );
  }

  return (
    <div className="stack manual-page">
      <div className="card manual-intro-card">
        {/* ── THE WHOLE HEAD OF THIS CARD IS ONE ROW ─────────────────────
            Two asks, a day apart, both about the same thing — the distance
            between opening this page and the first หัวข้อ on it.

            2026-09-10: *ย้ายปุ่มบันทึก/พิมพ์ไปอยู่มุมขวาบนแถวแรกของการ์ด และ
            ใช้ไอคอนแทนข้อความ* — the shape a card's own action takes everywhere
            else in this app, and it fits here because there is exactly one.

            2026-09-11: *ปรับให้การแสดงผลกระชับในแถวเดียว* — so the subtitle and
            the control that opens the folded prose came up onto the heading row
            as well, and the card's head is now a single line: หัวข้อ · ฉบับของ
            ใคร กี่หัวข้อ · ดูคำอธิบาย · and the printer at the right edge.

            IT IS A ROW THAT WRAPS, AGREED THE SAME DAY: at 390px it breaks
            wherever it has to rather than shortening what it says. The folded
            prose is the one part that never shares the line — `display:
            contents` on `Disclosure`'s wrapper (app/styles.css) puts its
            control in the row and leaves its body a full-width line of its own,
            under everything, which is where a paragraph belongs. */}
        <div className="manual-intro-head">
          <h2>คู่มือการใช้งานเบื้องต้น</h2>
          {/* The way to paper, on the card that introduces the manual rather
              than on a หัวข้อ: what gets printed is a CHOICE OF หัวข้อ, so the
              control belongs where all of them are in view.

              THE WORD IS STILL IN THE DOCUMENT. `.act-label` is clipped rather
              than `display: none`, which is the rule written over `.icon-btn`
              in app/styles.css: hidden from sight, kept in the accessibility
              tree, so `aria-label`, `title` and the visible text all say the
              same thing and none of them is the only one.

              `printer` and not `document`: the glyph is now the whole of the
              label, and this button's own screen is the print view. */}
          <button
            type="button"
            className="btn sm icon-btn manual-intro-print"
            onClick={() => setPrinting(true)}
            aria-label="บันทึกคู่มือเป็นไฟล์ PDF หรือพิมพ์"
            title="บันทึกเป็น PDF / พิมพ์"
          >
            <Icon name="printer" />
            <span className="act-label">บันทึกเป็น PDF / พิมพ์</span>
          </button>
          {/* ── THE ONE LINE THAT DOES NOT FOLD ────────────────────────────
              Which edition this is, and how many หัวข้อ are in it. It is the
              card's subtitle, and `Disclosure`'s own rule says a subtitle folds
              nothing — but the reason is specific here rather than stylistic:
              this manual is CUT to the reader, so two people comparing screens
              see different numbers of หัวข้อ, and the sentence that explains why
              is no use behind a control neither of them pressed. */}
          <p className="hint">
            คุณกำลังอ่านฉบับของ <b>{p.label}</b> — ทั้งหมด {visible.length} หัวข้อ
          </p>
          {/* ── AND THE REST OF IT FOLDS, ASKED FOR ON 2026-09-10 ──────────
              *เปลี่ยนคำอธิบายส่วนนี้ให้กดซ่อน/แสดงได้*. Two paragraphs of
              background above a page somebody re-opens to jump to one หัวข้อ:
              read once, in the way every time after that, and on a phone they
              are most of the first screen before a single หัวข้อ shows.

              `lines={0}` and not a two-line clamp, because the ask is ซ่อน and
              because there is no sentence here that a preview of it would
              answer — the หัวข้อ below are what the reader came for. The words
              are ดูคำอธิบาย / ซ่อนคำอธิบาย rather than the default อ่านต่อ for
              the reason `Disclosure` writes down: nothing is CONTINUING behind a
              control with no first line above it. */}
          <Disclosure
            as="div"
            lines={0}
            of="คำอธิบายคู่มือ"
            more="ดูคำอธิบาย"
            less="ซ่อนคำอธิบาย"
          >
            <p className="manual-lead">
              ระบบนี้ใช้แทนใบขออนุมัติทำงานล่วงเวลา <b>F-HR-027</b> ที่เคยกรอกด้วยมือ
              ขั้นตอนยังเป็น พนักงาน → หัวหน้า → ฝ่ายบุคคล เหมือนเดิม และยังพิมพ์ใบหน้าตาเดิมออกมาเซ็นเก็บเข้าแฟ้มได้
              สิ่งที่เปลี่ยนคือ <b>ไม่ต้องคิดชั่วโมงเอง</b> — ระบบคิดให้ตั้งแต่ตอนกรอก
            </p>
            <p className="hint">
              คู่มือหน้านี้เปิดได้ทุกบทบาท และ<b>แสดงเฉพาะวิธีใช้งานที่บทบาทของคุณใช้ได้จริง</b>
              เลื่อนอ่านต่อกันได้ทั้งหน้า หรือกระโดดไปทีละหัวข้อจากรายการหัวข้อ —
              อยู่ข้าง ๆ บนคอมพิวเตอร์ และอยู่ใต้ปุ่ม <b>ไปที่หัวข้อ</b> บนมือถือ
            </p>
          </Disclosure>
        </div>
      </div>

      <div className="manual-layout">
        <Rail sections={visible} />
        <div className="manual-flow">
          {visible.map((s) => (
            <section key={s.key} id={`sec-${s.key}`} className="card manual-sec">
              <div className="manual-sec-head">
                <span className="manual-sec-icon"><Icon name={s.icon} /></span>
                <span className="manual-sec-t">
                  <h3>{s.title}</h3>
                  <span className="manual-sec-blurb">{s.blurb(p)}</span>
                </span>
                <span className="manual-sec-gate">{s.gateLabel(p)}</span>
              </div>
              <div className="manual-body"><s.Body {...ctx} /></div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
