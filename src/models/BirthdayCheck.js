import mongoose from 'mongoose';
import { model } from './model.js';
import { BIRTHDAY_OUTCOMES, OUTCOME } from '../../lib/birthdayCheck.js';

/**
 * "ตรวจแล้ว — วันนั้นเขาไม่ได้มาทำงาน" — the answer to a birthday on
 * วันเกิดที่ยังไม่มีใบ that is not an OT request.
 *
 * WHY IT EXISTS. The list asks one question per name: was this person at work on
 * their birthday holiday? There are two answers and only one of them used to be
 * recordable. "มาทำงาน" writes an OT request, which is its own evidence and
 * takes the row off the list for good. "ไม่ได้มาทำงาน" — the ordinary answer,
 * most months — wrote nothing at all, so the same name came back next time
 * anybody opened the screen and there was no way to tell a birthday nobody had
 * looked at from one somebody had already rung the หัวหน้า about. This is that
 * second answer, written down.
 *
 * IT IS NOT AN OT REQUEST, AND THE SEPARATION IS THE POINT. There is no field
 * here for hours, no status, no approval, no department and no period. It cannot
 * reach a report, a cap, a queue or F-HR-027 because it holds nothing any of
 * them could read — which is a stronger guarantee than a flag on OtEntry that
 * every rollup would then have to remember to exclude. See
 * test/birthdayCheck.test.js, which pins that nothing in lib/ imports it.
 *
 * APPEND-ONLY, exactly as PolicyVersion is, and by the same mechanism: every
 * field is `immutable`, so mongoose refuses a write that would restate a row
 * rather than leaving it to whoever writes the next route. Getting it wrong is
 * undone by writing a second row with `outcome: 'cancelled'`, never by deleting
 * the first — the question "who said this person was away, and when" has to stay
 * answerable after somebody changes their mind about it.
 *
 * The LIVE answer for a person and a date is therefore the newest row for that
 * pair, not "does a row exist" — see `absentKeys` in lib/birthdayCheck.js, which
 * is where that rule lives and is tested.
 */

/**
 * The two things a row can say, from lib/birthdayCheck.js rather than declared
 * here — the same direction PolicyVersion takes `samePolicy` from, and for the
 * same reason: the rule that reads this vocabulary (`absentKeys`) is pure and
 * tested without mongoose, and the screen that writes it cannot import a model
 * at all.
 *
 * There is deliberately no 'present' value. A person who WAS at work is
 * recorded by the OT request filed for them, and a second document saying the
 * same thing is a second account to disagree with the first.
 */
export { BIRTHDAY_OUTCOMES, OUTCOME };

export const OUTCOME_LABEL_TH = Object.freeze({
  [OUTCOME.ABSENT]: 'ไม่ได้มาทำงาน',
  [OUTCOME.CANCELLED]: 'ยกเลิกการบันทึก',
});

const birthdayCheckSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      immutable: true,
      index: true,
    },

    /**
     * The date of the HOLIDAY being answered about — 'YYYY-MM-DD', a wall-clock
     * string for the reason `OtEntry.workDate` and `Employee.birthDate` are
     * (no timezone can move it). NOT the date of birth: they are the same day
     * this year and different facts, and only one of them belongs in a
     * collection a หัวหน้า's screen writes to.
     */
    workDate: {
      type: String,
      required: true,
      immutable: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },

    outcome: {
      type: String,
      enum: BIRTHDAY_OUTCOMES,
      required: true,
      immutable: true,
    },

    checkedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      immutable: true,
    },
    /**
     * Denormalised beside the pointer for the reason `history.byName` and
     * `PolicyVersion.createdByName` are: this is a record somebody will read
     * back months later to find out who decided, and a name that has to resolve
     * a pointer stops resolving the moment that person leaves.
     */
    checkedByName: { type: String, immutable: true },

    /**
     * When the check was made. Its own field rather than leaning on `createdAt`,
     * because this is the fact the record is FOR — `createdAt` is bookkeeping
     * about the document, and the two are free to be the same without one
     * standing in for the other.
     */
    checkedAt: { type: Date, default: Date.now, immutable: true },

    /** Optional. "ลาพักร้อน", "สแกนเข้า 08:02 แต่เป็นวันลา" — free text. */
    note: { type: String, immutable: true, maxlength: 500 },
  },
  // No `updatedAt`. A document that cannot be updated has no such date, and
  // carrying an empty one would invite somebody to fill it in.
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'otBirthdayChecks' },
);

/** The one query this collection serves: every check in a month, newest last. */
birthdayCheckSchema.index({ workDate: 1, employee: 1, checkedAt: 1 });

export default model('BirthdayCheck', birthdayCheckSchema);
