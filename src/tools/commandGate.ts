// This agent's own real shell capability, needed to actually run the
// Playwright test appq:fix's Phase 5 requires for verification — same
// mechanism appliqation-scriptgen already established for the same reason.
//
// Hardcoded, non-negotiable invariant (same class of thing as
// destructiveActionGate.ts / the appq tool allowlists elsewhere in this
// family): an explicit allowlist of (command, argv-shape), checked BEFORE
// execution, never widened by prompt text. The actual execution path
// (codingTools.ts) uses child_process.execFile with an argv array — never a
// shell string — so even an allowed command can't smuggle a second command
// via `;`/`&&`/backticks; the OS never parses the arguments as shell syntax
// in the first place. The allowlist is defense in depth on top of that, not
// the only layer.
//
// Extends scriptgen's own allowlist in one place: appq:fix's Phase 5
// verification invocation is `npx playwright test -- --appq-run-id={run_id}
// --grep "{name}"` verbatim — the literal `--` separator and an
// `--appq-run-id=<id>` flag need to be recognized, and --grep must be
// optional so a broader (whole-file/whole-suite) run is possible when a
// caller's --test-instruction calls for one.

const PACKAGE_SPEC_RE = /^@?[a-z0-9][a-z0-9._/-]*(@[\w.\-^~]+)?$/i;
const APPQ_RUN_ID_FLAG_RE = /^--appq-run-id=[\w-]+$/;

function isPlainPackageSpec(spec: string): boolean {
  return PACKAGE_SPEC_RE.test(spec) && !spec.includes('..') && !spec.startsWith('-');
}

/** A path-shaped argument (a test file glob/relative path) — no traversal, no shell metacharacters. */
function isSafePathArg(arg: string): boolean {
  return !arg.includes('..') && !/[;&|`$(){}<>]/.test(arg) && !arg.startsWith('-');
}

type Validator = (args: string[]) => boolean;

const ALLOWED_COMMANDS: Record<string, Validator> = {
  npm: (args) => {
    if (args.length === 2 && args[0] === 'init' && args[1] === '-y') return true;
    // npm install -D <package...> [--ignore-scripts] — dev deps only, plain package
    // specs only. --ignore-scripts is the one bare flag allowed here: codingTools.ts
    // appends it to every install automatically (it's what stops a malicious/
    // typosquatted package's own preinstall/postinstall scripts from running), so
    // this just means the gate doesn't reject its own safety flag coming back
    // through on the args a model might echo.
    if (args.length >= 3 && args[0] === 'install' && args[1] === '-D') {
      return args.slice(2).every((a) => a === '--ignore-scripts' || isPlainPackageSpec(a));
    }
    return false;
  },
  npx: (args) => {
    if (args[0] !== 'playwright') return false;
    if (args[1] === '--version' && args.length === 2) return true;
    if (args[1] === 'install') {
      // optional browser names (chromium/firefox/webkit) or --with-deps
      return args.slice(2).every((a) => /^(chromium|firefox|webkit|--with-deps)$/.test(a));
    }
    if (args[1] === 'test') {
      // optional `--` separator, an --appq-run-id=<id> flag, a --grep
      // "<title>" pair, and/or a relative spec file path — any combination,
      // any order (mirrors appq:fix's exact Phase 5 invocation shape).
      return args.slice(2).every((a) => a === '--' || a === '--grep' || APPQ_RUN_ID_FLAG_RE.test(a) || isSafePathArg(a));
    }
    return false;
  },
  node: (args) => args.length === 1 && args[0] === '--version',
  git: (args) => {
    if (args.length === 1 && args[0] === 'status') return true;
    if (args.length === 1 && args[0] === 'diff') return true;
    if (args.length === 2 && args[0] === 'diff' && args[1] === '--stat') return true;
    return false;
  },
};

export function assertCommandAllowed(command: string, args: string[]): void {
  const validator = ALLOWED_COMMANDS[command];
  if (!validator || !validator(args)) {
    throw new Error(
      `Command "${command} ${args.join(' ')}" is not in the allowlist. This is a hardcoded ` +
        `boundary — no workflow prompt can widen it. Allowed: npm init -y, npm install -D <pkgs>, ` +
        `npx playwright install/--version/test (with an optional -- separator, --appq-run-id=<id>, ` +
        `--grep, and/or a spec path), node --version, git status/diff.`,
    );
  }
}
