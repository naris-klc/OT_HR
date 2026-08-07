/**
 * First-login password when none is supplied. Everyone must change it — see
 * POST /api/employees/me/password.
 */
export function defaultPassword(code) {
  return `Primus@${String(code).replace(/\W/g, '')}`;
}

/**
 * Who is allowed to be told somebody's วันเกิด.
 *
 * The employee themselves, HR and Admin — and nobody else, managers included.
 * A birthday is personal data that the OT process has no use for beyond
 * deciding one person's day type, and that decision happens on the server. A
 * manager needs their team's hours, not their dates of birth.
 *
 * Written as a rule over (viewer, row) rather than a field list per route,
 * because the roster is served by two endpoints on two servers and a projection
 * that has to be remembered four times is a projection that will be right in
 * three places.
 */
export function maySeeBirthDate(viewer, employee) {
  if (!viewer) return false;
  if (['hr', 'admin'].includes(viewer.role)) return true;
  return String(viewer._id) === String(employee?._id);
}

/**
 * An employee row as a given viewer is allowed to receive it.
 *
 * Everything except birthDate is unchanged — this is not a narrowing of what
 * the roster screens show, it is the removal of a field they never displayed
 * and were being sent anyway. `.lean()` returns the whole document, so the leak
 * was silent: nothing on any screen would have looked different.
 */
export function publicEmployee(employee, viewer) {
  if (!employee) return employee;
  const { birthDate, ...rest } = employee;
  return maySeeBirthDate(viewer, employee) && birthDate
    ? { ...rest, birthDate }
    : rest;
}
