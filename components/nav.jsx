'use client';

import React, { createContext, useContext, useEffect, useRef } from 'react';

const BackContext = createContext(null);

/**
 * A way out of a full-screen sub-view, registered while it is open.
 *
 * Every screen in this app is React state — the tab in Shell, and inside
 * several tabs a sub-view of their own (a form, one employee's entries, a
 * printable sheet). None of it touches the URL, so nothing has ever been
 * pushed onto the browser's history: `window.history.back()` would not return
 * to the previous screen, it would leave the app for whatever the person was
 * looking at before they opened it.
 *
 * The stack is kept in Shell instead, and this is how a screen joins it. The
 * newest registration is the innermost screen, so it is the first one "back"
 * unwinds — a form open over a table closes before the tab underneath both.
 *
 * The same stack would drive an Android hardware-back button; what that needs
 * on top of this is a popstate listener and a pushState per screen.
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
