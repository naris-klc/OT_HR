/**
 * First-login password when none is supplied. Everyone must change it — see
 * POST /api/employees/me/password.
 */
export function defaultPassword(code) {
  return `Primus@${String(code).replace(/\W/g, '')}`;
}
