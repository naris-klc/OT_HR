import mongoose from 'mongoose';
import { model } from './model.js';
import { EVENTS, retentionDays, RETENTION_MIN_DAYS } from '../../lib/accessLog.js';

/**
 * ข้อมูลจราจรทางคอมพิวเตอร์ — one document per API call, kept.
 *
 * Append-only in the same sense otEmployeeAudits and otPolicyVersions are, and
 * by the same mechanism: every field is `immutable`, so mongoose refuses a
 * restatement rather than leaving it to whoever writes the next route to
 * remember. There is no update path here and no method offering one, and the
 * only screen that reads it (บันทึกระบบ) offers no way to delete a row either.
 *
 * That matters more here than in the other two. A trail of OT figures that can
 * be rewritten answers no question that matters; a traffic log that can be
 * rewritten is worse than not having one, because its existence is what
 * somebody would be relying on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS NOT IN IT
 *
 * No request body, ever — see lib/accessLog.js for the reasoning and for the
 * two routes that make it non-negotiable. No response body either: the answer
 * to `GET /api/employees` is the roster, and a log that kept answers would be a
 * second copy of every personal detail in the system, in a collection with none
 * of the per-row permissions the first copy is protected by.
 *
 * What is kept is the envelope — who, from where, with what, asking for what,
 * and what the server said — which is exactly the list มาตรา ๒๖ is about.
 */
const accessLogSchema = new mongoose.Schema(
  {
    /**
     * request · login · login_failed · logout.
     *
     * `request` is every ordinary API call. The other three exist because the
     * two auth routes are the only ones whose OUTCOME is not readable from the
     * status code alone in a way anybody would trust: a 401 from
     * `POST /api/auth/login` is a wrong password, a 401 from anything else is
     * an expired session, and burying the first inside the second is how a
     * night of guessing goes unnoticed.
     */
    event: {
      type: String, enum: [...EVENTS], default: 'request', required: true, immutable: true, index: true,
    },

    method: { type: String, required: true, immutable: true },
    /** As requested, `/api` and all. The screen shortens it; the record does not. */
    path: { type: String, required: true, immutable: true },
    /**
     * The shape of the path — `/entries/:id/approve`. Stored as well as
     * derivable because ภาพรวม groups on it, and grouping on a value computed
     * at read time means either a `$function` in the aggregation or pulling
     * every row into node to count them. See `pathTemplate`.
     */
    template: { type: String, immutable: true, index: true },
    /** Redacted query string, or nothing. Never a body. */
    query: { type: String, immutable: true },

    status: { type: Number, immutable: true },
    /** Milliseconds. A slow route is an operational fact, not a legal one. */
    ms: { type: Number, immutable: true },
    /**
     * Did this request set out to change data? `isMutation` decides, and it is
     * not simply "the method is not GET" — see lib/accessLog.js.
     *
     * Indexed with the date because การแก้ไขข้อมูล is the tab people open
     * first, and it is `{ write: true }` sorted newest-first every time.
     */
    write: { type: Boolean, default: false, immutable: true },

    /**
     * WHO — denormalised, for the reason every other trail in this app
     * denormalises it (see src/models/EmployeeAudit.js) plus one this record
     * has and those do not: an account can be deleted, and the whole point of
     * a traffic log is that it still answers after that.
     *
     * `actor.id` stays as well, so the screen can filter by person across a
     * rename.
     */
    actor: {
      id: {
        type: mongoose.Schema.Types.ObjectId, ref: 'Employee', immutable: true, index: true,
      },
      code: { type: String, immutable: true },
      name: { type: String, immutable: true },
      role: { type: String, immutable: true },
    },

    /**
     * The employee code somebody TYPED at a login that failed.
     *
     * The one and only value from a request body that is ever written here, and
     * it is written for the reason the log exists: "รหัสพนักงานหรือรหัสผ่าน
     * ไม่ถูกต้อง" is deliberately the same sentence whether the code was real
     * or not (see app/api/auth/login/route.js), so without this the record of a
     * dictionary run would be four hundred identical rows saying somebody
     * failed to log in as somebody.
     *
     * NEVER THE PASSWORD. There is no field for one on this schema, which is
     * the guarantee — not a convention in the route that writes it.
     */
    attemptedCode: { type: String, immutable: true },

    /**
     * WHERE FROM. `ip` is the first hop; `via` is the untouched
     * `x-forwarded-for` chain when there was more than one, so the day a
     * reverse proxy appears in front of this app the difference is visible in
     * the record rather than inferred from the deployment. See `clientIp`.
     */
    ip: { type: String, immutable: true, index: true },
    via: { type: String, immutable: true },
    /** The user-agent as sent, truncated. `deviceLabel` is only how it prints. */
    userAgent: { type: String, immutable: true },
  },
  // No `updatedAt`: a document that cannot be updated has no such date, and
  // carrying an empty one invites somebody to fill it in.
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'otAccessLogs' },
);

/**
 * The two reads this collection actually gets, indexed.
 *
 * Newest-first over everything is the log screen with no filter on; newest-first
 * inside one `event` is every one of its tabs. A traffic log is written on every
 * single request, so it is the one collection here that will outgrow the rest by
 * an order of magnitude — an unindexed sort over it would slow down the screen
 * exactly as the history it holds becomes worth reading.
 */
accessLogSchema.index({ createdAt: -1 });
accessLogSchema.index({ event: 1, createdAt: -1 });
accessLogSchema.index({ write: 1, createdAt: -1 });
accessLogSchema.index({ 'actor.id': 1, createdAt: -1 });

/**
 * Automatic deletion — OFF unless somebody asks for it, and never below ninety
 * days when they do.
 *
 * มาตรา ๒๖ sets a floor of ninety days, not a ceiling, so the safe default is
 * to keep everything: a collection that has grown too big is a problem anybody
 * can solve on any Tuesday, and records that were deleted before they were
 * asked for is a problem nobody can solve at all.
 *
 * `LOG_RETENTION_DAYS` opts in, and `retentionDays` raises anything shorter
 * than the floor to it rather than obeying — the environment can lengthen
 * retention, it cannot shorten it past what the law requires.
 *
 * MONGO READS THIS INDEX ONCE, when it is created. Changing the variable on a
 * database that already has the TTL index will not move it; that takes
 * `collMod`, or dropping the index. Said here because the alternative is
 * somebody setting 365, seeing nothing change, and concluding logs are kept
 * forever when they are being deleted on the old schedule.
 */
const keepDays = retentionDays();
if (keepDays) {
  accessLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: keepDays * 86400 });
}

/** What the screen prints in its footer, so the promise on screen is this one. */
export const RETENTION = Object.freeze({ days: keepDays, minDays: RETENTION_MIN_DAYS });

export default model('AccessLog', accessLogSchema);
