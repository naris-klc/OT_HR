/** Thin fetch wrapper. Auth rides on an httpOnly cookie, so no token handling. */

async function request(method, path, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    /**
     * `charset=utf-8` said out loud, added 2026-09-02 with Thai passwords.
     *
     * It changes nothing today and is not meant to: `fetch` encodes a string
     * body as UTF-8 whatever the header says, JSON is UTF-8 by definition
     * (RFC 8259), and `req.text()` on the other side decodes UTF-8 when no
     * charset is given. Every one of those is a DEFAULT, and the thing being
     * sent through here is now a password that can be Thai — where a mis-guessed
     * encoding does not produce a visible error, it produces an account whose
     * password nobody can type. Stating the encoding costs 14 bytes a request
     * and removes the guess.
     *
     * `uploadText` in lib/http.js matches on `multipart/form-data`, so nothing
     * server-side reads this header as an exact string.
     */
    init.headers['Content-Type'] = 'application/json; charset=utf-8';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, init);
  if (opts.raw) return res;

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
  upload: (p, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', p, fd);
  },
  /** Triggers a browser download without leaving the page. */
  download: async (p, filename) => {
    const res = await request('GET', p, undefined, { raw: true });
    if (!res.ok) throw new Error('ดาวน์โหลดไม่สำเร็จ');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export const BUCKETS = {
  OT15_WEEKDAY: 'ot15_weekday',
  OT15_HOLIDAY: 'ot15_holiday',
  OT3_HOLIDAY: 'ot3_holiday',
};

export const BUCKET_LABEL = {
  [BUCKETS.OT15_WEEKDAY]: 'OT วันปกติ ×1.5',
  [BUCKETS.OT15_HOLIDAY]: 'OT วันหยุด 08:00–17:00 ×1.5',
  [BUCKETS.OT3_HOLIDAY]: 'OT วันหยุด นอกเวลา ×3',
};

/**
 * The two payroll entities, mirrored from src/config/companies.js for the
 * client the same way BUCKETS above is mirrored from the engine. Keys must
 * match; the server validates against its own list, so a drift here shows up
 * as a rejected save rather than as a wrongly-filed employee.
 */
export const COMPANIES = [
  { key: 'primus', label: 'ไพรมัส (Primus)', shortTh: 'ไพรมัส', accountingCode: 'PM' },
  { key: 'themtech', label: 'เดมเทค (Themtech)', shortTh: 'เดมเทค', accountingCode: 'THT' },
];

/**
 * "PM · ไพรมัส" — how a company is named on สรุป OT ส่งบัญชี and nowhere else.
 *
 * `label` above stays as it is: the employee form and the profile screen are
 * read by people who know the company by name, and accounting's code means
 * nothing to them. Only the report that accounting receives leads with the code.
 */
export const accountingLabel = (c) => (
  c?.accountingCode ? `${c.accountingCode} · ${c.shortTh}` : (c?.shortTh || c?.label || '')
);

/**
 * A company KEY as the short Thai name — for rows that carry the key rather than
 * the whole object, like the birthday check on ตรวจสอบรายเดือน. An unknown key
 * prints itself: a screen that silently blanked one would hide the drift this
 * mirrored list exists to make visible.
 */
export const companyLabel = (key) => COMPANIES.find((c) => c.key === key)?.shortTh || key || '';

/** Status palette, matching the design system in app/styles.css. */
/**
 * The five statuses, as WORDS. The colours used to be here too — a pair of
 * hex values per status, applied as an inline style — and inline styles are the
 * one thing a theme cannot reach: every chip in the app stayed a pale pill on
 * charcoal the day ธีมมืด shipped. They are `.chip.st-*` in styles.css now,
 * built from the same status tokens the alerts and the boxes use.
 */
export const STATUS = {
  pending_mgr: { label: 'รอหัวหน้า' },
  pending_hr: { label: 'รอ HR' },
  approved: { label: 'อนุมัติ' },
  rejected: { label: 'ไม่อนุมัติ' },
  cancelled: { label: 'ยกเลิก' },
};

export const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

export function periodLabel(period) {
  if (!period) return '';
  const [y, m] = period.split('-').map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}

/** Both halves of a date, always two digits — see the note on `thaiDate`. */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * "19/09/2569" — วัน/เดือน/ปี, two digits each, ปี พ.ศ.
 *
 * ONE DATE FORM FOR THE WHOLE APP, asked for in those words on 2026-09-04.
 * Until then a date was written three ways depending on where you met it:
 * "19 กันยายน 2569" in prose, "19 ก.ย. 69" in a table, and whatever
 * `toLocaleString('th-TH')` produced on the audit trails. Three shapes for one
 * fact is three column widths to lay out for and three things a reader has to
 * learn are the same thing. DD/MM/YYYY is the shape the paperwork this app
 * replaces is already written in, and it is now the only shape the app writes.
 *
 * ZERO-PADDED, both halves, which is the reason this is spelled out by hand
 * rather than handed to the locale: `toLocaleString('th-TH')` gives `4/9/2569`,
 * and a column whose dates change width between the 9th and the 10th is
 * exactly what the padding is for.
 *
 * ปี พ.ศ., unchanged and deliberately. Storage is ค.ศ. everywhere — `workDate`,
 * `Employee.birthDate`, `Holiday.date` — and only the reading was ever Thai.
 * What moved on 2026-09-04 is the SHAPE; which year is meant did not move.
 *
 * Splits the 'YYYY-MM-DD' string rather than reading it through `new Date()`:
 * a workDate is a calendar day with no time and no zone, and a Date would shift
 * it by the office's offset.
 *
 * THE THREE PLACES THAT STILL SPELL A MONTH OUT, and each is a deliberate
 * exception rather than one this pass missed:
 *
 *   - `periodLabel` below. A งวด is a MONTH — "สิงหาคม 2569" — and there is no
 *     day in it to put first, so DD/MM/YYYY has nothing to say about it.
 *
 *     ⚠ A งวดจ่าย IS NOT A งวด, and the difference started to matter on
 *     2026-09-10. Everything that stores, files, approves, caps or closes is
 *     still per MONTH and this function is still what labels one. What can run
 *     to two months is the PAY CYCLE — พ.ย. + ธ.ค. are paid together in
 *     มกราคม — and that lives entirely in lib/accountingCycle.js as a
 *     reporting view. รายงาน OT การเงิน writes it by joining two of these
 *     labels with " + "; nothing here needs to know.
 *   - `readableDate` in lib/birthDate.js — the preview HR reads before a
 *     roster CSV is imported. Printing `05/03/1998` back as `05/03/2541` would
 *     restate the file instead of interpreting it, and since the importer
 *     stopped refusing month-first files on 2026-09-04 that line is the only
 *     check left between a transposed column and the roster.
 *   - the เดือน/วัน/ปี refusal in lib/smartDate.js, for the same reason.
 *
 *     A third stood beside them for half a day: the two ตัวอย่าง on ตั้งค่าระบบ
 *     → รูปแบบวันที่ใน CSV, which spelled out the two birthdays somebody was
 *     choosing between. That card and the choice it offered were withdrawn the
 *     same afternoon.
 */
export function thaiDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${pad2(d)}/${pad2(m)}/${y + 543}`;
}

const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

export function dayName(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * A STORED MOMENT, to the minute — "14/08/2569 16:03 น."
 *
 * `thaiDate` above takes a 'YYYY-MM-DD' string, which is what a `workDate` is:
 * a calendar day with no time and no zone. This is the opposite case — a
 * `history.at`, a real instant stored as a Date — which is why it is its own
 * function rather than a flag on `thaiDate`.
 *
 * NO SECONDS. It is read beside a name to answer "เซ็นเมื่อไหร่", which is a
 * question about the afternoon somebody signed and never about the second. The
 * dense trails that DO need the seconds take `thaiStamp` below; those two
 * differ by the seconds and by the "น.", and by nothing else.
 *
 * IN THE READER'S OWN ZONE, deliberately. Browser and server are the same
 * laptop and both are ICT, so today there is nothing to convert; if that stops
 * being true, a signature read in Bangkok should still print the Bangkok time,
 * and reading it locally is what gives that for free.
 *
 * Empty string on nothing and on an unparseable value, so a row written before
 * `at` existed prints no time rather than "Invalid Date".
 */
export function thaiDateTime(value) {
  const when = thaiStamp(value, { seconds: false });
  return when ? `${when} น.` : '';
}

/**
 * "14/08/2569 16:03:22" — the dense form, seconds included, because two rows
 * written in the same minute are ordered by nothing else.
 *
 * WHAT IT REPLACED, and why it is worth a function. Every audit trail on this
 * app printed `new Date(x).toLocaleString('th-TH')` — ประวัติการแก้ไข,
 * บันทึกการแก้ไขทะเบียนพนักงาน, ประวัตินโยบาย, แถบสถานะการสำรองข้อมูล and
 * บันทึกระบบ. That gives `14/8/2569 16:03:22`: the right order and the right
 * era, unpadded, in a shape nothing else on the app wrote — and different again
 * between `dateStyle: 'short'` and `'medium'`, which บันทึกระบบ used side by
 * side. All of them are this one function now, so a stamp read on one screen
 * and the same stamp read on another cannot be written two ways.
 *
 * `seconds: false` is the same stamp without them, for a list dense enough that
 * two more digits cost a column — บันทึกระบบ's card view is the one that asks.
 */
export function thaiStamp(value, { seconds = true } = {}) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const day = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + 543}`;
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return seconds ? `${day} ${clock}:${pad2(d.getSeconds())}` : `${day} ${clock}`;
}

/**
 * "อา." — and NOT the "วัน" prefix the long form carries.
 *
 * `วันอาทิตย์` reads as a sentence; in a column of forty, the prefix is the
 * same three characters on every row and carries nothing. The abbreviations are
 * the ones Thai calendars print.
 */
const DOW_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

export function dayAbbr(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return DOW_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export const hours = (n) => (n == null ? '–' : `${Math.round(n * 100) / 100}`);

/**
 * "ไพรมัส (Primus) · 128.5 ชม." — a filter dropdown's option, carrying the
 * total it selects so the month can be read off the closed select. Null hours
 * print the label alone, so an option never shows a total that is really just
 * "not loaded yet". Shared by the บริษัท and แผนก pickers, which are the same
 * control asking two different questions.
 */
export const withHours = (label, n) => (n == null ? label : `${label} · ${hours(n)} ชม.`);

/**
 * "นายสมชาย ใจดี" → "สมชาย". The ชื่อ, without the คำนำหน้า and without the
 * นามสกุล.
 *
 * WHAT IT IS FOR — the two ลงชื่อ columns on F-HR-027. HR asked for the given
 * name alone on 2026-09-02, and for nothing else in the box: the brackets that
 * used to hold the name went at the same time, so the cell carries a name and
 * no punctuation at all. See `Signed` in components/PrintForm.jsx.
 *
 * ⚠ THE TITLE CAME OFF ON 2026-09-08, and until then this was "the first
 * whitespace-separated word" and nothing else. That was written against a
 * roster of 22 seeded people; the real one was imported since, and on it the
 * rule printed `นายไพฑูร` and `นางสาวปิยะนุช` in the signature boxes — 163 of
 * the 164 rows carry a title, and every one of them writes it JOINED to the
 * given name rather than as a word of its own. So the first word was never a
 * bare นาย/นาง/นางสาว, exactly as the old note said, and the note was true
 * while being no protection at all: what arrived was the other spelling.
 *
 * นางสาว IS TESTED BEFORE นาง, which is the whole of the ordering rule — นาง is
 * a prefix of นางสาว, so the short one tested first would leave `สาวปิยะนุช` in
 * the box. The list is these three because these three are the roster; a title
 * it does not know (ว่าที่ ร.ต., ดร.) prints as part of the name, which is
 * visible on the paper rather than silent, and is fixed by adding it here.
 *
 * WHAT IS LEFT HAS TO BE SOMETHING. A name that is nothing but a title — or one
 * whose title is written apart, `นาย สมชาย ใจดี` — falls through to the next
 * word rather than emptying the box, and a signature box on a controlled form
 * is not a place to answer "" because a name was spelt in an unexpected way.
 *
 * A SINGLE-WORD NAME COMES BACK WHOLE, which is not a corner case here: the
 * account that signs for a แผนก with no หัวหน้า is `ผู้ดูแลระบบ`, one word and
 * no title. A split that returned "the part before the space" would blank the
 * box on exactly those rows.
 *
 * Here beside `hours` and `companyLabel` rather than in the component, for the
 * reason every pure rule in this app is: `node --test` cannot import a `.jsx`,
 * so a formatting rule that lives in one is a rule with no test.
 */
export const NAME_TITLES = Object.freeze(['นางสาว', 'นาง', 'นาย']);

export const firstName = (name) => {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const title = NAME_TITLES.find((t) => words[0].startsWith(t));
  if (!title) return words[0];
  return words[0].slice(title.length) || words[1] || words[0];
};
