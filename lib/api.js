/** Thin fetch wrapper. Auth rides on an httpOnly cookie, so no token handling. */

async function request(method, path, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
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

export function thaiDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`;
}

const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

export function dayName(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * The same two facts as `thaiDate` + `dayName`, at a width a table column can
 * afford: "16 ส.ค. 69" and "อา.".
 *
 * FOR TABLES ONLY. Anywhere a date is read once — a pop-up, a printed form, a
 * confirmation — it is worth its full length, and those keep `thaiDate`. A
 * queue is the other case: forty dates read as a column, none of them
 * individually, and "16 สิงหาคม 2569" over "วันอาทิตย์" was taking three lines
 * per row to say what these say in two.
 *
 * The DAY OF THE WEEK IS NOT OPTIONAL, which is why it is abbreviated rather
 * than dropped. Saturday and Sunday are holidays, holidays are paid at a
 * different multiple, and "ส." beside a row is how a reviewer sees at a glance
 * why its hours landed in the ×3 column.
 *
 * Two-digit year, like the rest of a compressed column: a queue never spans a
 * century, and "69" beside "16 ส.ค." cannot be read as anything but 2569.
 */
const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

export function thaiDateShort(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${THAI_MONTHS_SHORT[m - 1]} ${String(y + 543).slice(-2)}`;
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
