'use client';

import React, { useEffect, useState } from 'react';
import ApprovalQueue from './ApprovalQueue.jsx';
import BirthdayQueue from './BirthdayQueue.jsx';

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
 * BOTH ROLES, ONE COMPONENT. ฝ่ายบุคคล reach it from รอ HR ยืนยัน and see every
 * team; a หัวหน้า reach it from รออนุมัติ and see their own. Nothing here decides
 * that — the queue asks the server, which scopes it by `departmentClaim`.
 *
 * `onCounts` reports each tab's number upward so the nav badge can carry the sum
 * (the badge is about the screen, not about one tab) while the tabs themselves
 * stay separate (they are two different jobs). The numbers arrive from the two
 * queues as they load, so a badge and the tab it opens cannot disagree.
 */
export default function QueueTabs({
  user, stage, onChanged, onOpenPolicy, initialTab = null, pendingCount = 0, onCounts,
}) {
  const [tab, setTab] = useState(initialTab === 'birthday' ? 'birthday' : 'entries');
  /**
   * The birthday tab's own number, from the queue itself rather than from the
   * nav summary. The summary is a snapshot taken when the tab last changed; this
   * is what is actually on screen, and the two would drift the moment somebody
   * answers a row without leaving the page.
   */
  const [birthdayCount, setBirthdayCount] = useState(null);

  /**
   * Arriving from the status line on ตรวจสอบรายเดือน, which sends people here to
   * a specific tab. Keyed on the signal rather than set once, so a second press
   * on that link works as well as the first.
   */
  useEffect(() => {
    if (initialTab === 'birthday') setTab('birthday');
  }, [initialTab]);

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
        <button
          role="tab"
          aria-selected={tab === 'birthday'}
          className={tab === 'birthday' ? 'active' : ''}
          onClick={() => setTab('birthday')}
        >
          วันเกิดรอตรวจ
          {birthdayCount > 0 && <span className="count">{birthdayCount}</span>}
        </button>
      </div>

      {/*
        Both stay mounted is NOT what happens here, and that is on purpose: the
        approval queue holds a selection, filters and a batch bar, and a tab that
        kept those alive while invisible would let somebody return to a batch
        built out of rows that have since been decided by somebody else.
      */}
      {tab === 'entries' ? (
        <ApprovalQueue
          user={user}
          stage={stage}
          onChanged={onChanged}
          onOpenPolicy={onOpenPolicy}
        />
      ) : (
        <BirthdayQueue
          onCountChange={(n) => {
            setBirthdayCount(n);
            onCounts?.(n);
          }}
        />
      )}
    </div>
  );
}
