# legacy/ — the Express server this app used to be

**Nothing in this directory runs. Nothing in the app imports it. Do not add to it.**

The system is a Next.js App Router application: every endpoint lives in
[`app/api/`](../app/api/), and `npm run dev` / `npm run build` / `npm start` are
the only ways it is served. What is in here is the Express server that came
first, kept because it is readable history and deleted from nothing but the
runtime.

## Why it was moved rather than left in `src/`

It was not idle. It was a **second implementation of authentication and of
writing an OT entry**, sitting one `node src/server.js` away from being started
by somebody who thought it was the app — and it predates every rule added since:

| rule | `app/api/` | `legacy/routes/` |
|---|---|---|
| สรุปสถานะงวด (period status) | counted and shown before printing | not present |
| ผู้รับช่วงอนุมัติ (delegation) | approve / reject / withdraw | not present |
| ขอถอนใบที่อนุมัติแล้ว | built | not present |
| เวลาทับซ้อน (overlap) | refuses on submit and edit | no such check |
| roster audit trail | `otEmployeeAudits` | partial |
| สรุป OT ส่งบัญชี / แยกแผนก | reports + CSV | not present |

A request that reached the Express `POST /api/entries` would have written hours
into a closed month, with no overlap check and no policy version stamped on it,
and every screen in the app would then have shown that row as ordinary. It could
not have been reached by accident from the browser — but it could be reached by
anybody who ran the wrong npm script on the server, and that is not a margin
worth keeping.

## It is a strict subset — verified 2026-08-18

Every endpoint below was checked against `app/api/`. All 30 have an App Router
equivalent; none is unique to Express. The App Router additionally serves
delegations, the birthday queue, period close/reopen, withdrawal, the entry
trail, the roster audit and impact reads, the accounting and department reports,
and their CSV exports — about twice again as many routes.

```
auth        POST /login · POST /logout · GET /me
departments GET / · POST / · PATCH /:id
employees   GET / · POST / · PATCH /:id · POST /me/password
            GET /import/template · POST /import
entries     GET / · GET /queue-summary · GET /:id · POST /preview · POST /
            PATCH /:id · POST /:id/cancel · POST /:id/approve
            POST /:id/reject · POST /:id/cap-override · GET /usage/:period
exports     GET /entries.csv · GET /monthly.csv
holidays    GET / · POST / · DELETE /:id · GET /import/template · POST /import
reports     GET /form/:period · GET /monthly/:period
settings    GET / · POST /policy-confirmations · PATCH /policy · PATCH /
            POST /recompute
```

It could not have served the app in any case: `server.js` looks for a built
frontend in `web/dist`, and there is no `web/` directory and no `web:build`
script. The React app is in [`components/`](../components/) and is rendered by
Next.

## What still points at these files

**Nine test files read them off disk** — `test/tempPassword.test.js`,
`test/rosterRouteGuards.test.js`, `test/lockout.test.js`,
`test/personalFields.test.js`, `test/birthdayCheck.test.js`,
`test/birthdayDirectApproval.test.js`, `test/birthdayOnPaper.test.js`,
`test/holidayYear.test.js`, `test/otMode.test.js`. They assert that the Express
copy of a rule matches the App Router copy — written when both were live. They
were repointed here rather than deleted, because deleting an assertion is a
decision about coverage and moving a file is not. **When these files are
finally deleted, those assertions go with them**; the App Router half of each
test stands on its own.

`express`, `cookie-parser` and `multer` were **removed from
`package.json`** — they were used by nothing else in the repo. That is what
makes this directory inert rather than merely unused: it will not start. To
consult it as running code (there is no reason to), `npm i -D express
cookie-parser multer` first, and read `server.js`'s own banner before you do.

## Deleting it

The safe order is: delete the nine paired assertions, then `git rm -r legacy/`.
The history is in git either way — this directory is a convenience, not the
archive.
