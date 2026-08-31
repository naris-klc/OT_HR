'use client';

import React, { useEffect, useState, useRef } from 'react';
import { api, dayName, thaiDate, hours } from '@/lib/api.js';
import { DESCRIPTION_MAX_CHARS } from '@/src/config/policy.js';
import { submissionWindow } from '@/lib/entries.js';
import { today } from '@/lib/today.js';
import { Alert, BucketSplit, Modal, SegmentList, StatusChip } from './common.jsx';
import { usePolicy } from './policyContext.jsx';

const blank = () => ({
  /**
   * `today()` — the office's day — and NOT `new Date().toISOString()`, which is
   * what stood here.
   *
   * That reads the UTC date, so between midnight and 07:00 in Bangkok the form
   * opened on YESTERDAY. Harmless while nothing looked at the date twice; not
   * harmless now that the box carries a `min`, because with ยื่นย้อนหลัง set to
   * 0 the value it opens with would be outside its own allowed range before
   * anybody touched it.
   */
  workDate: today(),
  startTime: '17:00',
  endTime: '20:00',
  endsNextDay: false,
  noBreakTaken: false,
  description: '',
});

/**
 * The submit form — and, with `mode="hr"`, the form HR corrects an entry in.
 *
 * The employee enters one start and one end; the server does the splitting
 * (§3). The preview below the fields is that split, computed live — which is
 * how an employee finds out that Friday 17:00 → Saturday 07:00 is 7 hours at
 * ×1.5 plus 7 at ×3, rather than discovering it on the payslip.
 *
 * HR's mode is the same fields deliberately: a correction has to be previewed
 * against the same engine and the same department cap as the original, and
 * `employeeId` is what points the preview at the right person's cap rather
 * than at HR's own.
 *
 * `entry` edits a stored record — the employee's own while it is still waiting
 * on the manager, HR's at any live status. `template` only fills the fields in
 * — it is how an employee re-submits after a rejection without retyping, and
 * what it writes is a NEW request.
 *
 * `mode="birthday"` is the same form with two fields nailed shut, opened from a
 * row of วันเกิดที่ยังไม่มีใบ: the person and the date are the row, and what is
 * being entered is the pair of times off the fingerprint scanner. It shares
 * every line below it deliberately — the split, the ceiling, the refusal of a
 * 0-hour session and the live preview are the engine's answers and must be the
 * same answers here, or this would be the one request on the sheet arrived at a
 * different way. `birthday` carries `{ employeeId, name, code, date }`.
 */
export default function OtForm({
  entry, template, onSaved, onCancel, mode = 'employee', employeeId, birthday = null,
}) {
  const hrEdit = mode === 'hr';
  const proxy = mode === 'proxy';
  const fromBirthday = mode === 'birthday';

  /**
   * WHICH DAYS THE CALENDAR MAY OFFER — the same window the server enforces.
   *
   * `submissionWindow` in lib/entries.js does the arithmetic for both sides, so
   * the box cannot offer a day that POST /api/entries is about to refuse. The
   * policy is the copy /auth/me sent at sign-in; the refusal on the server is
   * the authority, and this is the part that stops somebody meeting it.
   *
   * WIDENED TO INCLUDE THE ENTRY'S OWN DATE WHEN EDITING, and this is the whole
   * of what makes it safe. An `<input type="date">` holding a value outside its
   * own min/max is INVALID — the browser blocks the submit, on a form where the
   * only thing being corrected might be the times. The backward window moves on
   * its own overnight, so without this every request in the queue would become
   * unsaveable simply by ageing, which is the exact failure the server-side rule
   * is written to avoid (it measures a date only when the date CHANGES). The
   * picker has to make the same allowance or it re-introduces it in the browser.
   *
   * NOT APPLIED ON A BIRTHDAY ROW. The date there is the row, the box is
   * disabled, and app/api/birthday/entries is exempt from the window on purpose
   * — วันเกิดที่ยังไม่มีใบ exists to settle days that were missed, and a bound
   * here would grey out exactly those.
   */
  const policy = usePolicy();
  const dateBounds = React.useMemo(() => {
    if (fromBirthday) return { min: undefined, max: undefined };
    const { min, max } = submissionWindow(today(), policy);
    const held = entry?.workDate;
    return {
      min: min && (!held || held >= min) ? min : undefined,
      max: max && (!held || held <= max) ? max : undefined,
    };
  }, [fromBirthday, policy, entry?.workDate]);

  /**
   * Who the request is FOR, when that is not whoever is filling the form in.
   *
   * A LIST, because a shift is a list. Eight people on the same Saturday, the
   * same hours and the same job is one thing that happened, and filing it as
   * eight separate visits to this form — pick a name, retype the date, retype
   * the times, retype the description, save, watch the form close, press the
   * button again — is the point at which a หัวหน้า decides the paper was
   * quicker. It was, which is the problem.
   *
   * What is filed is still ONE REQUEST PER PERSON, posted one at a time, and
   * that is not an implementation detail: the ceiling, the day types (somebody
   * on the list may be having a birthday), รูปแบบโอที and the day-conflict
   * check are all questions about an individual, and the server has to be
   * allowed to answer them individually. See `submit` below, and the summary it produces.
   *
   * `proxy` mode starts with NOTHING ticked, on purpose. A pre-selected first
   * name is the shape of mistake this feature could produce at scale — a
   * หัวหน้า filing five requests in a row and one of them landing on the wrong
   * person's month, where nothing on any screen would ever flag it. Nothing
   * computes and the button stays shut until somebody is chosen.
   */
  const [targets, setTargets] = useState([]);
  const [team, setTeam] = useState([]);
  const [teamError, setTeamError] = useState('');
  /**
   * What the server said about each person, once a batch has been posted.
   *
   * `null` until then. Non-null replaces the whole form with the summary —
   * a partial success is not a state anybody should be left to work out from a
   * toast, and the successful rows must not still be sitting under a button
   * that would file them again.
   */
  const [results, setResults] = useState(null);

  useEffect(() => {
    if (!proxy) return;
    api.get('/employees')
      .then((res) => setTeam((res.employees || []).filter((e) => e.role === 'employee')))
      .catch((err) => setTeamError(err.message));
  }, [proxy]);

  const toggleTarget = (id) => setTargets((t) => (
    t.includes(id) ? t.filter((x) => x !== id) : [...t, id]
  ));

  const nameOf = (id) => {
    const p = team.find((e) => String(e._id) === String(id));
    return p ? `${p.name} · ${p.code}` : id;
  };

  /**
   * WHOSE ceiling and whose day types the preview is computed against.
   *
   * One person, always — the engine takes one employee and there is no honest
   * way to render one split for eight. With a list ticked this is the FIRST of
   * them, and the panel says so rather than letting a reviewer read one
   * person's numbers as the batch's. The ceiling is hidden outright at that
   * point; see the note above the preview block.
   *
   * The authority was never this preview in any case — every person is
   * recomputed and re-checked by the server when the batch is posted.
   */
  const forWhom = proxy ? (targets[0] || '') : (fromBirthday ? birthday?.employeeId : employeeId);

  const [form, setForm] = useState(() => {
    const from = entry || template;
    if (from) {
      return {
        workDate: from.workDate,
        startTime: from.startTime,
        endTime: from.endTime,
        endsNextDay: from.endsNextDay,
        noBreakTaken: from.noBreakTaken,
        description: from.description,
      };
    }
    if (fromBirthday) {
      return {
        ...blank(),
        workDate: birthday?.date || '',
        /**
         * The times start EMPTY rather than at the usual 17:00–20:00.
         *
         * A birthday holiday is a whole วันหยุด, so its hours are typically a
         * day shift and nothing like the evening default — and these two fields
         * are the only thing on this form that is being read off a machine. A
         * pre-filled pair that happens to compute to a plausible number of hours
         * is exactly the kind of default somebody saves without reading.
         */
        startTime: '',
        endTime: '',
        /**
         * Pre-filled, and it says what HR actually knows. The scan record gives
         * two times and no account of the work; "OT วันหยุดวันเกิด" is the whole
         * of what can honestly be written from it, and it is editable for
         * anybody who does know more.
         */
        description: 'OT วันหยุดวันเกิด',
      };
    }
    return blank();
  });
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [cap, setCap] = useState(null);
  /** Where the server says this would land — see the preview route. */
  const [routing, setRouting] = useState(null);
  /**
   * And the same answer for a birthday filing: whether this press files and
   * approves in one act, or files something the หัวหน้า/ฝ่ายบุคคล still has to
   * sign. From `birthdayDirectApproval` on the server, never worked out here —
   * see the note on it in the preview route.
   */
  const [birthdayRouting, setBirthdayRouting] = useState(null);
  /**
   * รูปแบบโอทีของแผนก, answered by the server for THESE hours.
   *
   * A sentence or null, and never derived here from the department's mode: the
   * mode alone cannot answer it, because the same evening is refused on a
   * Tuesday and allowed on a holiday or on the person’s own birthday. The
   * server has just run the engine over these times — see `weekdayOtRefusal`.
   */
  const [weekdayRefusal, setWeekdayRefusal] = useState(null);
  /**
   * The request already on the books that this day — or these minutes — belongs
   * to.
   *
   * The server's own refusal, `{ status, error, conflict }`, or null, where
   * `conflict.kind` is `'sameDate'` (หนึ่งวัน หนึ่งใบ, what F-HR-027's one line
   * per day means) or `'overlap'` (the pair that crosses a midnight). Answered
   * by the preview route on every keystroke that moves the date or a time, so
   * the person finds out while looking at the fields that caused it rather than
   * after pressing บันทึก — see the note in app/api/entries/preview/route.js.
   *
   * NEVER computed here, and the date rule is no more computable in the browser
   * than the minute rule was. What this screen holds is one month of one list; a
   * day can already be filed by a request a หัวหน้า wrote on this person's
   * behalf, by one in a month the list is not showing, or by one filed while
   * this form has been open.
   */
  const [conflict, setConflict] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  /**
   * The <form> element's own id — and it is not decoration.
   *
   * On a birthday row this form is the body of a pop-up, and a pop-up's foot is
   * a SIBLING of its body: the button that saves is outside the <form> it
   * saves. `form={formId}` on that button is what puts it back inside, so the
   * required fields, the native validation and Enter-in-a-box all keep working
   * from the foot. Everywhere else the button is inside the form already and
   * the attribute is a no-op pointing at its own parent.
   */
  const formId = React.useId();

  /**
   * Is there typing here that closing would throw away?
   *
   * Asked only by the pop-up, which puts a question in front of ✕, Escape, the
   * backdrop and a swipe down. It cannot be "the fields are not blank": on a
   * birthday row the two times START empty and รายละเอียด starts filled in. So
   * it is "different from what the form opened with", compared against the
   * opening state itself — a change to those defaults cannot leave this line
   * behind.
   */
  const openedWith = useRef(form);
  const dirty = Object.keys(form).some((k) => form[k] !== openedWith.current[k]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Debounced live preview. Every keystroke in a time field would otherwise
  // hit the engine.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!form.workDate || !form.startTime || !form.endTime) return;
      // Filing for somebody else, the preview is worthless until the server
      // knows who: the ceiling and the day types are theirs, and a split
      // computed against nobody would disagree with what saving produces.
      if (proxy && !targets.length) {
        setPreview(null); setCap(null); setWeekdayRefusal(null); setConflict(null); return;
      }
      try {
        const res = await api.post('/entries/preview', {
          ...form, entryId: entry?._id, employeeId: forWhom, birthday: fromBirthday || undefined,
        });
        setPreview(res.result);
        setCap(res.cap);
        setRouting(res.routing || null);
        setBirthdayRouting(res.birthdayRouting || null);
        setWeekdayRefusal(res.weekdayRefusal || null);
        setConflict(res.conflict || null);
        setError('');
      } catch (err) {
        setPreview(null);
        setRouting(null);
        setBirthdayRouting(null);
        setWeekdayRefusal(null);
        // Cleared with everything else. A clash left on the screen beside times
        // the server could not even read is a refusal about a request that is
        // no longer being typed.
        setConflict(null);
        setError(err.message);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [form.workDate, form.startTime, form.endTime, form.endsNextDay, form.noBreakTaken, forWhom]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // `entry` means an existing record is being corrected in place — the
      // server decides whether this caller is allowed to. Without it (a blank
      // form, or one filled from `template`) this writes a new request.
      if (entry) await api.patch(`/entries/${entry._id}`, { ...form, note });
      /**
       * A door of its own, not `/entries` with a flag on it.
       *
       * The single-signature rule lives behind this endpoint and nowhere else,
       * and `/entries` has no branch that can reach `approved` — see
       * lib/birthdayFiling.js. Posting the same body to the ordinary route would
       * file an ordinary request, which is a safe way to be wrong and not a way
       * to get round anything.
       */
      else if (fromBirthday) {
        const res = await api.post('/birthday/entries', {
          ...form,
          workDate: birthday?.date,
          employeeId: birthday?.employeeId,
        });
        onSaved(res);
        return;
      } else if (proxy) {
        /**
         * ONE POST PER PERSON, IN ORDER, AND NOTHING IS ABANDONED ON A FAILURE.
         *
         * Not one request carrying eight names, and not `Promise.all`. Three
         * reasons, and the first is the one that decides it:
         *
         *   · Every rule the server applies here is about an individual — the
         *     monthly and weekly ceilings, the day types (a birthday on the
         *     list makes that person's whole day a holiday), รูปแบบโอที for
         *     their department, and the day-conflict check against what they have
         *     already filed. A batch endpoint would need its own copy of all
         *     four, which is four places for the rules to drift apart.
         *   · A refusal belongs to a name. Posted together, the first 409 would
         *     be the whole batch's answer and nobody would know which seven of
         *     the eight were fine.
         *   · Sequentially rather than concurrently because the ceiling is read
         *     and then written: two requests in flight for the same department
         *     can both read the same "used so far". Eight round trips on an
         *     office LAN is not the cost worth optimising here.
         *
         * `catch` per person, never around the loop. One person over their
         * ceiling must not stop the six after them being filed.
         */
        const out = [];
        for (const id of targets) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const res = await api.post('/entries', { ...form, employeeId: id });
            out.push({ id, ok: true, entry: res.entry });
          } catch (err) {
            out.push({ id, ok: false, error: err.message });
          }
        }
        // `onSaved` is NOT called here. It closes this form and reloads the
        // queue behind it, and the summary has not been read yet — it is the
        // screen now, and its own เสร็จสิ้น is what calls `onSaved`.
        setResults(out);
        return;
      } else {
        // A blank form writes a plain request. One filled from a REJECTED row
        // writes a request that points back at it, so the manager reviewing
        // this one can see they have refused it before and what they said.
        const refiledFrom = template?.status === 'rejected' ? template._id : undefined;
        await api.post('/entries', { ...form, refiledFrom });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * A batch has been posted — the summary replaces the form entirely.
   *
   * BEFORE the fields are rendered, so there is no path back to a บันทึก button
   * still holding eight names that have already been filed. Pressing it again
   * is exactly what a person does when a screen looks unchanged after a slow
   * save, and the ceiling would absorb the second copy silently.
   */
  if (results) {
    return (
      <BatchResult
        results={results}
        nameOf={nameOf}
        form={form}
        onDone={() => onSaved()}
        onRetryFailed={(failedIds) => {
          setTargets(failedIds);
          setResults(null);
          setError('');
        }}
      />
    );
  }

  // An entry written before the cap can be longer than it: `maxlength` stops
  // more being typed but never truncates what is already there, so say so and
  // make shortening it the condition of saving rather than cutting it silently.
  const over = form.description.length > DESCRIPTION_MAX_CHARS;

  /**
   * Does the conflict shut the button, or only warn beside it?
   *
   * It shuts it whenever the preview and the press are about the SAME person:
   * the write path answers 400 on exactly this, and offering a button the
   * server has already said no to teaches people to press through what the
   * screen tells them — the reason `weekdayRefusal` and a blocked ceiling grey
   * it too.
   *
   * It only warns on a batch of more than one, and that is not a softer rule —
   * it is a different question. The preview is computed against the FIRST name
   * ticked (see `forWhom`), so a day found already filed there belongs to that
   * one person, and shutting the button would refuse the other seven filings
   * over somebody else's day. Each POST is checked against its own person and
   * the summary names whoever was refused, which is the same treatment the
   * ceiling gets three blocks below.
   */
  const conflictBlocks = Boolean(conflict) && !(proxy && targets.length > 1);
  const overnight = form.endsNextDay;
  const endDateLabel = overnight ? nextDay(form.workDate) : form.workDate;

  /**
   * The title, said once for both shapes this form takes.
   *
   * It is an <h2> at the top of the card and the pop-up's own header line, and
   * those are two different elements in two different files — so the sentence
   * itself lives here, where the mode that decides it already lives.
   */
  const heading = hrEdit ? 'แก้ไขรายละเอียด (ฝ่ายบุคคล)'
    : proxy ? 'บันทึก OT แทนลูกทีม'
      : fromBirthday ? 'บันทึก OT ให้ — วันหยุดวันเกิด'
        : entry ? 'แก้ไขรายการที่ยื่นไว้'
          : template ? 'ส่งคำขอใหม่จากรายการเดิม'
            : 'บันทึกการทำงานล่วงเวลา';

  /** Everything between the title and the buttons — the same fields either way. */
  const fields = (
    <>
      {/*
        NOT THE SAME SENTENCE ON A BIRTHDAY ROW, because the usual one is false
        there. "เวลาทำงานปกติ … นอกเหนือจากนี้นับเป็น OT" tells the reader that
        08:00–17:00 is ordinary time — true on a working day, and the opposite
        of true on a วันหยุดวันเกิด, where the whole day is a holiday and every
        hour worked is OT. The detail pop-up on a filed birthday row shows
        exactly that: 08:00–17:00 booked as OT วันหยุด ×1.5.

        So ฝ่ายบุคคล were reading, immediately above the two boxes they were
        about to type scan times into, a rule that contradicted what the form
        was going to do with them. Replaced rather than merely shortened — the
        shorter version of a wrong sentence is still wrong — and the replacement
        is one line instead of three, which is the space the form wanted back.
      */}
      <div className="hint">
        {fromBirthday
          ? 'วันหยุดวันเกิดเป็นวันหยุดทั้งวัน — ชั่วโมงที่ทำทั้งหมดนับเป็น OT · ระบบจะแยกอัตรา ×1.5 และ ×3 ให้อัตโนมัติ'
          : 'เวลาทำงานปกติ จันทร์–ศุกร์ 08:00–17:00 น. · นอกเหนือจากนี้นับเป็น OT · ระบบจะแยกอัตรา ×1.5 และ ×3 ให้อัตโนมัติ'}
      </div>
      {entry && !hrEdit && (
        <div className="hint">
          แก้ไขวันที่ เวลา และรายละเอียดได้ระหว่างที่รายการยังรอหัวหน้าอนุมัติ ·
          ระบบจะคำนวณชั่วโมงใหม่และส่งข้อมูลที่แก้แล้วให้หัวหน้าพิจารณา ·
          เมื่อหัวหน้าหรือฝ่ายบุคคลอนุมัติแล้ว ต้องให้ฝ่ายบุคคลเป็นผู้แก้ไข
        </div>
      )}
      {hrEdit && (
        <div className="hint">
          {entry?.employee?.name && <>พนักงาน: <strong>{entry.employee.name}</strong> · </>}
          สถานะเดิมคงไว้ตามเดิม ไม่ต้องส่งกลับไปให้หัวหน้าอนุมัติใหม่ ·
          ระบบบันทึกผู้แก้ไขและเหตุผลไว้ในประวัติรายการ
        </div>
      )}

      {/* ── a row of วันเกิดที่ยังไม่มีใบ, opened ─────────────────────────── */}
      {fromBirthday && (
        <>
          {/* THE NAME AND THE DATE ARE IN THE HEADER NOW, and they are not said
              twice.

              They stood here in a `.box` because the form used to BE the
              screen: it replaced the queue it was opened from, and nothing else
              on it said whose birthday was being filed. As a pop-up it has a
              header that does not scroll, and that header carries the same
              three facts — ชื่อ · รหัส · วันที่ — over the fields for as long as
              the sheet is open. Of two copies the one inside the body is the
              one that scrolls away, so it is the one that goes.

              Both are still nailed shut and still checked against the roster by
              the server; วันที่เริ่ม below is rendered `disabled` and looks it.
              What is left here is the half that is an instruction, which is not
              something a header can say. */}
          <div className="hint">
            กรอกเฉพาะเวลาเข้า-ออกที่อ่านจากบันทึกสแกนนิ้ว — ระบบคำนวณชั่วโมงและอัตราให้เอง
          </div>

          {/*
            What this press will actually do, from the server's own answer.

            Two sentences, and only one of them is on screen at a time, because
            the difference between them is the whole of what is unusual here: a
            request that goes straight to อนุมัติ has no หัวหน้า behind it and the
            person pressing is signing for it alone. Reading that AFTER saving
            would be reading it too late.

            ── CUT DOWN TO ONE LINE, ASKED FOR BY HAND ──────────────────────

            It said five things and now says three. What went, and where each
            fact still lives, because a notice this one replaces is the last
            place any of them was stated on screen:

              · "ไม่ผ่านหัวหน้างานและไม่ผ่านคิวรอ HR" — the mechanism behind
                "ขั้นตอนเดียว", which the shorter line still names.
              · "ช่องลายเซ็นหัวหน้างานจะว่างไว้ตามจริง" — a PRINT consequence,
                and the only warning anywhere that the filed F-HR-027 comes out
                with an empty signature box. It is now visible only by printing
                one. components/PrintForm.jsx prints the reason line instead.
              · "ใบนี้เป็นของพนักงาน · หัวหน้าแผนกจะเห็นในสรุปทีม" — both are
                true and both are visible on those screens; neither changes what
                this press does, which is what the box is for.

            `tight` because this is a DIALOG — see the note over Alert in
            components/common.jsx. 12.5px is the size that variant exists to
            give, and every line this box takes is a line of the form that has
            to be scrolled past on a phone. The INFO twin below takes it too:
            they are one slot in two states, and a box that changed size with
            the routing would read as two different kinds of notice.
          */}
          {birthdayRouting?.ok && birthdayRouting.direct && (
            <Alert kind="warn" tight mark={false}>
              ⚡ บันทึกและอนุมัติทันทีในขั้นตอนเดียว — ระบบจะบันทึกว่า
              {' '}<strong>คุณเป็นทั้งผู้กรอกและผู้อนุมัติ</strong> (อ้างอิงจากเวลาสแกนนิ้ว)
            </Alert>
          )}
          {birthdayRouting?.ok && !birthdayRouting.direct && (
            <Alert kind="info" tight>
              บันทึกแล้วรายการนี้จะ<strong>เข้าคิวรออนุมัติตามปกติ</strong>
              {birthdayRouting.reason ? ` — ${birthdayRouting.reason}` : ''}
            </Alert>
          )}
          {birthdayRouting && !birthdayRouting.ok && (
            <Alert kind="error">{birthdayRouting.error}</Alert>
          )}
        </>
      )}

      {/* ── whose request this is ─────────────────────────────────────────── */}
      {proxy && (
        <>
          <div className="field" style={{ marginTop: 6 }}>
            <label>บันทึกแทนพนักงาน * {targets.length > 0 && `(เลือกแล้ว ${targets.length} คน)`}</label>
            {/* A scrolling box rather than a list that pushes the times and the
                preview off the screen. Twelve names is the tallest a แผนก here
                gets; the height is set so a team of that size is two or three
                flicks rather than a page of its own. */}
            <div className="pick-list">
              {team.map((p) => (
                <label key={p._id} className="check">
                  <input
                    type="checkbox"
                    checked={targets.includes(String(p._id))}
                    onChange={() => toggleTarget(String(p._id))}
                  />
                  {p.name} · {p.code}
                </label>
              ))}
            </div>
            {/* เลือกทั้งหมด is one tick and it is the common case — a whole
                small team on one Saturday. It is BELOW the list rather than
                above it, so it cannot be the thing a thumb lands on first. */}
            {team.length > 1 && (
              <div className="row" style={{ marginTop: 8, gap: 12 }}>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setTargets(team.map((p) => String(p._id)))}
                  disabled={targets.length === team.length}
                >
                  เลือกทั้งหมด ({team.length})
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setTargets([])}
                  disabled={targets.length === 0}
                >
                  ล้างที่เลือก
                </button>
              </div>
            )}
            <span className="field-note">
              เลือกได้เฉพาะพนักงานในแผนกของคุณ · เลือกหลายคนได้เมื่อทำ OT กะเดียวกัน วันเดียวกัน เวลาเดียวกัน
              {' '}· ระบบจะ<strong>แยกบันทึกเป็นคนละใบ</strong> และคิดชั่วโมง เพดาน วันหยุด ของแต่ละคนแยกกัน
            </span>
          </div>
          {teamError && <Alert kind="error">{teamError}</Alert>}
          {team.length === 0 && !teamError && (
            <Alert kind="warn">ไม่พบพนักงานที่บันทึก OT ได้ในแผนกนี้</Alert>
          )}

          {/*
            Said before anything is typed, not after it is saved. Two things
            about a proxy filing surprise people, and both are visible on the
            row afterwards whether or not anybody warned them: the request
            belongs to the employee and shows up on their screen, and it is not
            going to wait for the หัวหน้า who wrote it to approve it.
          */}
          <Alert kind="info">
            {targets.length > 1 ? 'แต่ละใบ' : 'รายการนี้'}จะเป็น<strong>ของพนักงาน</strong> ไม่ใช่ของคุณ
            {' '}— พนักงานจะเห็นในหน้า “OT ของฉัน”
            {' '}และแก้ไขเองได้ตราบใดที่ยังไม่มีผู้อนุมัติ ·
            {' '}ระบบจะบันทึกว่า<strong>คุณเป็นผู้บันทึกแทน</strong> ทั้งบนหน้าจอและในใบพิมพ์
            {/* Read off the server's own answer rather than assumed: whether
                the manager's step is skipped is a policy flag, and a promise
                the settings could contradict is worse than no promise. */}
            {routing?.skipped && (
              <> · และจะ<strong>ข้ามขั้นรอหัวหน้าไปยังรอ HR โดยตรง</strong>
                {' '}เพราะการที่คุณอนุมัติใบที่คุณกรอกเองไม่ได้เพิ่มการตรวจสอบใด ๆ
              </>
            )}
            {routing && !routing.skipped && (
              <> · ตามนโยบายปัจจุบัน รายการนี้จะ<strong>รอหัวหน้าอนุมัติตามปกติ</strong></>
            )}
          </Alert>
        </>
      )}

      {/* flex-start, not the row default of flex-end: วันที่เริ่ม carries a line
          of day/Thai-date underneath it and เวลาออก sometimes carries one too,
          so aligning bottoms drops whichever box has no line under it. Aligning
          tops puts the three labels on one line and the three boxes on the next,
          and the notes hang below without moving anything. */}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field">
          <label>วันที่เริ่ม</label>
          {/* Locked on a birthday row: the date IS the row, and the server
              refuses any other one anyway (it recomputes the person's birthday
              holiday and compares). Disabled rather than removed so the form
              still shows what it is about to save. */}
          {/* `min`/`max` are what grey the days out. The calendar drawn by an
              `<input type="date">` belongs to the browser — it is not in this
              document and no stylesheet here can reach inside it — but every
              browser this app runs on already dims and refuses days outside the
              range, which is the behaviour being asked for. What CSS here can
              do is say when the BOX itself holds a date outside the range; see
              `input:out-of-range` in app/styles.css.

              `undefined` rather than `''` for an absent bound: React drops the
              attribute entirely for undefined, where an empty string would be
              set and is treated by some browsers as a bound of its own. */}
          <input
            type="date"
            value={form.workDate}
            onChange={(e) => set('workDate', e.target.value)}
            min={dateBounds.min}
            max={dateBounds.max}
            disabled={fromBirthday}
            required
          />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            วัน{dayName(form.workDate)} · {thaiDate(form.workDate)}
          </span>
          {/* Said in words as well as drawn, because a greyed-out calendar tells
              somebody they cannot pick a day and not why, and the answer is a
              rule HR set rather than anything about their request. Only when a
              bound exists — with both ends open this line would be noise on
              every form. */}
          {(dateBounds.min || dateBounds.max) && (
            <span className="field-note">
              เลือกได้ {dateBounds.min ? thaiDate(dateBounds.min) : 'ไม่จำกัด'}
              {' – '}
              {dateBounds.max ? thaiDate(dateBounds.max) : 'ไม่จำกัด'}
            </span>
          )}
        </div>
        {/* `field time` rather than an inline `maxWidth: 130` — the two want to
            share a line at phone width, where `.field` is otherwise forced to
            100%, and an inline max-width is the one thing a media query cannot
            argue with. The 130px lives in the stylesheet now. */}
        <div className="field time">
          <label>{fromBirthday ? 'เวลาเข้า (สแกนนิ้ว)' : 'เวลาเริ่ม (จาก)'}</label>
          <input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} required />
        </div>
        <div className="field time">
          <label>{fromBirthday ? 'เวลาออก (สแกนนิ้ว)' : 'เวลาสิ้นสุด (ถึง)'}</label>
          <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} required />
          {overnight && (
            <span style={{ fontSize: 12, color: 'var(--amber)' }}>วัน{dayName(endDateLabel)}ถัดไป</span>
          )}
        </div>
      </div>

      {/* One per line on a phone — see .form-checks. Side by side they were two
          17px boxes about 6px apart with wrapped labels between them. */}
      <div className="row form-checks" style={{ marginTop: 14 }}>
        <label className="check">
          <input type="checkbox" checked={form.endsNextDay} onChange={(e) => set('endsNextDay', e.target.checked)} />
          ทำงานข้ามคืน (สิ้นสุดวันถัดไป)
        </label>
        <label className="check">
          <input type="checkbox" checked={form.noBreakTaken} onChange={(e) => set('noBreakTaken', e.target.checked)} />
          ไม่พักเที่ยง
        </label>
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>
          รายละเอียดงานที่ทำ
          <span style={{ float: 'right', fontWeight: 400, color: over ? 'var(--danger-ink)' : 'var(--muted)' }}>
            {form.description.length}/{DESCRIPTION_MAX_CHARS}
          </span>
        </label>
        <textarea
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={DESCRIPTION_MAX_CHARS}
          placeholder="เช่น สอบเทียบชุด PM-3000"
          required
        />
        <span style={{ fontSize: 12, color: over ? 'var(--danger-ink)' : 'var(--muted)' }}>
          {over
            ? `ข้อความเดิมยาวเกินกำหนด กรุณาตัดให้เหลือไม่เกิน ${DESCRIPTION_MAX_CHARS} ตัวอักษรก่อนบันทึก`
            : `ไม่เกิน ${DESCRIPTION_MAX_CHARS} ตัวอักษร — เท่าที่ช่องในใบ F-HR-027 พิมพ์ได้พอดี`}
        </span>
      </div>

      {/* Asked on every correction of a stored request, not only ฝ่ายบุคคล's.
          An employee revising their own request before the manager sees it
          still moves the hours, and the ประวัติรายการ shows that it moved —
          this is the only chance to record why.
          Required of ฝ่ายบุคคล and optional for the employee, matching the
          server rule in lib/entries.js: at pending_mgr there is no decision
          standing on the old values yet, so the reason is worth having and
          not worth blocking on. */}
      {entry && (
        <div className="field" style={{ marginTop: 14 }}>
          <label>เหตุผลการแก้ไข{hrEdit ? ' *' : ''}</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={hrEdit
              ? 'เช่น พนักงานแจ้งเวลาเลิกงานผิด ตรวจสอบกับหัวหน้าแล้ว'
              : 'เช่น กรอกเวลาเลิกงานผิด'}
            required={hrEdit}
          />
          <span className="field-note">
            {hrEdit
              ? 'บันทึกในประวัติรายการคู่กับค่าเดิมก่อนแก้'
              : 'ไม่บังคับ — ถ้ากรอก จะบันทึกในประวัติรายการคู่กับค่าเดิมก่อนแก้'}
          </span>
        </div>
      )}

      {error && <Alert kind="error">{error}</Alert>}

      {/* "วันนี้เป็นวันเกิดคุณ" — said before the split, because it is the reason
          the split looks the way it does.

          The employee filing for themselves ONLY. A birthday holiday on a
          Tuesday puts the hours in the วันหยุด columns and nothing else on this
          form explains why, so somebody who expected ×1.5 วันปกติ concludes they
          filed the wrong date. On a proxy filing the note is withheld: it would
          tell a หัวหน้า when their team member was born, and a birth date is not
          theirs to read (see `publicEmployee` in lib/employees.js). They see the
          columns and can ask HR, which is the same position they are in today. */}
      {/* …and withheld on a birthday-list filing for the same reason it is on a
          proxy one, twice over: the form already says whose birthday it is, and
          "ของคุณ" would be addressed to ฝ่ายบุคคล about somebody else’s. */}
      {preview && !proxy && !hrEdit && !fromBirthday && isOwnBirthday(preview) && (
        <Alert kind="info">
          วันที่เลือกเป็น<strong>วันเกิดของคุณ</strong> ซึ่งนับเป็นวันหยุดของคุณคนเดียว —
          {' '}ชั่วโมงในวันนี้จึงเข้าช่อง OT วันหยุด (08:00–17:00 ×1.5 · นอกเวลา ×3)
          {' '}ไม่ใช่ OT วันปกติ · ยื่นถูกแล้ว
        </Alert>
      )}

      {/* Shown with the hours still computed below it, deliberately: the times
          are not wrong and the split is worth reading — what is missing is a
          department that pays for them. The same sentence the write path would
          answer with, so pressing บันทึก could add nothing to it. */}
      {weekdayRefusal && <Alert kind="warn">{weekdayRefusal}</Alert>}

      {/* The day is already filed — above the split rather than below it,
          because it is not a fact about these hours. It is the answer to "have I
          already filed this?", and it has to be readable before the eye reaches
          the numbers it would otherwise be checking instead.

          THE SENTENCE IS THE SERVER'S, printed verbatim. It is the same string
          the 400 would carry, from `sameDateMessage` or `overlapMessage`, so a
          person who somehow reaches the refusal reads what the form had already
          told them rather than a second wording of it — and the date in it is
          written the way this form's own date box writes it, `05/08/2026`.

          The requests it names are drawn as ROWS underneath rather than left in
          the sentence: this is a screen, and the rows here look like the rows in
          ประวัติการขอ OT, which is where the person has to go and look. There
          the date IS prose, so `thaiDate` spells it, and the status wears the
          same chip that table gives it. */}
      {conflict && (
        <Alert kind={conflictBlocks ? 'error' : 'warn'}>
          <strong>{conflict.error}</strong>
          <ul className="clash-list">
            {conflict.conflict.entries.map((o) => (
              <li key={o.id}>
                <span className="when">
                  {thaiDate(o.workDate)} · {o.startTime}–{o.endTime}
                  {o.endsNextDay && ' (ข้ามคืน)'}
                </span>
                <StatusChip status={o.status} />
                {/* Only the minute rule has a span to report. */}
                {o.minutes != null && <span className="span">ทับกัน {o.minutes} นาที</span>}
              </li>
            ))}
          </ul>
          <div>
            {!conflictBlocks
              /* The batch case, said as what it is: one name's day, found on the
                 one name the preview could be computed for. */
              ? `เป็นของ ${nameOf(targets[0])} ซึ่งเป็นคนแรกในรายการ — คนอื่นระบบจะตรวจให้ทีละคนตอนบันทึก`
              : conflict.conflict.kind === 'sameDate'
                /* WHY one line, said once. Without it the rule reads as the
                   system being difficult about a day somebody genuinely worked
                   twice — and the answer to that day is one entry covering it,
                   which is what the paper has always meant. */
                ? 'ใบ F-HR-027 มีบรรทัดเดียวต่อหนึ่งวัน — ถ้าทำ OT วันนี้เพิ่ม ให้แก้เวลาในใบเดิมแทนการยื่นใบใหม่'
                : 'กรุณาแก้เวลาให้ไม่ทับกัน หรือยกเลิก/แก้ไขใบเดิมก่อน — บันทึกซ้ำไม่ได้'}
          </div>
        </Alert>
      )}

      {preview && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>ระบบคำนวณได้</div>
          <div className="hint" style={{ marginBottom: 8 }}>
            เวลาทั้งหมด {hours(preview.totals.clockHours)} ชม.
            {preview.totals.breakHours > 0 && ` · หักพัก ${hours(preview.totals.breakHours)} ชม.`}
          </div>
          {/* WHOSE NUMBERS THESE ARE, said out loud the moment there is more
              than one candidate for the answer.

              The engine takes one employee. With a list ticked this panel is
              computed against the first of them, and the two things that can
              differ down the list are named rather than left to be discovered
              on somebody's payslip: a person whose birthday falls on this date
              gets the whole day as วันหยุด and a different split, and the
              ceiling is counted per person against their own month. */}
          {proxy && targets.length > 1 && (
            <Alert kind="info">
              ตัวเลขนี้คำนวณจาก <strong>{nameOf(targets[0])}</strong> เป็นตัวอย่าง
              {' '}— อีก {targets.length - 1} คนระบบจะคำนวณแยกตอนบันทึก
              {' '}และอาจได้ไม่เท่ากันถ้าวันนี้ตรงกับวันเกิดของใครบางคน หรือใครใช้เพดานเดือนนี้ไปต่างกัน
            </Alert>
          )}
          <BucketSplit buckets={preview.buckets} total={preview.totals.otHours} label="รวมชั่วโมง OT" />
          <SegmentList segments={preview.segments} />
          {/* Keyed by code AND column: under `minimumHoursScope: 'bucket'` the
              minimum is measured per rate column, so one preview can carry two
              BELOW_MINIMUM_ACCEPTED warnings that differ only in `bucket`. */}
          {preview.warnings?.map((w) => (
            <Alert key={w.code + (w.bucket || '')} kind="warn">{w.message}</Alert>
          ))}
          {/* The ceiling is WITHHELD on a multi-person batch rather than shown
              for the first name.

              "ใช้ไปแล้ว 34 ชม." under a list of eight reads as the batch's
              figure, and it is one person's. Worse, it is the number a หัวหน้า
              would use to decide whether to file at all — and being wrong in
              that direction is how somebody gets told at the end that three of
              the eight were blocked. Each person's ceiling is checked by the
              server when their own request is posted, and the summary names
              whoever it stopped. */}
          {cap?.capHours != null && !(proxy && targets.length > 1) && (
            <Alert kind={cap.exceeded ? 'warn' : 'ok'}>
              เพดานแผนก {cap.capHours} ชม./เดือน · ใช้ไปแล้ว {hours(cap.usedHoursBefore)} ชม. ·
              {' '}รวมรายการนี้เป็น {hours(cap.projected)} ชม.
              {cap.exceeded && (cap.blocked ? ' — เกินเพดาน ไม่สามารถบันทึกได้' : ' — เกินเพดาน ระบบจะส่งให้ HR พิจารณา')}
            </Alert>
          )}
          {proxy && targets.length > 1 && (
            <div className="field-note" style={{ marginTop: 8 }}>
              เพดานของแต่ละคนต่างกัน จึงยังไม่แสดงตรงนี้ — ระบบจะตรวจให้ทีละคนตอนบันทึก
              {' '}และแจ้งชื่อคนที่ติดเพดานในสรุปผล
            </div>
          )}
        </div>
      )}
    </>
  );

  /**
   * ยกเลิก and the one that saves — written once, hung where the shape puts them.
   *
   * On a card they are the last row of the form. In the pop-up they are its
   * foot, which is pinned and does not scroll with the fields.
   *
   * `cancel` is handed in rather than closed over, and that is the whole point
   * of the argument: the pop-up passes its own `requestClose`, so ยกเลิก asks
   * about half-typed times exactly as ✕, Escape and the backdrop do, while the
   * card passes `onCancel`, which has nothing to ask.
   */
  const actions = (cancel) => (
    <>
      {onCancel && <button type="button" className="btn ghost" onClick={cancel}>ยกเลิก</button>}
      <button
        className="btn"
        form={formId}
        disabled={busy || over || !preview || preview.totals.otHours <= 0
          || (hrEdit && !note.trim()) || (proxy && !targets.length)
          // หนึ่งวัน หนึ่งใบ / เวลาทับซ้อน — the write path answers 400 on this.
          || conflictBlocks
          // Nothing is saved while the server says this row cannot take this
          // path — the write would 409, and the reason is already on screen.
          || (fromBirthday && birthdayRouting?.ok === false)
          // แผนกไม่มีโอที / เหมารายวัน, and these are weekday hours.
          || Boolean(weekdayRefusal)}
      >
        {entry ? 'บันทึกการแก้ไข'
          : proxy ? (busy
            ? `กำลังบันทึก… (${targets.length} ใบ)`
            // The count is on the button because it is the last thing read
            // before eight requests are filed, and "8 คน" is the fact most
            // worth being sure of at that moment.
            : `${routing?.skipped ? 'บันทึกแทนและส่งให้ HR' : 'บันทึกแทนและส่งให้หัวหน้า'}`
              + (targets.length > 1 ? ` · ${targets.length} คน` : ''))
            : fromBirthday
              ? (birthdayRouting?.direct ? 'บันทึกและอนุมัติ' : 'บันทึกและส่งเข้าคิว')
              : template ? 'ส่งคำขอใหม่' : 'ส่งขออนุมัติ'}
      </button>
    </>
  );

  /**
   * A BIRTHDAY FILING IS A POP-UP, NOT A SCREEN.
   *
   * It used to replace whichever list it was opened from — วันเกิดรอตรวจ or
   * วันเกิดของเดือนนี้ — the way HR's sub-views do. That is the wrong shape for
   * this one act, and the phone is where it showed:
   *
   *   · The row it is about is gone the moment the form is up, so the two facts
   *     being typed against (whose birthday, which date) survived only as a box
   *     the form drew for itself, which then scrolled away above the fields.
   *   · Its two buttons sat at the foot of a long form, which on a phone is a
   *     scroll away from the times somebody has just typed.
   *   · ไม่ได้มาทำงาน — the OTHER answer to the same row, one button along — has
   *     been a sheet from the bottom of the screen all along. Two answers to one
   *     question arriving as two different kinds of thing is the queue's own
   *     shape telling somebody they are doing two different sorts of act.
   *
   * So it comes up in the same `Modal` `AbsentModal` uses, which is a centred
   * dialog on a desktop and a bottom sheet below 860px, and which brings the
   * scrim, Escape, the swipe-down, the focus trap and the unsaved-typing
   * question with it. The list stays on screen behind the scrim.
   */
  if (fromBirthday) {
    return (
      <Modal
        title={heading}
        subtitle={`${birthday?.name} · ${birthday?.code} · ${thaiDate(birthday?.date)} (วัน${dayName(birthday?.date)})`}
        onClose={onCancel}
        dirty={dirty}
        footer={actions}
      >
        {/* The <form> is the dialog's body; the button that submits it is in the
            foot outside — see `formId` above. */}
        <form id={formId} className="modal-form" onSubmit={submit}>
          {fields}
        </form>
      </Modal>
    );
  }

  return (
    <form id={formId} className="card" onSubmit={submit}>
      <h2>{heading}</h2>
      {fields}
      <div className="row form-actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        {actions(onCancel)}
      </div>
    </form>
  );
}

/**
 * สรุปผลการบันทึกแทน — one line per person, and the refusals in full.
 *
 * A PARTIAL SUCCESS IS THE ORDINARY OUTCOME HERE, not the exception. Filing
 * one evening for eight people is eight independent decisions by the server:
 * one of them is over their monthly ceiling, another already has a request
 * covering 18:30, a third is in a department paid เหมารายวัน. A toast saying
 * "บันทึกแล้ว" is false, and one saying "เกิดข้อผิดพลาด" is false in the other
 * direction — six people's OT went in and nobody is being told.
 *
 * So the refusals are printed WHOLE. They are the server's own sentences, the
 * ones that name the ceiling, the clashing entry's date and times, or the
 * department's OT mode, and they are what somebody has to act on. Shortening
 * them to "ไม่สำเร็จ" would leave a หัวหน้า with a name and no next step.
 */
function BatchResult({ results, nameOf, form, onDone, onRetryFailed }) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  return (
    <div className="card">
      <h2>สรุปผลการบันทึกแทน</h2>
      <div className="hint" style={{ marginBottom: 12 }}>
        {form.workDate} · {form.startTime}–{form.endTime}{form.endsNextDay ? ' (ข้ามคืน)' : ''}
        {form.description ? ` · ${form.description}` : ''}
      </div>

      {/* The count first, in the words the person came for. `kind` follows the
          worst thing that happened rather than the best: a batch with one
          failure is not an "ok" batch, because the one failure is the whole
          reason to keep reading. */}
      {failed.length === 0 && (
        <Alert kind="ok">บันทึกสำเร็จทั้งหมด {ok.length} ใบ</Alert>
      )}
      {failed.length > 0 && ok.length > 0 && (
        <Alert kind="warn">
          บันทึกสำเร็จ {ok.length} ใบ · <strong>ไม่สำเร็จ {failed.length} ใบ</strong>
          {' '}— รายการที่สำเร็จถูกบันทึกไปแล้ว ไม่ต้องทำซ้ำ
        </Alert>
      )}
      {ok.length === 0 && (
        <Alert kind="error">ไม่สำเร็จทั้งหมด {failed.length} ใบ — ไม่มีรายการใดถูกบันทึก</Alert>
      )}

      <ul className="batch-result">
        {results.map((r) => (
          <li key={r.id} className={r.ok ? 'ok' : 'bad'}>
            <span className="mark" aria-hidden="true">{r.ok ? '✓' : '✕'}</span>
            <div className="who">
              <div className="nm">{nameOf(r.id)}</div>
              {/* The server's sentence, unedited. See the note above. */}
              {!r.ok && <div className="why">{r.error}</div>}
            </div>
          </li>
        ))}
      </ul>

      <div className="row form-actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        {/* Returns to the form with ONLY the failures ticked. That is what makes
            the button safe: the six that went in are no longer selected, so the
            obvious next act — fix the time, press save — cannot file them
            twice. */}
        {failed.length > 0 && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => onRetryFailed(failed.map((r) => r.id))}
          >
            แก้แล้วลองใหม่เฉพาะ {failed.length} คนที่ไม่สำเร็จ
          </button>
        )}
        <button type="button" className="btn" onClick={onDone}>เสร็จสิ้น</button>
      </div>
    </div>
  );
}

function nextDay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + 86400000).toISOString().slice(0, 10);
}

/**
 * Did the engine make this day a holiday because it is the filer's birthday?
 *
 * Read off the preview's own segments rather than by comparing dates in the
 * browser: the rule has three parts — the flag, the leap-day answer and the fact
 * that a weekend or company holiday takes precedence — and a second
 * implementation here would be a second answer to disagree with. `dayReason` is
 * what the server resolved for this exact session, so the note appears when, and
 * only when, the hours in the columns above got there that way.
 */
function isOwnBirthday(preview) {
  return (preview?.segments || []).some((s) => s.dayReason === 'birthday');
}
