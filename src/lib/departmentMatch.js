/**
 * WHAT HR TYPED IN THE แผนก COLUMN, MATCHED TO A DEPARTMENT ROW.
 *
 * The sibling of `employeeCode.js`, and it exists for the same reason: a roster
 * file is typed by a person, and the person does not know which of a
 * department's three names the database happens to sort on. The row carries a
 * `code` (`SALESCO`), an English `name` (`Sales Coordination`) and a Thai
 * `nameTh` (`แผนกประสานงานขาย`); all three name the same แผนก and any of them
 * is a reasonable thing to write down.
 *
 * ── The import that could not read the roster ───────────────────────────────
 *
 * Until this file existed, `POST /api/employees/import` built one map, keyed on
 * `code.toUpperCase()`, and looked the cell up in it. The real roster — 163
 * people, the file this system was built to hold — writes the Thai name in that
 * column, so every row failed with `ไม่พบแผนกรหัส "แผนกผลิต1"` and the import
 * that was supposed to load the company refused all of it. The template the
 * screen offers for download demonstrated codes, so the failure looked like HR
 * having filled the file in wrong, and the file was right.
 *
 * ── Why the prefix is stripped, and why that is a SECOND pass ───────────────
 *
 * Seven rows of that same file write `ประสานงานขาย` where the database says
 * `แผนกประสานงานขาย`. `แผนก`, `ฝ่าย` and `สาขา` are the words for "department",
 * "division" and "branch" — they say what KIND of unit it is, not which one,
 * and whether somebody types them is a habit rather than a fact about the
 * roster.
 *
 * But dropping them is a guess in a way that reading `nameTh` is not, so it
 * never competes with a real name: every exact key is registered first, and a
 * stripped key that collides with one is discarded rather than allowed to
 * shadow it. A department literally named `ขาย` therefore keeps `ขาย` even
 * though `ฝ่ายขาย` would strip to the same thing.
 *
 * ── An ambiguous key is refused, never resolved ─────────────────────────────
 *
 * If two departments would answer to one key, that key answers for NEITHER —
 * `null` is stored in its place and the lookup reports `ambiguous`, so the row
 * fails with a message telling HR to write the code instead. Picking whichever
 * one the loop reached first is how a person ends up in the wrong department
 * with nothing on any screen saying a choice was made, and the OT they file
 * lands under another team's ceiling.
 */

/**
 * The words that say what KIND of unit a name describes rather than which one.
 *
 * Only these four, and only at the START. `แผนกจัดส่ง` is the shipping
 * department; `งานจัดส่งแผนกผลิต` would be something else entirely, and a
 * substring rule would happily eat the middle of it.
 */
const UNIT_WORDS = ['แผนก', 'ฝ่าย', 'สาขา', 'หน่วยงาน'];

/**
 * One spelling of a name, for comparison ONLY — nothing is ever stored in this
 * shape and no screen shows it.
 *
 * Whitespace goes entirely rather than collapsing to one space: `แผนก IT` and
 * `แผนกIT` are the same department typed by two people, and Thai does not put
 * spaces between words, so there is no pair this can merge that a reader would
 * have thought distinct. The zero-width characters are what a paste out of
 * Excel or a Word document leaves behind — invisible on screen, and enough to
 * make an exact match fail with the two strings looking identical in the error
 * message.
 */
export function normalizeDeptKey(value) {
  return String(value ?? '')
    .replace(/[\uFEFF\u200B-\u200D]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** `แผนกผลิต1` → `ผลิต1`. Already normalised input, one word, leading only. */
export function stripUnitWord(key) {
  for (const word of UNIT_WORDS) {
    if (key.startsWith(word) && key.length > word.length) return key.slice(word.length);
  }
  return key;
}

/**
 * Two maps, in the order they are consulted.
 *
 * `exact` holds every name a department actually has. `loose` holds the
 * prefix-stripped forms, and only those that do not collide with an exact key —
 * see the header. A key present in either with the value `null` is one that two
 * or more departments claimed, and it is deliberately left in the map rather
 * than removed: absent means "nobody is called this", `null` means "more than
 * one is", and those are different things to tell the person uploading.
 *
 * @param departments lean Department rows — `code`, `name`, `nameTh`
 */
export function buildDepartmentIndex(departments = []) {
  const exact = new Map();
  const loose = new Map();

  const add = (map, key, dept) => {
    if (!key) return;
    if (!map.has(key)) { map.set(key, dept); return; }
    const seen = map.get(key);
    if (seen && String(seen._id) !== String(dept._id)) map.set(key, null);
  };

  for (const dept of departments) {
    for (const spelling of [dept.code, dept.name, dept.nameTh]) {
      add(exact, normalizeDeptKey(spelling), dept);
    }
  }

  // A second pass, and it has to be one: a stripped key may only be registered
  // once EVERY department has had its real names counted, or whether it collides
  // with one would depend on the order the rows came back from the database.
  for (const dept of departments) {
    for (const spelling of [dept.code, dept.name, dept.nameTh]) {
      const key = stripUnitWord(normalizeDeptKey(spelling));
      if (key && !exact.has(key)) add(loose, key, dept);
    }
  }

  return { exact, loose };
}

/**
 * The cell, or why it matched nothing.
 *
 * Four attempts, narrowest first: the cell as written against real names, then
 * against stripped ones, then the cell itself stripped against each. That order
 * is what lets `ฝ่ายขาย` and `ขาย` both reach ฝ่ายขาย while a department really
 * called `ขาย` still wins its own name.
 *
 * @returns `{ department, reason: 'ok' }`, or `{ department: null, reason:
 *          'empty' | 'ambiguous' | 'unknown' }`
 */
export function matchDepartment(index, cell) {
  const key = normalizeDeptKey(cell);
  if (!key) return { department: null, reason: 'empty' };

  const stripped = stripUnitWord(key);
  const attempts = [
    [index.exact, key],
    [index.loose, key],
    [index.exact, stripped],
    [index.loose, stripped],
  ];

  for (const [map, attempt] of attempts) {
    if (!map.has(attempt)) continue;
    const hit = map.get(attempt);
    // Claimed by more than one department. Stop here rather than falling
    // through to a looser pass that might name one of them: a later attempt
    // resolving what an earlier one called ambiguous is the coin toss this
    // whole function exists to refuse.
    if (!hit) return { department: null, reason: 'ambiguous' };
    return { department: hit, reason: 'ok' };
  }

  return { department: null, reason: 'unknown' };
}

/**
 * What the import puts in `errors` — written here so the route does not spell
 * the same three refusals out beside the lookup that produced them.
 */
export function departmentMatchError(reason, cell) {
  if (reason === 'empty') return 'ต้องระบุแผนก';
  if (reason === 'ambiguous') {
    return `แผนก "${cell}" ตรงกับหลายแผนก — ให้ใส่รหัสแผนกแทนเพื่อระบุให้ชัด`;
  }
  return `ไม่พบแผนก "${cell}" — ใส่ได้ทั้งรหัสแผนก ชื่อไทย หรือชื่ออังกฤษ`;
}
