/**
 * ตำแหน่ง · แผนก · บทบาท — the three boxes beside ค้นหาพนักงาน on ทะเบียนพนักงาน,
 * and the rule behind both halves of them: which rows survive, and what the
 * boxes are allowed to offer.
 *
 * ── WHY THE OPTIONS ARE COMPUTED AND NOT LISTED ────────────────────────────
 *
 * Asked for on 2026-09-14 and settled before a line of JSX existed: the lists
 * hold *เฉพาะที่มีจริง* — the values 164 real rows are carrying, with the number
 * of people behind each. A list built from the หน่วยงาน table instead would
 * offer แผนก nobody is in, and there is no such thing as a table of ตำแหน่ง at
 * all: it is a free-text field on the employee, forty distinct strings today.
 *
 * ── AND WHY EACH BOX IS NARROWED BY THE OTHER TWO ──────────────────────────
 *
 * `facetOptions` counts the rows that pass every filter EXCEPT the one it is
 * building. Choose แผนกผลิต1 and ตำแหน่ง drops to the titles held inside it —
 * not the forty, thirty-odd of which would hand back an empty table. The count
 * beside each row is the size of the table that row would produce, which is the
 * only number that is worth printing there.
 *
 * ⚠ THE VALUE A BOX IS CURRENTLY SET TO IS NEVER DROPPED FROM ITS OWN LIST,
 * even when the other two filters leave nobody holding it. A dropdown that does
 * not contain the value it is displaying is a control that cannot be read and
 * cannot be pressed back to where it was — the reader's only way out would be
 * ล้างตัวกรอง, which throws away the other two choices as well. It is drawn with
 * `count: 0`, which says exactly what happened.
 *
 * Pure — no mongoose, no request, no clock — so `node --test` holds it to the
 * behaviour above without rendering anything, and the screen is left with the
 * drawing. Same split as lib/personSearch.js, which is the other half of this
 * bar.
 */

import { ROLES, ROLE_LABEL_TH } from './roles.js';

/**
 * The value standing for "this row has nothing in that column".
 *
 * Every roster today has a ตำแหน่ง and a แผนก on every row, so this draws
 * nothing — it exists because the CSV import does not require either, and a
 * blank that cannot be filtered for is a blank nobody can find to fix. NUL is
 * not a character any of the three columns can hold: ตำแหน่ง is Thai typed by a
 * person, แผนก is an ObjectId, บทบาท is one of seven ASCII slugs.
 *
 * It is NOT `''`, which the boxes already spend on ทุกตำแหน่ง / ทุกแผนก /
 * ทุกบทบาท — "do not narrow this" and "narrow this to the ones with nothing"
 * are different instructions and must not share a value.
 */
export const BLANK = '\u0000';

/** What that row says on the list. */
export const BLANK_LABEL = '— ยังไม่ระบุ —';

/**
 * The three columns, each as the pair of questions a filter asks of a row:
 * WHICH value is this person in, and what is that value CALLED.
 *
 * `label` is read off a person rather than looked up in a table, because two of
 * the three have no table to look it up in — the department name arrives
 * populated on the row itself, and a ตำแหน่ง is its own label.
 *
 * `order` is how the list is sorted. บทบาท takes `ROLES`, which is lowest-first
 * and load-bearing everywhere else in the app (see lib/roles.js); the other two
 * are Thai text and sort as Thai readers expect. Sorting บทบาท alphabetically
 * would put ผู้ดูแลระบบ above พนักงาน for no reason a reader could name.
 */
export const FACETS = Object.freeze({
  position: {
    label: 'ตำแหน่ง',
    all: 'ทุกตำแหน่ง',
    value: (p) => String(p?.position ?? '').trim(),
    text: (p) => String(p?.position ?? '').trim(),
  },
  department: {
    label: 'แผนก',
    all: 'ทุกแผนก',
    /* Populated object on the way in from `/employees?all=1`, and a bare id if
       it ever is not: the id is what identifies a แผนก, and two แผนก are
       allowed to share a name. */
    value: (p) => (p?.department ? String(p.department._id ?? p.department) : ''),
    /* The same fallback the table's own cell uses — nameTh, then name. */
    text: (p) => (p?.department ? String(p.department.nameTh || p.department.name || '') : ''),
  },
  role: {
    label: 'บทบาท',
    all: 'ทุกบทบาท',
    value: (p) => String(p?.role ?? '').trim(),
    text: (p) => ROLE_LABEL_TH[p?.role] || String(p?.role ?? ''),
    order: ROLES,
  },
});

/** The three of them, in the order they stand on the bar. */
export const FACET_KEYS = Object.freeze(Object.keys(FACETS));

/** Is anything in force at all? — what draws ล้างตัวกรอง and the count line. */
export function anyFilter(filters) {
  return FACET_KEYS.some((k) => String(filters?.[k] ?? '') !== '');
}

/** Does this person pass ONE box? An unset box passes everybody. */
function passes(person, key, want) {
  if (want === '') return true;
  const has = FACETS[key].value(person);
  return want === BLANK ? has === '' : has === want;
}

/**
 * The rows that survive the boxes.
 *
 * `skip` leaves one box out, which is what `facetOptions` needs and nothing
 * else does: a list has to be counted against the OTHER filters, or choosing a
 * row would be the last thing anybody could do with that box.
 *
 * Hands back the array it was given when nothing is in force, rather than a
 * copy — the caller memoises on the result, and rebuilding 164 rows into a new
 * array on every keystroke elsewhere would re-render the table for no change.
 * Same bargain `searchPeople` makes.
 */
export function filterRoster(people, filters, skip = null) {
  const list = Array.isArray(people) ? people : [];
  const keys = FACET_KEYS.filter((k) => k !== skip && String(filters?.[k] ?? '') !== '');
  if (keys.length === 0) return list;
  return list.filter((p) => keys.every((k) => passes(p, k, String(filters[k]))));
}

/** Sort one facet's rows: its own order where it has one, Thai text otherwise. */
function sortRows(rows, key) {
  const { order } = FACETS[key];
  if (order) {
    const at = (v) => { const i = order.indexOf(v); return i < 0 ? order.length : i; };
    return rows.sort((a, b) => at(a.value) - at(b.value) || a.label.localeCompare(b.label, 'th'));
  }
  /* ยังไม่ระบุ last, wherever Thai collation would otherwise file a NUL. It is
     the row about rows that are missing something, and it belongs under the
     ones that are not. */
  return rows.sort((a, b) => (
    (a.value === BLANK ? 1 : 0) - (b.value === BLANK ? 1 : 0)
    || a.label.localeCompare(b.label, 'th')
  ));
}

/**
 * What one box offers, with the size of the table each row would produce.
 *
 * @param {Array<object>} people the roster, already narrowed by ค้นหาพนักงาน
 * @param {object} filters the three boxes as they stand
 * @param {string} key which box is being built
 * @param {Array<object>} [roster] the WHOLE register, for naming a chosen value
 *   that nothing in `people` is carrying any more — a แผนก is an id, and a row
 *   labelled with one is a row nobody can read. Defaults to `people`.
 * @returns {Array<{value: string, label: string, count: number}>}
 */
export function facetOptions(people, filters, key, roster = people) {
  const facet = FACETS[key];
  const base = filterRoster(people, filters, key);
  const found = new Map();
  for (const p of base) {
    const value = facet.value(p) || BLANK;
    const row = found.get(value);
    if (row) { row.count += 1; continue; }
    found.set(value, {
      value,
      label: value === BLANK ? BLANK_LABEL : (facet.text(p) || value),
      count: 1,
    });
  }
  const rows = sortRows([...found.values()], key);

  /* THE CHOSEN ROW, WHEN THE OTHER TWO FILTERS HAVE EMPTIED IT — see the ⚠ at
     the top of this file. Its label is looked up in the WHOLE roster handed in,
     since by definition nobody in `base` is carrying it. */
  const chosen = String(filters?.[key] ?? '');
  if (chosen !== '' && !found.has(chosen)) {
    const owner = (Array.isArray(roster) ? roster : []).find((p) => facet.value(p) === chosen);
    rows.push({
      value: chosen,
      label: chosen === BLANK ? BLANK_LABEL : ((owner && facet.text(owner)) || chosen),
      count: 0,
    });
  }
  return rows;
}
