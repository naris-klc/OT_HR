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
  { key: 'primus', label: 'ไพรมัส (Primus)' },
  { key: 'themtech', label: 'เดมเทค (Themtech)' },
];

/** Status palette, matching the design system in app/styles.css. */
export const STATUS = {
  pending_mgr: { label: 'รอหัวหน้า', bg: '#FBF1E0', fg: '#A8791A' },
  pending_hr: { label: 'รอ HR', bg: '#E7F0FA', fg: '#2A6099' },
  approved: { label: 'อนุมัติ', bg: '#E8F4ED', fg: '#0B6E37' },
  rejected: { label: 'ไม่อนุมัติ', bg: '#FBEAE7', fg: '#B4402F' },
  cancelled: { label: 'ยกเลิก', bg: '#F2F5F3', fg: '#7E8F85' },
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
