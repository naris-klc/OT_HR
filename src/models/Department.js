import mongoose from 'mongoose';
import { model } from './model.js';
// Relative, like every other import that has to survive the retired Express
// server as well as the bundler.
import { OT_MODES, OT_MODE_DEFAULT } from '../../lib/otMode.js';

/**
 * แผนก. One department has one manager and roughly 5–6 people (§9).
 *
 * §12.3: the monthly cap lives HERE, not on a settings singleton. Some
 * departments cap at 40 hr/month, others have none — hence nullable.
 */
const departmentSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    nameTh: { type: String, trim: true },

    /** The one manager who approves this department's requests. */
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },

    /**
     * ฝ่ายบุคคลเป็นหัวหน้างานของแผนกนี้ — so this department has no first
     * signature to collect, and a request filed in it goes straight to the
     * ฝ่ายบุคคล step.
     *
     * A RULE ABOUT THE แผนก, WHICH IS THE WHOLE POINT OF THE FIELD. Both
     * แผนกจัดซื้อ and แผนกทรัพยากรมนุษย์ already routed this way before it
     * existed — but only because `initialStatus` could find nobody on the
     * roster to sign for them, which is an ACCIDENT of who happens to be
     * employed. The หน่วยงาน table writes ฝ่ายบุคคล into their หัวหน้างาน column
     * outright, and HR said it in those words on 2026-09-07: ฝ่ายบุคคลเป็น
     * หัวหน้าของแผนกจัดซื้อและแผนกทรัพยากรมนุษย์. Appoint a ผู้จัดการแผนกจัดซื้อ
     * tomorrow and, without this, every purchasing request would silently start
     * waiting for that signature instead — a routing rule changed by a roster
     * edit, with nothing anywhere saying so.
     *
     * IT ALSO MAKES THE RULE VISIBLE, which the accident could not. A แผนก with
     * nobody to sign wears ⚠ ยังไม่มีหัวหน้า on ตั้งค่าระบบ and counts towards
     * the แผนกมีปัญหา filter — the right warning for a department that has been
     * left without one, and the wrong one for these two, where the empty
     * column IS the answer rather than the problem.
     *
     * DEFAULT false, so that adding the field changes nothing for the sixteen
     * departments that do have a หัวหน้า and a row written before it existed
     * reads back as the ordinary department it has always been.
     */
    signedByHr: { type: Boolean, default: false },

    /**
     * [OPEN 8 / 9] null = no cap for this department. Counted per calendar
     * month on the basis set by policy.capBasis.
     */
    monthlyCapHours: { type: Number, default: null, min: 0 },

    /**
     * The same ceiling over a shorter window — null = none, and null is the
     * DEFAULT so that adding this field caps nobody who was not capped before.
     *
     * A pair rather than a replacement: forty hours in a month is a budget, and
     * a department can stay inside it while one person works thirty of them in
     * a single week. The two answer different questions and both are checked on
     * every submission (see `checkCap`), so an entry can breach either, both, or
     * neither.
     *
     * `null` and `0` are different answers and the code must never conflate
     * them — see `capBreaches` in lib/caps.js. Blank means no weekly ceiling;
     * zero means this department files no OT at all.
     *
     * Which week is `policy.weekStartsOn`, and the hours are attributed by the
     * date of each SEGMENT, so a shift crossing midnight into a new week is
     * split between the two rather than charged whole to the one it started in.
     */
    weeklyCapHours: { type: Number, default: null, min: 0 },

    /**
     * รูปแบบโอที — see lib/otMode.js, which holds the rule and the reason each
     * value exists. `normal` is the DEFAULT so that adding this field takes OT
     * away from nobody who had it: a row written before it existed reads back
     * as the ordinary department it has always been.
     *
     * Stored as the reason rather than as a boolean, because HR asked for two
     * different answers — a department that simply does no OT, and one paid
     * เหมารายวัน where the hours exist but the rate does not change. The system
     * treats them identically; the screens say which one it is, and a report
     * can too.
     */
    otMode: { type: String, enum: OT_MODES, default: OT_MODE_DEFAULT },

    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export default model('Department', departmentSchema);
