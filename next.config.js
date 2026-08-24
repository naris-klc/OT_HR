/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Where the build lands — `.next` unless something says otherwise.
   *
   * THE LINE THAT MAKES A BUILD SAFE TO RUN ON THIS MACHINE. There is no
   * staging: "production" is this laptop serving :3000 out of `.next`, and
   * `next start` holds the BUILD_ID it booted with — so a plain `npm run build`
   * is a deploy, and a deploy in the middle of the working day makes every
   * loaded page ask for chunks that no longer exist.
   *
   * With this, a build can be pointed at a scratch directory and started on
   * another port while :3000 keeps serving, which is the only way to satisfy
   * both halves of the problem: the built app is the thing that has to be
   * tested (`next dev` hides a whole class of ESM bug that `next build`
   * exposes — see test/delegationQueryBinding.test.js and the 500 that found
   * it), and the built app is also production.
   *
   *   VERIFY_DIST_DIR=.next-verify npm run build
   *   VERIFY_DIST_DIR=.next-verify npx next start -p 3001
   *
   * Unset in every ordinary run, so nothing about a real build or a real start
   * changes.
   */
  distDir: process.env.VERIFY_DIST_DIR || '.next',

  // Mongoose must stay a real Node module — bundling it breaks model registration.
  serverExternalPackages: ['mongoose', 'bcryptjs'],

  // Dev-only. Testers hit the dev server over the office LAN, so their Origin is
  // the machine's DHCP address — without this Next 403s every /_next/* chunk.
  // Subnet wildcards keep working when DHCP hands out a different last octet.
  allowedDevOrigins: ['192.168.109.*', '172.16.4.*'],

  /**
   * The round "N" badge Next.js floats over the page in development. It defaults
   * to `bottom-left`, which on a phone is exactly where รอ HR ยืนยัน — the first
   * tab of the bottom nav, and the one every reviewer starts from — sits.
   *
   * It is Next's own overlay, in its own shadow root above the whole document,
   * so no z-index of ours reaches it, and `next start` never draws it at all. It
   * has never been on anybody's phone but ours. What it does obstruct is the
   * mobile layout being checked ON the dev server, which is the only way anyone
   * checks it.
   *
   * Off rather than hidden by keystroke: the devtools carry their own hide
   * shortcut (Win/Cmd + Shift + N), and it was set here once. A shortcut is no
   * answer for this app — nobody is told it exists, and the screen the badge
   * covers is the phone layout, where there is no keyboard to press it on. The
   * stored shortcut has been cleared; this line is what keeps the badge away.
   *
   * Off rather than moved: on this layout all four corners are a control at
   * phone width — the two nav tabs at the ends of the bar, the Pm mark, and the
   * avatar. Compile and runtime errors still surface with this false; the badge
   * is the only thing it takes. To have it back somewhere, swap the line for
   * `devIndicators: { position: 'top-right' }`.
   */
  devIndicators: false,
};

export default nextConfig;
