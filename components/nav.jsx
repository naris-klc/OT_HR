'use client';

import React, { createContext, useContext, useEffect, useRef } from 'react';

const BackContext = createContext(null);

/**
 * A way out of a full-screen sub-view, registered while it is open.
 *
 * Every screen in this app is React state — the tab in Shell, and inside
 * several tabs a sub-view of their own (a form, one employee's entries, a
 * printable sheet).
 *
 * THE TAB IS IN THE URL SINCE 2026-09-11 (`#monthly`, written by `writeHash`
 * in App.jsx) AND A SUB-VIEW IS NOT. So a tab has a step in the browser's
 * history and a sub-view has none: the tab layer is unwound by
 * `window.history.back()`, and this layer is unwound by calling the handlers
 * registered here — which is what Shell's `popstate` listener does before it
 * lets a step go, pushing the step it was just handed straight back.
 *
 * It read "None of it touches the URL, so nothing has ever been pushed onto
 * the browser's history" until that day, when reload was asked to stay on the
 * screen it was on.
 *
 * The stack is kept in Shell, and this is how a screen joins it. The newest
 * registration is the innermost screen, so it is the first one "back" unwinds
 * — a form open over a table closes before the tab underneath both. The
 * Android hardware-back button and the phone's back gesture arrive as
 * `popstate` and walk this same stack.
 */
export function useBackHandler(active, handler) {
  const register = useContext(BackContext);
  // Held in a ref so a handler closing over fresh state stays correct without
  // re-registering on every render.
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!active || !register) return undefined;
    const fn = () => latest.current();
    return register(fn);
  }, [active, register]);
}

export function BackProvider({ register, children }) {
  return <BackContext.Provider value={register}>{children}</BackContext.Provider>;
}
