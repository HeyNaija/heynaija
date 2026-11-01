// How pnpm e2e passes the files you name to Playwright. Playwright reads each name
// as a regular expression over a spec file's whole path, so a name also matched the
// folders above tests/: in a worktree at .claude/worktrees/gists, `pnpm e2e gists`
// ran all 37 files. Here a bare name only ever matches within a spec file's own name.

/** Options whose value is the next argument, so that value is not taken for a file. */
export const TAKES_VALUE = new Set([
  '-c', '--config', '-j', '--workers', '--project', '--reporter', '--output', '--retries', '--repeat-each',
  '--timeout', '--global-timeout', '--max-failures', '--shard', '--trace', '--tsconfig', '-g', '--grep',
  '--grep-invert', '--ui-host', '--ui-port',
])

/** Whether args[i] names test files, rather than being an option or an option's value. */
export const isFileArg = (args: readonly string[], i: number) => !args[i]!.startsWith('-') && !TAKES_VALUE.has(args[i - 1] ?? '')

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * One name as Playwright should get it. A path (with a slash, or ending in .ts,
 * either with :line) and a /regex/ pass through. A bare name, with or without
 * :line, becomes a pattern for spec files whose own name contains it: `posting`
 * is posting.spec.ts, `reply` also polls-reply-controls.spec.ts, and neither ever
 * matches a folder.
 */
export function fileFilter(name: string): string {
  if (/[\\/]/.test(name) || /\.ts(:\d+){0,2}$/.test(name)) return name
  const [, base, location = ''] = /^(.*?)((?::\d+){1,2})?$/.exec(name)!
  const stem = escape(base!.replace(/\.spec$/, ''))
  return `[^\\\\/]*${stem}[^\\\\/]*\\.spec\\.ts$${location}`
}

/** The arguments with every file name rewritten by fileFilter, options untouched. */
export const withFileFilters = (args: readonly string[]) => args.map((arg, i) => (isFileArg(args, i) ? fileFilter(arg) : arg))
