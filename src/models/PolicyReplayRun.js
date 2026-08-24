import mongoose from 'mongoose';
import { model } from './model.js';

/**
 * Every time somebody ordered a replay — including the times it changed nothing.
 *
 * The per-entry trail already records what moved: a replay that restates an
 * approved entry writes a `before` snapshot into its history, and the monthly
 * review shows it beside the ordinary corrections. That is the right place for
 * it and it is deliberately quiet — a correction column that fills with two
 * hundred rows which moved nothing is a column HR stops reading, and then the
 * one row that did move is lost in it.
 *
 * The cost of being quiet is that a replay which moved nothing leaves no trace
 * whatsoever, and afterwards nobody can tell "the recompute ran and the figures
 * held" from "the recompute was never run". Those call for opposite reactions
 * at month end, and the entries themselves cannot distinguish them: both look
 * like a month where nothing happened.
 *
 * So the operation is logged here, once per run, whatever it touched. Separate
 * collection, not the entries' history, because it answers a different question
 * — who ordered this, when, under what note, against which rule set, over how
 * many rows — and joining the two would put a row about the month into every
 * entry in it.
 *
 * Append-only for the same reason otPolicyVersions is: a log that can be edited
 * afterwards is not evidence of anything. Every field is `immutable` and no
 * method here offers an update.
 */
const policyReplayRunSchema = new mongoose.Schema(
  {
    /**
     * WHAT KIND OF ACT THIS RUN WAS. Indexed, because it is the first thing
     * anybody asks of this collection months later.
     *
     *   'policy_save' — a flag under นโยบายการคำนวณ was answered (lib/policySave.js)
     *   'manual'      — POST /api/settings/recompute, ordered by an administrator
     *   'birthdate'   — a วันเกิด was corrected on ทะเบียนพนักงาน
     *
     * The last one is separate from 'manual' for a reason that outlives the
     * code: 'manual' with `includeApproved` is somebody deciding a POLICY
     * question was answered wrong and restating a signed-off month on that
     * reading — `authorizeReplay` gates it to an administrator with a written
     * reason. 'birthdate' is a recorded fact being corrected, does not consult
     * that rule, and is reachable by ฝ่ายบุคคล. Two different authorities, two
     * different things to be suspicious of when reading back, one collection.
     *
     * No enum, deliberately: a value stored before this list grew must stay
     * readable, and mongoose validates the whole document on save.
     */
    source: { type: String, required: true, immutable: true, index: true },

    by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', immutable: true },
    /** Denormalised, like `history.byName`: an audit row must survive a deletion. */
    byName: { type: String, immutable: true },

    /**
     * Why. Required by `authorizeReplay` whenever the run could touch an
     * approved entry, and carried here even when it was optional, because a run
     * with a reason attached is the only kind that can be reviewed later.
     */
    note: { type: String, immutable: true },

    /** The mongo filter the run was given — which month, which statuses. */
    filter: { type: mongoose.Schema.Types.Mixed, immutable: true },
    /** Whether signed-off entries were in scope. The fact worth searching on. */
    includeApproved: { type: Boolean, default: false, immutable: true, index: true },

    /** The rule set everything was replayed against. Null if none was recorded. */
    toVersion: { type: mongoose.Schema.Types.ObjectId, ref: 'PolicyVersion', immutable: true },
    /**
     * The rule sets the scanned entries were carrying before it ran, with counts
     * — the "from" half of "version 3 → version 4", which is a set rather than a
     * value because a month can hold several.
     */
    fromVersions: {
      type: [{
        _id: false,
        version: { type: mongoose.Schema.Types.ObjectId, ref: 'PolicyVersion' },
        count: Number,
      }],
      default: [],
      immutable: true,
    },

    // ── what it did, as counts (see summariseReplay in lib/policyVersion.js) ──
    /** Matched the filter. */
    scanned: { type: Number, default: 0, immutable: true },
    /** Actually recomputed — `scanned` less the ones the approved rule held back. */
    replayed: { type: Number, default: 0, immutable: true },
    /** Of those, the ones whose figures came out different. Often zero. */
    changed: { type: Number, default: 0, immutable: true },
    /** Held back because they were approved and the escape hatch was not used. */
    skipped: { type: Number, default: 0, immutable: true },
    failed: { type: Number, default: 0, immutable: true },
    /** How many signed-off entries this run was allowed to touch. */
    approvedReplayed: { type: Number, default: 0, immutable: true },

    /**
     * The ones that threw, named. A count alone says a replay was incomplete
     * without saying which rows to go and look at, and an entry the engine now
     * refuses is exactly the row somebody has to open by hand.
     */
    failures: {
      type: [{
        _id: false,
        entry: { type: mongoose.Schema.Types.ObjectId, ref: 'OtEntry' },
        error: String,
      }],
      default: [],
      immutable: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'otPolicyReplayRuns' },
);

/** The monthly review asks "was this month replayed, and when". */
policyReplayRunSchema.index({ createdAt: -1 });

export default model('PolicyReplayRun', policyReplayRunSchema);
