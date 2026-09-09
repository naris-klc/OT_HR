'use client';

import React, { useMemo, useState } from 'react';
import {
  ROLE_LABEL_TH, approverRolesFor, isSigner, readsCompanyReports, roleLabel,
} from '@/lib/roles.js';
import { mayCorrectEntries } from '@/lib/entries.js';
import { printName } from '@/lib/printFile.js';
import { Empty, PrintChrome } from './common.jsx';
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
 *   the same list of หัวข้อ, pinned beside the text on a desktop and a strip of
 *   chips above it on a phone, marking where the reader is. Jumping to a หัวข้อ
 *   still costs one press; what it no longer costs is a press to get BACK, and
 *   a reader who wanted the next หัวข้อ after this one no longer has to know
 *   its name to reach it.
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

/**
 * The desktop window — appbar, the sidebar down the left, the page beside it.
 *
 * `nav={false}` drops the sidebar, for the one screen in this app that has no
 * menu at all: เข้าสู่ระบบ, which is drawn before anybody has a บทบาท.
 */
function Desk({ nav = null, children }) {
  return (
    <span className="mk mk-desk">
      <span className="mk-bar"><span className="mk-bar-t">ระบบขออนุมัติทำงานล่วงเวลา</span></span>
      <span className="mk-desk-body">
        {nav === false ? null : <span className="mk-side">{nav}</span>}
        <span className="mk-canvas">{children}</span>
      </span>
    </span>
  );
}

/**
 * The phone — appbar, the page, and the bar of at most four slots under it.
 *
 * `fab` is the round + on หน้าบันทึกและประวัติ OT and nowhere else, which is
 * the difference this app's phone layout actually has and the reason a step
 * about filing needs its own picture here.
 */
function Phone({ bar = null, fab = false, children }) {
  return (
    <span className="mk mk-phone">
      <span className="mk-bar"><span className="mk-bar-t">OT</span></span>
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
          <span className="mflow-s">รอฝ่ายบุคคล</span>
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
      alt="ใบเดียวที่กรอกเป็นช่วงเวลาเดียว ถูกระบบตัดตามวันและช่วงเวลางาน แล้วเข้าช่องอัตราสามช่อง"
      caption="ยอดสามช่องบวกกันได้เท่ากับยอดรวมพอดี เพราะระบบปัดเศษแยกทีละช่อง"
    >
      <div className="mrate">
        <div className="mrate-in">ช่วงเวลาที่คุณกรอก — เวลาเริ่ม ถึง เวลาสิ้นสุด (ข้ามคืนก็ใบเดียว)</div>
        <div className="mrate-arrow" aria-hidden="true">ระบบตัดเองว่าส่วนไหนตกวันไหน</div>
        <div className="mrate-out">
          <div className="mrate-col">
            <span className="mrate-k">×1.5 วันปกติ</span>
            <span className="mrate-v">ชั่วโมงนอกเวลางาน ในวันทำงานปกติ</span>
          </div>
          <div className="mrate-col">
            <span className="mrate-k">×1.5 วันหยุด</span>
            <span className="mrate-v">ชั่วโมงในวันหยุด ที่ตรงกับช่วงเวลางานปกติ</span>
          </div>
          <div className="mrate-col">
            <span className="mrate-k">×3 วันหยุด</span>
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
  ['รอฝ่ายบุคคล', 'wait', 'ผ่านขั้นแรกแล้ว รอฝ่ายบุคคลยืนยันเป็นขั้นสุดท้าย'],
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
          <p>พิมพ์ <b>รหัสพนักงาน</b> ให้ตรงตัว รวมทั้งขีดกลาง</p>
          <ul>
            <li><b>PM-0620</b> ไม่ใช่ PM0620 — ขีดกลางเป็นส่วนหนึ่งของรหัส</li>
            <li><b>รหัสผ่านครั้งแรกคือรหัสพนักงานของตัวเอง</b> ค่าเดียวกันนี้คือค่าที่ได้กลับมาหลังฝ่ายบุคคลกดรีเซ็ตรหัสผ่านให้</li>
            <li>กรอกผิดติดกันหลายครั้ง ระบบจะให้รอสักครู่ก่อนลองใหม่ ข้อความใต้ช่องกรอกจะบอกว่าติดตรงไหน</li>
            <li>เข้าไม่ได้จริง ๆ ให้ติดต่อฝ่ายบุคคล ไม่มีปุ่มลืมรหัสผ่านในระบบ</li>
          </ul>
          <Shot
            alt="หน้าเข้าสู่ระบบ มีสองช่องคือรหัสพนักงานและรหัสผ่าน บนคอมพิวเตอร์เป็นการ์ดกลางจอ บนมือถือเต็มความกว้าง"
            caption="หน้าเดียวกัน — บนคอมพิวเตอร์เป็นการ์ดกลางจอ บนมือถือเต็มความกว้าง ยังไม่มีเมนูทั้งสองเครื่อง"
            desk={(
              <Desk nav={false}>
                <MkRow>เข้าสู่ระบบ</MkRow>
                <MkField label="รหัสพนักงาน" on pin="1">PM-0620</MkField>
                <MkField label="รหัสผ่าน" pin="2">••••••••</MkField>
                <MkBtn>เข้าสู่ระบบ</MkBtn>
              </Desk>
            )}
            phone={(
              <Phone bar={false}>
                <MkRow>เข้าสู่ระบบ</MkRow>
                <MkField label="รหัสพนักงาน" on pin="1">PM-0620</MkField>
                <MkField label="รหัสผ่าน" pin="2">••••••••</MkField>
                <MkBtn>เข้าสู่ระบบ</MkBtn>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            ตราบใดที่ยังใช้รหัสผ่านที่ฝ่ายบุคคลตั้งให้ จะมี<b>แถบเตือนสีเหลือง</b>อยู่บนหน้าแรก
            เพราะรหัสนั้นคือรหัสพนักงานซึ่งพิมพ์อยู่บนใบ OT ทุกใบและคนอื่นทราบด้วย
            กดปุ่มในแถบนั้นแล้วตั้งรหัสใหม่ แถบจะหายไปเอง
          </p>
          <Shot
            alt="แถบเตือนสีเหลืองบนหน้าแรก พร้อมปุ่มตั้งรหัสใหม่ บนคอมพิวเตอร์ปุ่มอยู่ท้ายแถบ บนมือถือปุ่มลงมาอยู่บรรทัดล่าง"
            caption="ข้อความเดียวกัน — บนมือถือปุ่มตกลงมาอยู่บรรทัดของตัวเอง ไม่ได้หายไปไหน"
            desk={(
              <Desk nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-alert">
                  <span className="mk-alert-t">ยังใช้รหัสผ่านที่ตั้งให้ตอนแรก</span>
                  <MkBtn>ตั้งรหัสใหม่</MkBtn>
                </span>
              </Desk>
            )}
            phone={(
              <Phone bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <span className="mk-alert col">
                  <span className="mk-alert-t">ยังใช้รหัสผ่านที่ตั้งให้ตอนแรก</span>
                  <MkBtn>ตั้งรหัสใหม่</MkBtn>
                </span>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>สิ่งอื่นที่อยู่ในเมนู <b>ข้อมูลส่วนตัว</b></p>
          <ul>
            <li><b>ธีมสีหน้าจอ</b> — สว่าง มืด หรือตามเครื่อง ตั้งแยกกันในแต่ละเบราว์เซอร์ ไม่ผูกกับบัญชี</li>
            <li><b>ออกจากระบบ</b> — มีที่นี่ด้วย นอกเหนือจากที่มุมล่างซ้ายของเมนู</li>
            <li>ชื่อ-สกุล วันเกิด แผนก และบทบาท เป็นข้อมูลของฝ่ายบุคคล แก้เองไม่ได้ — ถ้าผิดให้แจ้งฝ่ายบุคคล</li>
            {p.sign ? (
              <li>
                <b>ผู้รับช่วงอนุมัติแทน</b> — คุณมีหัวข้อนี้เพราะคุณเซ็นขั้นแรก ดูหัวข้อ
                {' '}<b>ตั้งผู้รับช่วงอนุมัติแทน</b> ด้านล่าง
              </li>
            ) : null}
          </ul>
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
                nav={(
                  <>
                    {navGroups.map((g) => (
                      <React.Fragment key={g.key}>
                        <span className="mk-side-h">{g.label}</span>
                        {g.items.map((t) => (
                          <MkRow key={t.key} badge={t.badge || null}>{t.label}</MkRow>
                        ))}
                      </React.Fragment>
                    ))}
                    <span className="mk-side-h">ช่วยเหลือ</span>
                    <MkRow on>คู่มือการใช้งาน</MkRow>
                  </>
                )}
              >
                <MkNote>หน้าที่เปิดอยู่จะถูกทำเครื่องหมายไว้บนแถบซ้าย</MkNote>
              </Desk>
            )}
            phone={(
              <Phone
                bar={barSlots.map((s) => (
                  <MkSlot key={s.key} icon={s.icon} label={s.label} badge={s.badge || null} />
                ))}
              >
                <MkNote>ปุ่มรูปตัวอักษรย่อมุมบนขวาเปิดรายการที่มี คู่มือการใช้งาน อยู่ในกลุ่ม ช่วยเหลือ</MkNote>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>อ่านตัวเลขและปุ่มบนแถบ</p>
          <ul>
            <li><b>ตัวเลขสีเหลือง</b>บนปุ่มคือจำนวนใบที่รอคุณอยู่ ถ้าไม่มีก็ไม่มีตัวเลข</li>
            <li><b>โลโก้มุมบนซ้ายคือปุ่มย้อนกลับ</b> — ปิดฟอร์มหรือหน้าซ้อนทีละชั้น จนกลับถึงหน้าแรกของบทบาทตัวเอง</li>
            <li>บนคอมพิวเตอร์ ปุ่มบนสุดของแถบซ้ายย่อแถบให้เหลือเฉพาะไอคอนได้</li>
          </ul>
        </li>

        <li className="manual-step">
          <p>
            <b>คู่มือหน้านี้เปิดได้ทุกบทบาท</b> แต่แสดงเฉพาะหัวข้อที่บทบาทของคุณใช้งานได้จริง —
            คุณกำลังอ่านฉบับของ <b>{p.label}</b> หน้าจอที่คุณเปิดไม่ได้จะไม่มีวิธีใช้อยู่ในนี้
          </p>
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
            เปิดเมนู <b>บันทึกและประวัติ OT</b> แล้วกดปุ่มเพิ่มรายการ —
            ปุ่มอยู่คนละที่บนสองเครื่อง
          </p>
          <Shot
            alt="ปุ่มเพิ่มรายการ บนคอมพิวเตอร์เป็นปุ่มบันทึก OT ใหม่บนการ์ด บนมือถือเป็นปุ่มกลมมุมขวาล่าง"
            caption="บนคอมพิวเตอร์เป็นปุ่มบนการ์ด · บนมือถือเป็นปุ่มกลมมุมขวาล่าง ลอยอยู่เหนือแถบล่าง"
            desk={(
              <Desk nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>ชั่วโมงเดือนนี้</MkRow>
                  <MkBtn>+ บันทึก OT ใหม่</MkBtn>
                </span>
                <MkNote>ใต้ปุ่มคือประวัติการขอ OT ของคุณเอง</MkNote>
              </Desk>
            )}
            phone={(
              <Phone fab bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkRow>ชั่วโมงเดือนนี้</MkRow>
                <MkNote>ปุ่มกลม + มุมขวาล่างคือปุ่มเดียวกัน</MkNote>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>กรอกวันที่และเวลา — <b>ใบที่ทำข้ามคืนไม่ต้องติ๊กอะไร</b></p>
          <ul>
            <li><b>วันที่เริ่ม</b> — วันที่ลงมือทำงาน ใบที่ทำข้ามคืนให้ใส่วันที่ของตอนเริ่ม</li>
            <li><b>เวลาเริ่ม</b> และ <b>เวลาสิ้นสุด</b> — ถ้าเวลาสิ้นสุดน้อยกว่าเวลาเริ่ม ระบบเข้าใจเองว่าข้ามคืน และบอกไว้ข้างช่องเวลา</li>
            <li><b>รายละเอียดงานที่ทำ</b> — จำกัดความยาว เพราะช่องบนใบที่พิมพ์ออกมามีบรรทัดเดียว ตัวนับอยู่มุมขวาของหัวช่อง</li>
          </ul>
          <Shot
            alt="ฟอร์มบันทึก OT บนคอมพิวเตอร์ช่องเวลาเริ่มและเวลาสิ้นสุดอยู่บรรทัดเดียวกัน บนมือถือเรียงลงมาทีละช่อง"
            caption="ช่องเหมือนกันทั้งสองเครื่อง — บนมือถือเรียงลงมาทีละช่องแทนที่จะอยู่บรรทัดเดียวกัน"
            desk={(
              <Desk nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <MkField label="วันที่เริ่ม" on>พฤ. 10 ก.ย. 2569</MkField>
                <span className="mk-two">
                  <MkField label="เวลาเริ่ม" on>21:00</MkField>
                  <MkField label="เวลาสิ้นสุด" on>02:00</MkField>
                </span>
                <MkNote tone="ok">ระบบอ่านว่าข้ามคืน ไปสิ้นสุดวันศุกร์ที่ 11 — ไม่ต้องติ๊กอะไร</MkNote>
                <MkField label="รายละเอียดงานที่ทำ">ตรวจสอบสายการผลิต 3</MkField>
              </Desk>
            )}
            phone={(
              <Phone bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkField label="วันที่เริ่ม" on>พฤ. 10 ก.ย. 2569</MkField>
                <MkField label="เวลาเริ่ม" on>21:00</MkField>
                <MkField label="เวลาสิ้นสุด" on>02:00</MkField>
                <MkNote tone="ok">ระบบอ่านว่าข้ามคืน ไปสิ้นสุดวันศุกร์ที่ 11</MkNote>
              </Phone>
            )}
          />
          <p className="hint">
            ตัวอย่างวันและเวลาในภาพเป็นตัวอย่างประกอบเท่านั้น ไม่ใช่ค่าที่ระบบตั้งไว้
          </p>
        </li>

        <li className="manual-step">
          <p>
            อ่าน <b>ตัวอย่างชั่วโมง</b> ที่ระบบคิดให้ ก่อนกดบันทึก —
            แยกให้เห็นทีละช่องอัตรา ไม่ต้องคิดชั่วโมงเอง
          </p>
          <Shot
            alt="ตัวอย่างชั่วโมงแยกสามช่องอัตรา บนคอมพิวเตอร์เรียงสามช่องในบรรทัดเดียว บนมือถือเรียงลงมา"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — ยอดจริงขึ้นกับเวลาที่กรอกและค่าที่ฝ่ายบุคคลตั้งไว้"
            desk={(
              <Desk nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-lab">ตัวอย่างชั่วโมงที่จะได้</span>
                <span className="mk-three">
                  <span className="mk-cell"><span className="mk-cell-k">×1.5 วันปกติ</span><span className="mk-cell-v">2.0</span></span>
                  <span className="mk-cell"><span className="mk-cell-k">×1.5 วันหยุด</span><span className="mk-cell-v">0.0</span></span>
                  <span className="mk-cell"><span className="mk-cell-k">×3 วันหยุด</span><span className="mk-cell-v">2.5</span></span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <span className="mk-lab">ตัวอย่างชั่วโมงที่จะได้</span>
                <span className="mk-cell"><span className="mk-cell-k">×1.5 วันปกติ</span><span className="mk-cell-v">2.0</span></span>
                <span className="mk-cell"><span className="mk-cell-k">×3 วันหยุด</span><span className="mk-cell-v">2.5</span></span>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>ดูคำเตือนที่อาจขึ้น — สามอันแรกเตือนแล้วยังบันทึกได้ อันสุดท้ายคือระบบไม่รับใบ</p>
          <ul>
            <li>บอกถ้าวันนั้นเป็น <b>วันหยุด</b> หรือเป็น <b>วันเกิดของคุณเอง</b> พร้อมบอกว่าจะคิดอัตราอย่างไร</li>
            <li>เตือนถ้าเวลาที่กรอก <b>ทับกับใบอื่น</b> ของคนเดียวกัน</li>
            <li>บอกถ้ายอดของเดือนหรือสัปดาห์นั้น <b>เกินเพดานของแผนก</b> — เกินแล้วยังบันทึกได้ แต่ติดธงไว้ให้ฝ่ายบุคคลเห็น</li>
            <li><b>ทำไม่ถึงเวลาขั้นต่ำ</b> — อันนี้ระบบไม่รับใบ และบอกเหตุผล</li>
          </ul>
        </li>

        <li className="manual-step">
          <p>ช่องติ๊กที่<b>อาจขึ้นหรือไม่ขึ้น</b> ขึ้นกับตำแหน่งและวันที่</p>
          <ul>
            <li><b>เหมารายวัน</b> — ขึ้นเฉพาะบางตำแหน่งที่ฝ่ายบุคคลกำหนด ติ๊กแล้วระบบเติมเวลาให้ตามเวลางานปกติ และแก้เวลาเริ่มเองได้</li>
            <li><b>ไม่พักเที่ยง</b> — ขึ้นเฉพาะวันที่ทั้งบริษัทหยุด (เสาร์-อาทิตย์ หรือวันหยุดตามประกาศ)</li>
            <li>ไม่มีช่องติ๊กวันเกิดและไม่มีช่องติ๊กข้ามคืน ทั้งสองอย่างระบบตอบเองจากวันที่และเวลาที่กรอก</li>
          </ul>
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
        </li>

        <li className="manual-step">
          <p>กติกาที่ใช้กับทุกบทบาท ไม่มีข้อยกเว้น</p>
          <ul>
            <li><b>ไม่มีใครเซ็นใบของตัวเองได้</b> ไม่ว่าบทบาทใด</li>
            <li><b>หัวหน้างานกับการเงินอยู่ระดับเดียวกันแต่คนละโต๊ะ</b> — เซ็นใบของกันและกันไม่ได้</li>
            <li>ตำแหน่งที่สูงกว่า<b>เห็น</b>ใบของทุกชั้นที่อยู่ใต้บังคับบัญชา แต่คนที่<b>เซ็น</b>คือชั้นถัดไปชั้นเดียว</li>
          </ul>
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
                  <td>กด <b>ขอถอนใบ</b> — ต้องมีเหตุผล และต้องได้รับอนุมัติ ถอนผ่านแล้วใบกลายเป็น ยกเลิก จึงยื่นใหม่ได้</td>
                </tr>
                <tr>
                  <td className="nowrap"><MkChip tone="no">ไม่อนุมัติ</MkChip></td>
                  <td>กด <b>ส่งใหม่</b> — ใบเดิมแก้ไม่ได้ ระบบเปิดใบใหม่ให้โดยเก็บสายของเดิมไว้</td>
                </tr>
              </tbody>
            </table>
          </div>
        </li>

        <li className="manual-step">
          <p>ปุ่มพวกนี้อยู่บนแถวของใบ และวางไว้คนละแบบบนสองเครื่อง</p>
          <Shot
            alt="ปุ่มจัดการใบบนแถว บนคอมพิวเตอร์อยู่ท้ายแถวเดียวกัน บนมือถือกดที่แถวแล้วเปิดเป็นแผ่นซ้อนขึ้นมา"
            caption="บนมือถือแถวแคบเกินกว่าจะวางปุ่มไว้ท้ายแถว — กดที่แถวแล้วปุ่มจะอยู่ในแผ่นที่เปิดขึ้นมา"
            desk={(
              <Desk nav={<MkRow on>บันทึกและประวัติ OT</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>พฤ. 10 ก.ย. · 21:00–02:00</MkRow>
                  <span className="mk-acts">
                    <MkChip tone="wait">รอหัวหน้า</MkChip>
                    <MkBtn ghost>แก้ไข</MkBtn>
                    <MkBtn ghost>ยกเลิก</MkBtn>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone bar={<MkSlot icon="clock" label="ประวัติ OT" on />}>
                <MkRow badge="›">พฤ. 10 ก.ย. · 21:00–02:00</MkRow>
                <MkNote>กดที่แถว → เปิดแผ่นรายละเอียด</MkNote>
                <span className="mk-sheet">
                  <MkChip tone="wait">รอหัวหน้า</MkChip>
                  <MkBtn ghost>แก้ไข</MkBtn>
                  <MkBtn ghost>ยกเลิก</MkBtn>
                </span>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            ทุกการแก้และทุกคำขอถอน<b>ขึ้นในประวัติของใบ</b> พร้อมชื่อคนทำและเวลา
            ประวัตินั้นอยู่ในหน้ารายละเอียดของใบใบนั้น
          </p>
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
            เปิดเมนู <b>พิมพ์ใบขออนุมัติ OT</b> แล้วเลือกเดือน
            หน้านี้<b>ไม่ได้ใช้ยื่นใบ</b> — เป็นที่พิมพ์ใบที่ยื่นไปแล้วเท่านั้น
            การยื่นอยู่ที่ บันทึกและประวัติ OT
          </p>
          <Shot
            alt="หน้าพิมพ์ใบ F-HR-027 บนคอมพิวเตอร์เห็นทั้งแผ่นกว้างเต็มหน้ากระดาษ บนมือถือแผ่นเลื่อนซ้ายขวาได้"
            caption="แผ่นเดียวกัน — บนมือถือกระดาษกว้างกว่าจอ จึงเลื่อนซ้ายขวาได้ และมีคำใบ้บอกไว้"
            desk={(
              <Desk nav={<MkRow on>พิมพ์ใบขออนุมัติ OT</MkRow>}>
                <span className="mk-paper">
                  <span className="mk-paper-h">ใบขออนุมัติทำงานล่วงเวลา · F-HR-027</span>
                  <MkNote>ชื่อ · รหัสพนักงาน · แผนก · วันที่ · เวลา · ชั่วโมงแยกช่องอัตรา</MkNote>
                  <span className="mk-three">
                    <span className="mk-sign">ผู้ขอ</span>
                    <span className="mk-sign">ผู้อนุมัติ</span>
                    <span className="mk-sign">ฝ่ายบุคคล</span>
                  </span>
                </span>
                <MkBtn>บันทึกเป็น PDF / พิมพ์</MkBtn>
              </Desk>
            )}
            phone={(
              <Phone bar={<MkSlot icon="document" label="พิมพ์ใบ OT" on />}>
                <span className="mk-paper narrow">
                  <span className="mk-paper-h">F-HR-027</span>
                  <span className="mk-three">
                    <span className="mk-sign">ผู้ขอ</span>
                    <span className="mk-sign">ผู้อนุมัติ</span>
                    <span className="mk-sign">ฝ่ายบุคคล</span>
                  </span>
                </span>
                <MkNote>เลื่อนซ้ายขวาเพื่อดูทั้งแผ่น</MkNote>
                <MkBtn>บันทึกเป็น PDF / พิมพ์</MkBtn>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            <b>ยังไม่อนุมัติก็พิมพ์ได้</b> ช่องลงชื่อจะยังว่างไว้ให้เซ็นด้วยมือ
            ขั้นที่อนุมัติผ่านแล้วจะมีชื่อและวันที่พิมพ์อยู่ในช่องให้เอง
          </p>
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
            <li>ใบที่คุณรับช่วงมาจากคนอื่นจะติดป้าย <b>รับช่วง</b> ไว้บนแถว</li>
          </ul>
        </li>

        <li className="manual-step">
          <p><b>กดที่แถว</b>เพื่อเปิดรายละเอียด แล้วตัดสินด้วยปุ่มบนแถวนั้น</p>
          <Shot
            alt="แถวในคิวรออนุมัติ บนคอมพิวเตอร์เห็นชื่อ ยอดสะสมและปุ่มอนุมัติในแถวเดียว บนมือถือแถวย่อและปุ่มอยู่ในแผ่นที่เปิดขึ้นมา"
            caption="ตัวเลขสะสมในภาพเป็นตัวอย่าง — บนมือถือแถวย่อลงและปุ่มย้ายไปอยู่ในแผ่นรายละเอียด"
            desk={(
              <Desk nav={<MkRow on badge="3">รายการรออนุมัติ</MkRow>}>
                <span className="mk-headrow">
                  <MkRow>สมชาย ใจดี · PM-0620 · 21:00–02:00</MkRow>
                  <span className="mk-acts">
                    <span className="mk-cell"><span className="mk-cell-k">สะสม / เพดาน</span><span className="mk-cell-v">28 / 40</span></span>
                    <MkChip tone="ok">อนุมัติ</MkChip>
                    <MkChip tone="no">ไม่อนุมัติ</MkChip>
                  </span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone bar={<MkSlot icon="inbox" label="รออนุมัติ" on badge="3" />}>
                <MkRow badge="›">สมชาย ใจดี · PM-0620</MkRow>
                <MkNote>กดที่แถว → เปิดแผ่นรายละเอียดพร้อมยอดสะสม</MkNote>
                <span className="mk-sheet">
                  <MkChip tone="ok">อนุมัติ</MkChip>
                  <MkChip tone="no">ไม่อนุมัติ</MkChip>
                </span>
              </Phone>
            )}
          />
        </li>

        <li className="manual-step">
          <p>
            <b>ไม่อนุมัติต้องใส่เหตุผล</b> เหตุผลนั้นไปขึ้นบนใบที่ผู้ยื่นเห็น
            ผู้ยื่นแก้ใบที่ถูกปฏิเสธไม่ได้ ต้องกด ส่งใหม่ — เหตุผลจึงเป็นสิ่งเดียวที่บอกเขาว่าต้องแก้อะไร
          </p>
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
        </li>
      </ol>
    ),
  },

  {
    key: 'proxy',
    group: 'งานอนุมัติ',
    icon: 'users',
    title: 'บันทึก OT แทนคนอื่น',
    blurb: (p) => (p.correct ? 'ฝ่ายบุคคลบันทึกแทนใครก็ได้' : 'บันทึกแทนลูกทีมที่เข้าระบบไม่ได้'),
    gate: (p) => p.sign || p.correct,
    gateLabel: (p) => (p.correct
      ? 'ฝ่ายบุคคลและผู้ดูแลระบบ'
      : 'คุณเห็นหัวข้อนี้เพราะคุณเซ็นขั้นแรกให้แผนกหนึ่ง'),
    Body: ({ p }) => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>เลือก<b>คนที่จะบันทึกแทน</b>ก่อน แล้วฟอร์มจึงเปิด</p>
          <ul>
            <li>{p.correct ? 'เลือกได้ทุกคนในทะเบียนพนักงาน' : 'เลือกได้เฉพาะคนในแผนกที่คุณถืออยู่'}</li>
            <li>ฟอร์มที่เปิดมาเป็นฟอร์มเดียวกับที่เจ้าตัวใช้ กฎการตรวจเหมือนกันทุกข้อ</li>
          </ul>
        </li>
        <li className="manual-step">
          <p>
            ใบที่บันทึกแทน<b>ติดป้ายไว้ว่าใครเป็นคนคีย์</b> และเจ้าของใบยังเป็นเจ้าตัว
            ทั้งสองชื่อขึ้นในประวัติของใบ ไม่ถูกยุบเป็นชื่อเดียว
          </p>
        </li>
        {/* ADDED 2026-09-09 WITH `proxySkipsOwnApproval: false`. Until that day
            a filing typed by the หัวหน้า went straight to รอ HR and there was no
            second press to describe — the manual would have been wrong to
            mention one. It is the only step on this page a reader can miss
            entirely and never find out about, because a ใบ that is waiting
            looks exactly like a ใบ that is done from the form they typed it in.

            SPLIT ON `p.correct` BECAUSE THE SECOND PRESS IS NOT HR'S. The skip
            only ever applied to a filer who could sign the step themselves; a
            ฝ่ายบุคคล filing for somebody waits for that person's own หัวหน้า,
            which is the ordinary route and needs no instruction here. */}
        <li className="manual-step">
          {p.correct ? (
            <p>
              ใบที่คุณบันทึกแทนจะไป<b>รอหัวหน้าของพนักงานคนนั้นอนุมัติตามปกติ</b>
              แล้วจึงกลับมาที่คิวของฝ่ายบุคคล
            </p>
          ) : (
            <p>
              ใบที่คุณบันทึกแทนจะไป<b>รออยู่ในคิว รายการรออนุมัติ ของคุณเอง</b> ต้องเปิดแล้ว
              กด <b>อนุมัติ</b> อีกครั้ง ใบจึงจะไปถึงฝ่ายบุคคล — กรอกใบกับรับรองตัวเลขเป็นคนละเรื่อง
              และตรงนั้นกด <b>ไม่อนุมัติ</b> ได้ถ้าคีย์ผิด
            </p>
          )}
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
      : 'คิวใบที่หัวหน้ามอบให้คุณเซ็นแทน'),
    gate: (p) => p.sign || p.correct,
    gateLabel: (p) => (p.sign
      ? 'คุณเห็นหัวข้อนี้เพราะคุณเซ็นขั้นแรกให้แผนกหนึ่ง'
      : 'ฝ่ายบุคคลและผู้ดูแลระบบ'),
    Body: ({ p }) => (p.sign ? (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            เปิด <b>ข้อมูลส่วนตัว</b> แล้วหาหัวข้อ <b>ผู้รับช่วงอนุมัติแทน</b>
            เลือกคนและ<b>ช่วงวันที่</b>
          </p>
          <ul>
            <li><b>เป็นหน้าต่างเวลา ไม่ใช่สวิตช์</b> — หมดเองเมื่อพ้นวันที่ตั้งไว้ ไม่ต้องกลับมาปิด</li>
            <li><b>เพิ่มลายเซ็น ไม่ได้ย้าย</b> — คุณยังเซ็นเองได้ตลอด กลับมาก่อนกำหนดไม่ต้องยกเลิกอะไร</li>
            <li>ระบบบันทึกว่า<b>ใครกด</b>และ<b>ใช้สิทธิ์ของใคร</b> แยกกันเสมอ</li>
          </ul>
          <Shot
            alt="ช่องตั้งผู้รับช่วงอนุมัติแทน มีชื่อคนและช่วงวันที่ บนคอมพิวเตอร์วันที่สองช่องอยู่บรรทัดเดียวกัน บนมือถือเรียงลงมา"
            caption="วันที่ในภาพเป็นตัวอย่าง — สิ่งที่ต้องกรอกคือคนหนึ่งคนกับช่วงวันที่หนึ่งช่วง"
            desk={(
              <Desk nav={<MkRow on>ข้อมูลส่วนตัว</MkRow>}>
                <MkField label="ผู้รับช่วงอนุมัติแทน" on>วิภา สุขใจ · หัวหน้างาน</MkField>
                <span className="mk-two">
                  <MkField label="ตั้งแต่">10 ก.ย. 2569</MkField>
                  <MkField label="ถึง">17 ก.ย. 2569</MkField>
                </span>
                <MkNote>พ้นวันสุดท้ายแล้วสิทธิ์นี้หายไปเอง</MkNote>
              </Desk>
            )}
            phone={(
              <Phone bar={<MkSlot icon="inbox" label="รออนุมัติ" on />}>
                <MkField label="ผู้รับช่วงอนุมัติแทน" on>วิภา สุขใจ</MkField>
                <MkField label="ตั้งแต่">10 ก.ย. 2569</MkField>
                <MkField label="ถึง">17 ก.ย. 2569</MkField>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>ใบที่ผู้รับช่วงเห็นจะติดป้าย <b>รับช่วง</b> บนแถว เพื่อให้รู้ว่ากำลังเซ็นด้วยสิทธิ์ของใคร</p>
        </li>
      </ol>
    ) : (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            เมนู <b>รออนุมัติแทน</b> จะขึ้นเมื่อมีหัวหน้ามอบสิทธิ์ให้คุณ
            เป็นคิวแยกจาก รออนุมัติ OT ของคุณเอง เพราะเป็นคนละความรับผิดชอบ
          </p>
          <ul>
            <li>คิวนี้ยังอยู่แม้ไม่มีใบค้าง — ความรับผิดชอบไม่ได้หายไปพร้อมแถวสุดท้าย</li>
          </ul>
        </li>
        <li className="manual-step">
          <p>
            ทุกครั้งที่คุณเซ็นแทน ระบบบันทึกว่า<b>คุณกด</b> และ<b>ใช้สิทธิ์ของใคร</b>
            สองอย่างนี้ไม่ถูกยุบเป็นชื่อเดียว เพราะคำถามตอนตัวเลขถูกโต้แย้งคือ “ทำไมคนนี้เซ็นได้”
          </p>
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
            เลือกเดือน แล้วอ่านยอดรายคนของ<b>แผนกที่คุณถืออยู่</b> —
            ขอบเขตคือแผนกที่ลายเซ็นขั้นแรกเป็นของคุณ
          </p>
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
          </li>
        ) : null}

        <li className="manual-step">
          <p>
            <b>ตรวจสอบประจำเดือน</b> — ยอดรายคนของทุกแผนก ทั้งสองบริษัท
            ใช้กระทบยอดกับ <b>รายงาน OT การเงิน</b> ซึ่งเป็นสรุปของเดือนเดียวกัน
          </p>
        </li>

        <li className="manual-step">
          <p>ก่อนพิมพ์ทั้งเดือน อ่าน <b>สรุปสถานะงวด</b> ว่ายังมีใบค้างใครอยู่หรือเปล่า</p>
          <Shot
            alt="สรุปสถานะงวด นับใบที่ยังค้างแต่ละขั้น บนคอมพิวเตอร์เรียงสามช่องในบรรทัดเดียว บนมือถือเรียงลงมา"
            caption="ตัวเลขในภาพเป็นตัวอย่าง — หน้านี้ถามอย่างเดียว ไม่ได้ปิดกั้นอะไร ระบบนี้ไม่มีการปิดงวด"
            desk={(
              <Desk nav={<MkRow on>ตรวจสอบประจำเดือน</MkRow>}>
                <span className="mk-lab">สรุปสถานะงวด · ก.ย. 2569</span>
                <span className="mk-three">
                  <span className="mk-cell"><span className="mk-cell-k">รอหัวหน้า</span><span className="mk-cell-v warn">4</span></span>
                  <span className="mk-cell"><span className="mk-cell-k">รอฝ่ายบุคคล</span><span className="mk-cell-v warn">2</span></span>
                  <span className="mk-cell"><span className="mk-cell-k">คำขอถอนค้าง</span><span className="mk-cell-v">0</span></span>
                </span>
              </Desk>
            )}
            phone={(
              <Phone bar={<MkSlot icon="chart" label="รายงาน" on />}>
                <span className="mk-lab">สรุปสถานะงวด · ก.ย. 2569</span>
                <span className="mk-cell"><span className="mk-cell-k">รอหัวหน้า</span><span className="mk-cell-v warn">4</span></span>
                <span className="mk-cell"><span className="mk-cell-k">รอฝ่ายบุคคล</span><span className="mk-cell-v warn">2</span></span>
              </Phone>
            )}
          />
          <p className="hint">
            ใบที่ยังไม่อนุมัติจะไม่ขึ้นบนแผ่นที่พิมพ์ — แผ่นที่เข้าแฟ้มโดยขาดแถวคือความผิดพลาดที่หาทีหลังยาก
          </p>
        </li>

        <li className="manual-step">
          <p><b>รายงาน OT การเงิน</b> — แผ่นที่ส่งบัญชี พิมพ์ออกไปได้ทั้งเดือน</p>
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
        </li>
        <li className="manual-step">
          <p>ตัวเลขบนปุ่มรวม<b>คำขอถอนที่ยังไม่ตอบ</b>ของใบที่รออยู่ในคิวนี้ด้วย</p>
        </li>
        <li className="manual-step">
          <p>
            ไม่อนุมัติที่ขั้นนี้ ใบจะย้อนกลับไปตามที่ตั้งไว้ในนโยบาย
            ปลายทางของการตีกลับตั้งได้ที่หน้า <b>ตั้งค่าระบบ</b>
          </p>
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
        </li>
        <li className="manual-step">
          <p>
            ทุกการแก้<b>ขึ้นในประวัติของใบ</b> พร้อมชื่อและเวลา และเข้าบันทึกประวัติระบบด้วย
            แก้แล้วระบบคิดชั่วโมงใหม่ให้ทันที ไม่ต้องสั่งคำนวณใหม่
          </p>
        </li>
        <li className="manual-step">
          <p>
            แก้แล้วอย่าลืมว่า<b>แผ่นที่พิมพ์ไปแล้วยังเป็นของเก่า</b> ถ้าเข้าแฟ้มไปแล้วต้องพิมพ์ไปแทน
          </p>
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
          <p><b>ตัวเลขจริงทั้งหมดอยู่ที่หน้านี้ ไม่ได้อยู่ในคู่มือ</b></p>
          <Shot
            alt="หน้าตั้งค่าระบบ มีสี่ส่วน บนคอมพิวเตอร์เห็นทั้งสี่ส่วนเรียงในหน้าเดียว บนมือถือเรียงลงมาทีละส่วน"
            caption="สี่ส่วนเดียวกันทั้งสองเครื่อง — บนมือถืออยู่ในปุ่ม เพิ่มเติม ของแถบล่าง"
            desk={(
              <Desk nav={<MkRow on>ตั้งค่าระบบ</MkRow>}>
                <MkRow>นโยบายการคำนวณ — เวลางานปกติ · การปัดเศษ · เวลาขั้นต่ำ · จำนวนวันที่ยื่นล่วงหน้าได้</MkRow>
                <MkRow>ทะเบียนพนักงาน — เพิ่มคน แก้บทบาท ย้ายแผนก รีเซ็ตรหัสผ่าน</MkRow>
                <MkRow>ปฏิทินวันหยุด — วันหยุดตามประกาศของทั้งบริษัท</MkRow>
                <MkRow>แผนก — เพดานต่อเดือนและต่อสัปดาห์ · รูปแบบโอที · ผู้ถือลายเซ็น</MkRow>
              </Desk>
            )}
            phone={(
              <Phone bar={<MkSlot icon="sliders" label="เพิ่มเติม" on />}>
                <MkRow>นโยบายการคำนวณ</MkRow>
                <MkRow>ทะเบียนพนักงาน</MkRow>
                <MkRow>ปฏิทินวันหยุด</MkRow>
                <MkRow>แผนก</MkRow>
              </Phone>
            )}
          />
        </li>
        <li className="manual-step">
          <p>แก้<b>นโยบาย</b>แล้ว ใบเก่าไม่เปลี่ยนเอง</p>
          <ul>
            <li>ระบบเก็บเวอร์ชันของนโยบายไว้ และมีประวัติว่าใครแก้อะไรเมื่อไร</li>
            <li>ถ้าต้องการให้ใบเก่าคิดตามค่าที่แก้ใหม่ ต้องสั่งคำนวณใหม่ ซึ่งเป็นงานของผู้ดูแลระบบ</li>
          </ul>
        </li>
      </ol>
    ),
  },

  {
    key: 'logs',
    group: 'งานฝ่ายบุคคลและผู้ดูแลระบบ',
    icon: 'shield',
    title: 'บันทึกประวัติระบบ และคำนวณใหม่',
    blurb: () => 'สองอย่างที่ฝ่ายบุคคลไม่มี',
    gate: (p) => p.logs,
    gateLabel: () => 'ผู้ดูแลระบบเท่านั้น',
    Body: () => (
      <ol className="manual-steps">
        <li className="manual-step">
          <p>
            <b>บันทึกประวัติระบบ</b> — ใครทำอะไรกับใบไหนและเมื่อไร
            ฝ่ายบุคคลเปิดหน้านี้ไม่ได้ เพราะบัญชีฝ่ายบุคคลใช้ร่วมกันหลายคน
          </p>
        </li>
        <li className="manual-step">
          <p><b>คำนวณใหม่</b> — สั่งให้ระบบคิดชั่วโมงของใบเก่าใหม่ตามนโยบายปัจจุบัน</p>
          <ul>
            <li>สั่งแล้วมีบันทึกไว้ว่าใครสั่ง และแตะใบไปกี่ใบ</li>
            <li>ใช้เมื่อแก้นโยบายแล้วต้องการให้ย้อนไปมีผลกับใบที่ยื่นไปแล้ว</li>
          </ul>
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
          <p className="hint">กะข้ามคืนระบบตัดเองว่าส่วนไหนตกวันไหน แล้วเข้าคนละช่องให้อัตโนมัติ</p>
        </li>
        <li className="manual-step">
          <p>สิ่งที่ระบบทำให้เงียบ ๆ</p>
          <ul>
            <li><b>หักพักเที่ยง</b> เฉพาะใบที่คร่อมช่วงพักกลางวัน ใบที่ไม่แตะช่วงนั้นไม่ถูกหัก</li>
            <li><b>ปัดเศษ</b> เป็นบล็อกเท่า ๆ กัน และปัดแยกทีละช่องอัตรา ยอดสามช่องจึงบวกกันได้เท่ากับยอดรวมพอดี</li>
            <li><b>เวลาขั้นต่ำ</b> ทำไม่ถึงเกณฑ์ ระบบไม่รับใบ และบอกเหตุผล</li>
            <li><b>เสาร์-อาทิตย์และวันหยุดตามประกาศ</b> คิดเป็นวันหยุด ปฏิทินวันหยุดฝ่ายบุคคลเป็นคนตั้ง</li>
          </ul>
        </li>
        <li className="manual-step">
          <p><b>เพดาน OT</b> ตั้งไว้ที่ระดับแผนก ทั้งต่อเดือนและต่อสัปดาห์ แต่ <b>วัดรายคน</b></p>
          <ul>
            <li>นับชั่วโมงจริงไม่ใช่ชั่วโมงคูณอัตรา และนับรวมใบที่ยังรออนุมัติด้วย</li>
            <li><b>ชนเพดานแล้วระบบยังรับใบ แต่ติดธงไว้ให้ฝ่ายบุคคลเห็น</b> ไม่ได้ปฏิเสธทิ้ง</li>
          </ul>
        </li>
        <li className="manual-step">
          <p>
            <b>วันเกิด</b>ของพนักงานนับเป็นวันหยุดของคนนั้นคนเดียว มาทำงานวันนั้นได้อัตราวันหยุด
            ยื่นเหมือนใบ OT ปกติทุกอย่าง ไม่ต้องติ๊กอะไรเพิ่ม เลือกวันที่ให้ตรงก็พอ
            ระบบอ่านวันเกิดจากทะเบียนพนักงานแล้วขึ้นข้อความบอกบนฟอร์มก่อนกดบันทึก
            วันเกิดเป็นข้อมูลที่เพื่อนร่วมงานมองไม่เห็น
          </p>
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
            <li>ตรวจขีดกลางในรหัสพนักงาน · รหัสผ่านครั้งแรกคือรหัสพนักงาน</li>
            <li>กรอกผิดหลายครั้งต้องรอสักครู่ · ยังไม่ได้ให้ติดต่อฝ่ายบุคคล</li>
          </ul>
        </li>
        <li className="manual-step">
          <p><b>ยื่นใบแล้วเงียบ</b></p>
          <ul>
            <li>ดูป้ายสถานะบนแถวนั้น ถ้าเป็น <b>รอหัวหน้า</b> แปลว่ายังรอลายเซ็นขั้นแรกอยู่</li>
            <li>ถ้าแผนกไม่มีคนเซ็นขั้นแรก ใบจะไปรอฝ่ายบุคคลแทน</li>
          </ul>
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
        </li>
        <li className="manual-step">
          <p><b>ไม่เห็นเมนูที่เพื่อนเห็น</b></p>
          <ul>
            <li>เมนูขึ้นตามบทบาทที่ฝ่ายบุคคลตั้งไว้ในทะเบียนพนักงาน คู่มือหน้านี้ก็แสดงเฉพาะหัวข้อที่บทบาทของคุณใช้ได้เช่นกัน</li>
          </ul>
        </li>
        <li className="manual-step">
          <p><b>ระบบเข้าไม่ได้ทั้งระบบ</b></p>
          <ul>
            <li>กลับไปใช้กระดาษ F-HR-027 ตามปกติก่อน แล้วคีย์กลับเข้าระบบเมื่อใช้ได้ ฝ่ายบุคคลมีขั้นตอนสำหรับกรณีนี้อยู่แล้ว</li>
          </ul>
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
 * column beside the text on a desktop and as a strip of chips above it on a
 * phone, which is the same two shapes the app's own menu takes and for the same
 * reason — a phone has no room for a column beside anything.
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
 */
function Rail({ sections }) {
  const groups = GROUPS
    .map((label) => ({ label, items: sections.filter((s) => s.group === label) }))
    .filter((g) => g.items.length > 0);

  return (
    <nav className="manual-rail no-print" aria-label="หัวข้อในคู่มือ">
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
      <div className="card">
        <h2>คู่มือการใช้งานเบื้องต้น</h2>
        <p className="manual-lead">
          ระบบนี้ใช้แทนใบขออนุมัติทำงานล่วงเวลา <b>F-HR-027</b> ที่เคยกรอกด้วยมือ
          ขั้นตอนยังเป็น พนักงาน → หัวหน้า → ฝ่ายบุคคล เหมือนเดิม และยังพิมพ์ใบหน้าตาเดิมออกมาเซ็นเก็บเข้าแฟ้มได้
          สิ่งที่เปลี่ยนคือ <b>ไม่ต้องคิดชั่วโมงเอง</b> — ระบบคิดให้ตั้งแต่ตอนกรอก
        </p>
        <p className="hint">
          คู่มือหน้านี้เปิดได้ทุกบทบาท และ<b>แสดงเฉพาะวิธีใช้งานที่บทบาทของคุณใช้ได้จริง</b> —
          คุณกำลังอ่านฉบับของ <b>{p.label}</b> ทั้งหมด {visible.length} หัวข้อ
          เลื่อนอ่านต่อกันได้ทั้งหน้า หรือกดหัวข้อจากแถบด้านข้าง
        </p>
        {/* The way to paper, on the card that introduces the manual rather than
            on a หัวข้อ: what gets printed is a CHOICE OF หัวข้อ, so the control
            belongs where all of them are in view. */}
        <button type="button" className="btn ghost with-icon" onClick={() => setPrinting(true)}>
          <Icon name="document" className="btn-icon" />
          บันทึกเป็น PDF / พิมพ์
        </button>
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
