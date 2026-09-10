<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# เอกสารกับโค้ดต้องเดินไปด้วยกัน — Documentation is part of the change

The project rules below are ours. The block above is Next.js's own and is
rewritten by `next dev`; nothing here depends on it.

## คุยกับผู้ใช้เป็นภาษาไทยเสมอ — Thai is the language of this project

**ตอบผู้ใช้เป็นภาษาไทยทุกครั้ง** สั่งไว้ 2026-09-11 · ข้อความคอมมิต เอกสารใน
`docs/` และทุกคำที่ขึ้นบนจอก็เป็นภาษาไทยอยู่แล้ว — ตามให้เหมือนกัน

ที่ยังเป็นอังกฤษได้คือของที่เป็นอังกฤษอยู่แล้วในไฟล์นั้น: ชื่อตัวแปร ชื่อเทสต์
บางไฟล์ และร้อยแก้วในเอกสารฉบับนี้ · การเขียนภาษาอังกฤษปนในย่อหน้าไทยเพราะมันสั้น
กว่านั้นไม่ใช่เหตุผล

## ทรีนี้ไม่ใช่ของคุณคนเดียว — Another agent is editing these files while you read this

**Assume at every moment that another session has uncommitted work in this
working tree.** Two or more agents run against this repository on branch `dev`
at the same time, in separate processes that cannot see each other's turns.
While this very section was being written on 2026-09-11, another session
committed `d368f67` onto `dev` underneath it — nothing announced it, and the
only reason it was noticed at all was a `git worktree list` printing a HEAD that
had moved.

**Take a baseline on your first turn**, before you touch anything:

```bash
git status --short
```

Everything in that list is somebody else's work. It is the only thing that will
still tell you, an hour and forty edits later, which of the dirty files are
yours.

### Rules that hold in every tree

- **`git add <path>`, one path at a time, only files you edited yourself.**
  Never `git add -A`, never `git add .`. On 2026-08-26 a `git add -A` put 1185
  files of somebody's scratch build dir into a commit about CSS.
- **Never `git stash`** — not even to get a clean tree for one test run. On
  2026-09-10 a `git stash push -u` took 55 files of another session's work off
  the tree; that session then wrote its files again from its own context, and
  `git stash pop` failed on the conflict. Nothing was lost, by luck and not by
  method.
- **Never `git checkout --`, `git restore`, `git reset --hard`, or a shell
  redirect onto a file you did not write in this session.** The tree is not
  yours to make clean.
- **Commit the moment your own task is done — one commit per task, carrying
  your files and nobody else's.** Work you leave sitting in the tree stops being
  attributable within minutes: the next session cannot tell your half-finished
  change from its own, and the documentation rule below is written per commit
  for exactly this reason.
- A dirty tree is the normal state here, and tidying it is not a favour.

### For work bigger than a couple of files: take a worktree of your own

`git worktree` gives you a checkout that no other session can write into, on a
branch that no other session commits to. The recipe below was walked end to end
on this laptop on 2026-09-11:

```bash
git worktree add ../OT_HR-<task> -b dev-<task> dev
cd ../OT_HR-<task>
cp ../OT_HR/.env .
```

Copying `.env` is not optional and not a mistake: it is git-ignored, so a new
worktree has none, and the app, the tests that reach a database, and every
`src/` script read it. `node_modules` is not checked out either, and `npm ci`
for it is minutes of disk. A directory junction costs nothing and needs no
administrator:

```powershell
New-Item -ItemType Junction -Path node_modules -Target ..\OT_HR\node_modules
```

Commit onto `dev-<task>` as often as you like. When the task is done, merge in
the tree that has `dev` checked out — git will not let you move `dev` from
anywhere else:

```bash
cd ../OT_HR && git merge --no-ff dev-<task>
```

**That merge lands in somebody else's dirty tree.** Both halves of what it does
were walked on 2026-09-11:

- Files nobody has open merge normally, uncommitted work elsewhere in the tree
  and all.
- A file that someone has uncommitted changes in stops the whole merge —
  `error: Your local changes to the following files would be overwritten by
  merge` — and nothing is written. **That refusal is correct and it is not
  yours to override.** Not with stash, not with checkout, not with a reset.
  Leave your branch where it is, say which file collided, and let the user
  decide.

**Take the junction out before you remove the worktree**, and take it out with
a tool that unlinks rather than recurses — `Remove-Item -Recurse` on a junction
can walk into the real `node_modules` and empty it:

```powershell
cmd /c rmdir "C:\Users\bcozf\Downloads\primus-ot\OT_HR-<task>\node_modules"
```

```bash
git worktree remove ../OT_HR-<task> && git branch -d dev-<task>
```

Skip the unlink and `git worktree remove` fails on the junction with `Invalid
argument`, having already deleted half the directory and its own bookkeeping —
after which the path is neither a worktree nor gone, and `git worktree prune`
plus a manual delete is what clears it.

If your harness has a worktree command of its own (Claude Code has one), it
still leaves you both steps above to do by hand, and it branches from
`origin/main` unless it is told otherwise — which is the wrong base here. Its
worktrees land in `.claude/worktrees/`, git-ignored since 2026-09-11 so that a
worktree full of files does not surface in everybody else's `git status`.

### What a worktree does not isolate

- **The database.** Every tree reads the same `.env`, which points at the one
  `mongod` HR is using. `npm run seed`, `npm run backup`, `npm run restore` and
  every `migrate:` script reach across every worktree there is. File isolation
  is all you bought.
- **The ports.** The verify recipe below uses `-p 3001`; two sessions verifying
  at once collide on it. Pick a port nobody is holding, and name the build
  directory after your task — `VERIFY_DIST_DIR=.next-verify-<task>`, which
  `.next-*/` already ignores.
- **:3000 and the deploy.** Both belong to the main tree, and the deploy is the
  user's call — see the section below before you go near either.

## What serves this app, and why you cannot check a change by looking at :3000

**The production server is `next start` on 127.0.0.1:3000, serving `.next`.**
This sentence, and everything under it in this section, is about the **Windows
laptop** — the machine docs/network.md gives an address for.

> **It read "There is no other machine — 'prod' is this laptop" until
> 2026-09-09.** On that day a second installation went up: a Linux box running
> the app as a Docker container against its own `mongod`, with a Cloudflare
> tunnel giving it a public URL. It is documented in
> [docs/docker.md](docs/docker.md), which is the file that describes THAT
> machine. **Work out which box you are on before you use anything below.**
> On the container box a build is not a deploy — it happens inside an image
> while the running container keeps serving — so the `VERIFY_DIST_DIR` rule
> below is the laptop's rule, not a universal one.

On the laptop a build is a deploy and the two are the same act.

Three facts about this box that decide how a change gets verified, all
established on 2026-08-27:

- **Nothing restarts the app.** The `OT server` scheduled task in README §Setup
  has never been registered here; `Get-ScheduledTask` has been read three times
  and the only OT job is `OT backup`. The app does not come back after a reboot
  and nothing revives it when it dies. `C:\Users\suwan\deploy-ot.ps1` is what a
  deploy is, and a person runs it.
- **`next dev` has held :3000 before.** For a morning on 2026-08-27 the port was
  served by `next dev -p 3000`, compiling the working tree — so uncommitted
  edits were live to HR while `.next\BUILD_ID` was two days stale. If you are
  ever surprised that an edit is or is not on :3000, check which mode is running
  before concluding anything about the code. The pid on the port cannot tell you
  (both modes run the same `start-server.js` worker); its **parent** can.
- **`npm run build` takes the live app down.** `next start` holds the `BUILD_ID`
  it booted with, so rebuilding underneath it makes every loaded page request
  chunks that no longer exist — 500 until a restart. Never run a bare
  `npm run build` to check that something compiles.

**So: verify on a scratch `distDir`, never on `.next`.** `next.config.js`
commits `distDir: process.env.VERIFY_DIST_DIR || '.next'` for exactly this:

```bash
VERIFY_DIST_DIR=.next-verify npm run build
VERIFY_DIST_DIR=.next-verify npx next start -p 3001   # :3000 keeps serving
rm -rf .next-verify
```

`.next-*/` is git-ignored. Deploying is the user's call, not a step you take on
the way to finishing something.

## จอใหม่ไม่ได้เริ่มจากศูนย์ — Ask first, agree first, then inherit

**The user decides the UX, and they decide it before the first line of JSX
exists.** Said in as many words on 2026-09-11. A screen is not a place to try
something and see; it is the one part of this system HR looks at every day, and
it already has a settled look that a guess quietly forks.

### Before you write UI code

1. **Ask, and keep asking until the design has no gaps left in it.** Not one
   round of questions out of politeness — as many as it takes. Name what you do
   not know: which state the screen is in when it is empty, what the thing is
   called in Thai, what happens at 390px, what prints, which of two flows the
   button belongs to. A question costs a message. A screen built on a guess is
   thrown away twice — once by the user, and once by the tests that pinned the
   behaviour it guessed at.
2. **Get an explicit yes, then build.** Describe what you are about to build in
   words — the layout, the states, what each control does — and wait for the
   answer. "I'll build it and you can tell me what to change" is not agreement,
   and neither is a draft in code offered as a question.
3. **Never take silence, a shrug, or a related answer as approval** for a
   decision the user has not actually made.

### Inherit before you invent

This app has ONE theme and it is enforced by tests, not by taste. A new screen
is assembled from what the old screens are made of, and only what genuinely has
no precedent is designed at all.

- **`components/common.jsx`** is the shared kit and nearly every screen imports
  from it (`from './common.jsx'`): `Modal`, `ConfirmDialog`, `Section`, `Fact`,
  `Field`, `Empty`, `Alert`, `StatusChip`, `ShowMore`. A screen that hand-rolls
  its own dialog, its own empty state or its own status pill is exactly the
  failure this rule is here to stop — the second one of those is the moment the
  app has two styles.
- **`components/popover.jsx`** — `Popover`, `PickerBox`, `usePicker`,
  `useSheet`: every dropdown and the draggable bottom sheet.
  `test/noNativeSelect.test.js` fails a build that reaches for the browser's
  own `<select>` instead.
- **`components/icons.jsx`** — `Icon` and `ICON_NAMES`, one inline SVG set.
  There is no second icon set and no icon font.
- **`components/nav.jsx`** — `useBackHandler`, the app's own back stack, which
  is what makes the phone's back gesture close a sheet instead of leaving the
  page.
- **`app/styles.css`** — every colour is a token on `:root`, both themes come
  from `light-dark()` and `data-theme`. **No rule in that stylesheet writes a
  raw colour of its own**, and `test/theme.test.js` fails the build if one
  appears; it also measures real colour pairs for AA contrast in both themes.

**When there is genuinely no precedent, the new thing goes in the shared kit,
not in the screen that needed it first.** Add it to `components/common.jsx`
beside the others and let the second screen import it. Copying a block from
another component is where two versions that slowly disagree come from — and
the copy is never the one that gets fixed.

**Reuse is a design constraint, not a refactor to do later.** If a screen cannot
be built from the kit without a fight, that is a design question to take back to
the user — not a licence to build a parallel one.

### Before you call a screen done

Both themes · 390px wide · Ctrl+P · the safe area at the bottom edge · and the
main breakpoint is 860px, below which the app is meant to read as a phone app
(bottom bar, FAB, tables that become cards, 44px targets), not as a shrunken
desktop.

**`docs/design.md` is where the rules themselves live, and it is the first thing
to read before designing anything**: which token means what and when each is
used, the breakpoints that already exist, what the phone layout owes the reader,
and the checklist above in full. `docs/plan-design-system.md` is the reasoning
that asked for that file, plus the inventory behind it and the one rule it argues
is genuinely missing — how many words a screen may carry.

**Neither is an invitation to build a design system. The one they describe is
already built**, and rebuilding it is the specific mistake they exist to prevent.

## A commit that changes behaviour must find the paragraphs that describe it

**Before committing, search the documents for what you just changed, and fix
what you find in the SAME commit.** The documents are `README.md`, everything in
`docs/`, and this file.

```bash
# the name of the thing you changed, whatever shape it takes in prose
grep -rn "recompute\|periodStatus\|เพดาน" README.md docs/ AGENTS.md
```

Search for the BEHAVIOUR, not only the identifier. A paragraph can describe a
rule perfectly without naming a single function in it — which is exactly how the
one below survived.

**This is not a style rule; it is the repair for a specific failure.** On
2026-08-14 at 08:13, `019cd2c` wrote into README §Status that a policy replay
could still restate a closed month, left open on purpose because HR had not been
asked. At 08:38 the same morning, `2c1f3ae` closed that hole — and edited
`README.md` in the same commit, for a different paragraph. The false one stood
for eleven days, was read, and was believed: it went into a work plan as an item
to build, and the first thing that contradicted it was somebody walking the
route against a database on 2026-08-25.

The cost of the miss is not a wrong sentence. It is that the wrong sentence
**asks for the work to be done again** — and the second implementation of a rule
that already exists is where two rules that disagree come from.

### What "found and fixed" is allowed to look like

- **Rewrite it** when the behaviour is simply different now.
- **Keep the history and mark it** when the old state is worth remembering. The
  Status section does this everywhere — `It read "410 tests, under 400 ms" until
  2026-08-25`. A superseded figure goes in quotation marks; a live one does not,
  and `test/docsMatchCode.test.js` relies on that convention.
- **Delete it** when it described something that no longer exists at all.

What is not allowed is leaving it, on the grounds that the code is the truth.
Nobody reads eight thousand lines of source to find out whether a month can be
restated; they read the paragraph that says so.

## What the machine already checks, so you do not have to

`test/docsMatchCode.test.js` fails the build when a document:

- states a **count** that disagrees with the tree — route files, endpoints,
  components, `lib/*.js`, test files;
- puts an **identifier** in backticks that exists nowhere in the source — this
  is what would have caught the README naming one replay field as the one
  carrying the months when it carried the count, had the wrong name not also
  been a real one. (Both fields were withdrawn on 2026-08-31 with ปิดงวด; see
  `lib/periodStatus.js`. The failure they illustrate is the point, not them.)
- points at a **file** that is not there.

It cannot check whether a paragraph is TRUE, and it does not pretend to. That is
what the rule above is for.
