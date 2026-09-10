/** Date helpers shared by the /api/holidays routes. */

import { smartDate } from './smartDate.js';

/**
 * Accepts YYYY-MM-DD, DD/MM/YYYY and D/M/YYYY, either separator, either era.
 * `null` for anything else — the import route turns that into a per-row error
 * naming the cell, and that contract is unchanged.
 *
 * THE READING NOW COMES FROM `lib/smartDate.js`, and two holes closed with the
 * move on 2026-09-02. This function used to hand back any `\d{4}-\d{2}-\d{2}`
 * untouched, which meant that of the four ways one date can be written, the
 * TWO ISO ones skipped the era rule entirely: `19/09/2515` imported as 1972 and
 * `2515-09-19` imported as the year 2515, so `Holiday.year` filed it under a
 * century nothing in the app can display. The same passthrough skipped the
 * calendar, so `2026-02-30` was stored as a holiday on a day that does not
 * exist. Both are now read the way every other date in this app is read.
 */
export function normaliseDate(raw) {
  return smartDate(raw).date;
}
