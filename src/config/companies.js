/**
 * The two legal entities the payroll is split between.
 *
 * OT hours are recorded once, in one system, but the two companies file their
 * payroll separately, so every employee has to be attributable to one of them.
 * Nothing in the domain branches on company: the engine, the caps and
 * F-HR-027 are all identical either way. It is a reporting-time partition,
 * which is why it lives here as data rather than as a branch anywhere in
 * src/lib.
 *
 * One report consumes it — สรุป OT ส่งบัญชี, the monthly submission sheet in
 * lib/accounting.js — which is the whole reason the field is carried.
 *
 * `codePrefixes` exists only to seed the field on existing rows and to
 * pre-fill the Admin form — the stored `company` on the employee is the
 * answer. A roster that stops following the prefix convention must not
 * silently move somebody onto the wrong payroll.
 */

export const COMPANIES = Object.freeze([
  Object.freeze({
    key: 'primus',
    nameTh: 'บริษัท ไพรมัส อินสตรูเมนท์ จำกัด',
    nameEn: 'Primus Instrument Co., Ltd.',
    shortTh: 'ไพรมัส',
    shortEn: 'Primus',
    codePrefixes: Object.freeze(['PM']),
  }),
  Object.freeze({
    key: 'themtech',
    nameTh: 'บริษัท เดมเทค จำกัด',
    nameEn: 'Themtech Co., Ltd.',
    shortTh: 'เดมเทค',
    shortEn: 'Themtech',
    codePrefixes: Object.freeze(['THT']),
  }),
]);

export const COMPANY_KEYS = Object.freeze(COMPANIES.map((c) => c.key));

/**
 * Where a code with no recognised prefix lands. Primus owns the system and the
 * non-roster accounts (HR-001, ADMIN) belong to it, so this is the safe side of
 * the guess — but it IS a guess, which is why both the CSV import and the
 * migration report every row that fell back here instead of matching.
 */
export const DEFAULT_COMPANY = 'primus';

export const companyByKey = (key) => COMPANIES.find((c) => c.key === key) || null;

export const companyLabel = (key) => companyByKey(key)?.shortTh || key || '';

/**
 * Infer the company from an employee code — 'PM00002' and 'PM-0412' are both
 * Primus, 'THT0002' is Themtech. Returns null when nothing matches, so callers
 * can tell "matched Primus" from "fell back to Primus".
 *
 * Longest prefix first: a two-letter prefix must never shadow a three-letter
 * one if the roster ever gains e.g. 'TH' alongside 'THT'.
 */
export function companyFromCode(code) {
  const normalised = String(code ?? '').replace(/\W|_/g, '').toUpperCase();
  if (!normalised) return null;

  const candidates = COMPANIES
    .flatMap((c) => c.codePrefixes.map((prefix) => ({ key: c.key, prefix })))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  return candidates.find(({ prefix }) => normalised.startsWith(prefix))?.key ?? null;
}
