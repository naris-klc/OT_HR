'use client';

import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';

const ToastContext = createContext(() => {});

/** `const toast = useToast(); toast('ยืนยันแล้ว'); toast(err.message, 'error');` */
export const useToast = () => useContext(ToastContext);

const LIFE = 4000;
const MAX = 3;

/**
 * The confirmation for something that closed the screen it happened on.
 *
 * `Alert` says its piece inside a card, which is right for a form that is still
 * open and wrong for a รายละเอียด pop-up that has just shut: the reviewer is
 * looking at the table again, and the row they decided about is gone from it.
 * This is what tells them it went through, and which person it was — HR works
 * through a queue several rows at a time, so a bare "สำเร็จ" answers the wrong
 * question.
 *
 * Errors do not time out. A message that says something failed and then removes
 * itself before it is read is worse than no message.
 */
export function ToastHost({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setItems((list) => list.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((message, kind = 'ok') => {
    if (!message) return null;
    const id = (seq.current += 1);
    // Oldest goes when a fourth arrives: a stack taller than that covers the
    // thing it is reporting on, which on a phone is most of the screen.
    setItems((list) => [...list.slice(-(MAX - 1)), { id, message, kind }]);
    if (kind !== 'error') {
      timers.current.set(id, setTimeout(() => dismiss(id), LIFE));
    }
    return id;
  }, [dismiss]);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* aria-live on the container, not on each toast: the region has to exist
          before the message lands in it or a screen reader announces nothing. */}
      <div className="toast-host no-print" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="msg">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="ปิดข้อความ">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
