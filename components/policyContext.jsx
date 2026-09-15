'use client';

import React, { createContext, useContext } from 'react';

/**
 * The live policy, for the screens that have to agree with it.
 *
 * A CONTEXT RATHER THAN A PROP, and the reason is the shape of the tree. The
 * form that needs this is opened from four places — OT ของฉัน, both approval
 * queues, ตรวจสอบรายเดือน and the birthday list — and two of them are three
 * components deep from the one place that has the policy in hand. Threading it
 * would put a `policy` prop through half a dozen components that have no use
 * for it, and the day a fifth screen opens the form it would be a prop somebody
 * forgets rather than a value already there.
 *
 * WHAT IS IN IT IS WHAT `/api/auth/me` SENDS, which is a deliberate subset of
 * the real policy — see the route. It is a copy taken at sign-in and is not
 * re-read: HR changing a rule mid-session does not move it. That is survivable
 * for what it is used for, because every one of those uses is a hint on a form
 * whose real enforcement is on the server. It would NOT be survivable for
 * anything that decided a number, and nothing here does.
 *
 * ⚠ SINCE 2026-09-14 ONE READER DECIDES WHETHER A BUTTON EXISTS AT ALL,
 * which is the first use here that is not a hint. รายการของฉัน reads
 * `cancelCutoffDay` to take แก้ไข · ยกเลิก · ขอถอนใบ off a row whose งวด has
 * closed and put a sentence there instead. The staleness bites the same way
 * round and no harder: HR turning the cutoff ON mid-session leaves an employee
 * already signed in holding buttons the server now refuses — which is the state
 * every one of those buttons was in before this key existed, since a status can
 * change under any open screen. It does NOT let anybody past a rule; the four
 * routes read the live policy. Signing in again is the whole of the fix, and
 * re-reading the session on a timer would be a fix for something nobody has
 * reported.
 *
 * `{}` when nothing has provided one, so a component can read a key off it
 * without guarding first. Missing keys then behave as the readers' own
 * fallbacks say they should — `submissionWindow` treats an absent forward
 * limit as the strict answer, which is the right way to be wrong.
 */
const PolicyContext = createContext({});

export function PolicyProvider({ policy, children }) {
  return (
    <PolicyContext.Provider value={policy || {}}>{children}</PolicyContext.Provider>
  );
}

export function usePolicy() {
  return useContext(PolicyContext);
}
