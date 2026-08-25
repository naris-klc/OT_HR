<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# เอกสารกับโค้ดต้องเดินไปด้วยกัน — Documentation is part of the change

The project rules below are ours. The block above is Next.js's own and is
rewritten by `next dev`; nothing here depends on it.

## A commit that changes behaviour must find the paragraphs that describe it

**Before committing, search the documents for what you just changed, and fix
what you find in the SAME commit.** The documents are `README.md`, everything in
`docs/`, and this file.

```bash
# the name of the thing you changed, whatever shape it takes in prose
grep -rn "recompute\|ปิดงวด\|closedPeriods" README.md docs/ AGENTS.md
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
  is what would have caught `skippedClosed` being named as the field that
  carries the months when it carries the count, had the wrong name not also been
  a real one;
- points at a **file** that is not there.

It cannot check whether a paragraph is TRUE, and it does not pretend to. That is
what the rule above is for.
