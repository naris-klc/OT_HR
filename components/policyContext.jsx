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
