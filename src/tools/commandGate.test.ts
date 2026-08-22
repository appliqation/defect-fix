import { describe, it, expect } from 'vitest';
import { assertCommandAllowed } from './commandGate.js';

function allowed(command: string, args: string[]): boolean {
  try {
    assertCommandAllowed(command, args);
    return true;
  } catch {
    return false;
  }
}

describe('assertCommandAllowed — npm', () => {
  it('allows npm init -y', () => {
    expect(allowed('npm', ['init', '-y'])).toBe(true);
  });

  it('allows npm install -D with plain package specs', () => {
    expect(allowed('npm', ['install', '-D', '@playwright/test'])).toBe(true);
  });

  it('allows --ignore-scripts alongside package specs — codingTools.ts appends it automatically', () => {
    expect(allowed('npm', ['install', '-D', '@playwright/test', '--ignore-scripts'])).toBe(true);
  });

  it('rejects npm install without -D (would install as a real dependency, not dev)', () => {
    expect(allowed('npm', ['install', '@playwright/test'])).toBe(false);
  });

  it('rejects npm run (arbitrary package.json scripts)', () => {
    expect(allowed('npm', ['run', 'anything'])).toBe(false);
  });
});

describe('assertCommandAllowed — npx playwright test (appq:fix Phase 5 shape)', () => {
  it('allows the bare form (no grep, whole-suite run)', () => {
    expect(allowed('npx', ['playwright', 'test'])).toBe(true);
  });

  it('allows --grep with a title', () => {
    expect(allowed('npx', ['playwright', 'test', '--grep', 'Phone Number field renders correctly'])).toBe(true);
  });

  it('allows a relative spec file path', () => {
    expect(allowed('npx', ['playwright', 'test', 'tests/appliqation/scenario-1/uuid.spec.ts'])).toBe(true);
  });

  it('allows the exact appq:fix Phase 5 invocation: -- --appq-run-id=<id> --grep "<name>"', () => {
    expect(allowed('npx', ['playwright', 'test', '--', '--appq-run-id=run_051b0c81e974', '--grep', 'Phone Number field'])).toBe(true);
  });

  it('allows --appq-run-id=<id> without --grep (broader run, per a --test-instruction)', () => {
    expect(allowed('npx', ['playwright', 'test', '--', '--appq-run-id=run_abc123'])).toBe(true);
  });

  it('rejects a malformed --appq-run-id value (not a plain word/dash token)', () => {
    expect(allowed('npx', ['playwright', 'test', '--', '--appq-run-id=; rm -rf /'])).toBe(false);
  });

  it('rejects a path escaping the repo (..)', () => {
    expect(allowed('npx', ['playwright', 'test', '../../etc/passwd'])).toBe(false);
  });

  it('rejects shell metacharacters in an argument', () => {
    expect(allowed('npx', ['playwright', 'test', '$(whoami)'])).toBe(false);
    expect(allowed('npx', ['playwright', 'test', 'a; rm -rf /'])).toBe(false);
  });

  it('rejects any non-playwright npx package (arbitrary code execution via npx)', () => {
    expect(allowed('npx', ['some-random-package'])).toBe(false);
  });
});

describe('assertCommandAllowed — npx playwright install/--version', () => {
  it('allows --version and install with optional browser names', () => {
    expect(allowed('npx', ['playwright', '--version'])).toBe(true);
    expect(allowed('npx', ['playwright', 'install', 'chromium', '--with-deps'])).toBe(true);
  });
});

describe('assertCommandAllowed — node/git', () => {
  it('allows node --version only', () => {
    expect(allowed('node', ['--version'])).toBe(true);
    expect(allowed('node', ['-e', 'require("child_process").exec("rm -rf /")'])).toBe(false);
  });

  it('allows git status and git diff (read-only inspection) only', () => {
    expect(allowed('git', ['status'])).toBe(true);
    expect(allowed('git', ['diff'])).toBe(true);
  });

  it('rejects git commit/push/add/checkout — no git write operations at all', () => {
    expect(allowed('git', ['commit', '-m', 'x'])).toBe(false);
    expect(allowed('git', ['push'])).toBe(false);
  });
});

describe('assertCommandAllowed — commands outside the allowlist entirely', () => {
  it('rejects an arbitrary binary outright', () => {
    expect(allowed('bash', ['-c', 'rm -rf /'])).toBe(false);
    expect(allowed('rm', ['-rf', '/'])).toBe(false);
  });

  it('throw message names the boundary as hardcoded, not prompt-adjustable', () => {
    expect(() => assertCommandAllowed('rm', ['-rf', '/'])).toThrow(/hardcoded/);
  });
});
