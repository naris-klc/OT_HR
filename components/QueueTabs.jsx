'use client';

import React, { useEffect, useState } from 'react';
import ApprovalQueue from './ApprovalQueue.jsx';
import BirthdayQueue from './BirthdayQueue.jsx';
// Pure — no mongoose, no I/O. The same predicate the write routes refuse with.
import { birthdayActionPermission } from '@/lib/birthdayFiling.js';

/**
 * The two piles of work on one screen: requests waiting for a signature, and
 * birthdays waiting for somebody to check the scan record.
 *
 * A TAB RATHER THAN A NAV ENTRY, deliberately. They are the same job — "what is
 * outstanding for me" — done twice a day by the same person, and a fifth item in
 * the sidebar buys a permanent piece of chrome for a list that is empty most
 * months. This is also where the birthday list belongs at all: it was at the
 * foot of ตรวจสอบรายเดือน, which is a REPORT, and the two behave in opposite
 * ways. A report answers "is this month finished" and follows a month picker; a
 * queue answers "what is left" and must not, or the rows waiting longest are the
 * ones that disappear first.
 *
 * BOTH ROLES, ONE COMPONENT — for the approval queue. ฝ่ายบุคคล reach it from
 * รอ HR ยืนยัน and see every team; a หัวหน้า from รออนุมัติ and see their own.
 * Nothing here decides that — the queue asks the server.
 *
 * The BIRTHDAY tab is ฝ่ายบุคคล's alone as of 2026-08-13, so it is not drawn for
 * anybody else. That is a role test on a screen, which this file otherwise
 * avoids, and it is safe for the reason the avoidance existed: the rule it reads
 * is no longer a team-and-delegation question the server has to settle, it is a
 * two-role list, and it is read from `birthdayActionPermission` rather than
 * written out again here. The server refuses the same callers independently.
 *
 * `onCounts` reports each tab's number upward so the nav badge can carry the sum
 * (the badge is about the screen, not about one tab) while the tabs themselves
 * stay separate (they are two different jobs). The numbers arrive from the two
 * queues as they load, so a badge and the tab it opens cannot disagree.
 */
export default function QueueTabs({
  user, stage, onChanged, onOpenPolicy, onOpenRoster = null,
  initialTab = null, pendingCount = 0, birthdayCount: summaryCount = 0, onCounts,
}) {
  /**
   * Whether this person has a birthday tab at all — asked of the same function
   * the two write routes refuse with, not re-derived from a role here. Since
   * 2026-08-13 birthday rows are ฝ่ายบุคคล's alone, so a หัวหน้า has nothing to
   * do on that list; the server returns them an empty one, and this keeps them
   * from being shown an empty tab to find that out.
   *
   * `subject` is deliberately not passed: this asks "do you work with these
   * rows", which is a different question from "may you sign THIS one".
   */
  const maySettle = birthdayActionPermission({ user }).ok;
  const [tab, setTab] = useState(
    initialTab === 'birthday' && maySettle ? 'birthday' : 'entries',
  );
  /**
   * The birthday tab's own number, from the queue itself rather than from the
   * nav summary. The summary is a snapshot taken when the tab last changed; this
   * is what is actually on screen, and the two would drift the moment somebody
   * answers a row without leaving the page.
   *
   * `null` UNTIL THE TAB HAS BEEN OPENED, and that is the whole reason the
   * summary is still read below: the birthday queue is mounted only while its
   * tab is showing, so nothing had reported a number yet and the chip sat empty
   * on a tab with two rows behind it — the one number somebody needs BEFORE
   * deciding whether to open it. The nav badge knew all along (it is the sum
   * this screen's two tabs make up), so the tab now shows that until it has
   * something better. Live figure first, summary second, never the summary over
   * a figure the queue has actually reported.
   */
  const [birthdayCount, setBirthdayCount] = useState(null);
  const shownBirthdayCount = birthdayCount ?? summaryCount;

  /**
   * Arriving from the status line on ตรวจสอบรายเดือน, which sends people here to
   * a specific tab. Keyed on the signal rather than set once, so a second press
   * on that link works as well as the first.
   */
  useEffect(() => {
    if (initialTab === 'birthday' && maySettle) setTab('birthday');
  }, [initialTab, maySettle]);

  return (
    <div className="stack">
      <div className="queue-tabs no-print" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'entries'}
          className={tab === 'entries' ? 'active' : ''}
          onClick={() => setTab('entries')}
        >
          ใบรอยืนยัน
          {pendingCount > 0 && <span className="count">{pendingCount}</span>}
        </button>
        {maySettle && (
          <button
            role="tab"
            aria-selected={tab === 'birthday'}
            className={tab === 'birthday' ? 'active' : ''}
            onClick={() => setTab('birthday')}
          >
            วันเกิดรอตรวจ
            {shownBirthdayCount > 0 && <span className="count">{shownBirthdayCount}</span>}
          </button>
        )}
      </div>

      {/*
        Both stay mounted is NOT what happens here, and that is on purpose: the
        approval queue holds a selection, filters and a batch bar, and a tab that
        kept those alive while invisible would let somebody return to a batch
        built out of rows that have since been decided by somebody else.
      */}
      {tab === 'entries' || !maySettle ? (
        <ApprovalQueue
          user={user}
          stage={stage}
          onChanged={onChanged}
          onOpenPolicy={onOpenPolicy}
        />
      ) : (
        <BirthdayQueue
          onOpenRoster={onOpenRoster}
          onCountChange={(n) => {
            setBirthdayCount(n);
            onCounts?.(n);
          }}
        />
      )}
    </div>
  );
}
