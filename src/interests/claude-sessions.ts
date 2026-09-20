// The digest this module produces is sent to TypeSafe. Only the person's own
// prompts, session titles, and cwd/branch may be read from a session file;
// assistant output, tool results, attachments, and subagent transcripts must
// not be, whatever they might add to accuracy.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { InterestSource, RecentProject, RecentWork } from "../types.ts";

export type ClaudeSessionsOptions = {
  /** @default ~/.claude/projects */
  dir?: string;
  /** Window, by each record's own timestamp. @default 7 */
  days?: number;
  /** Read only this session, in full; `days` then does not apply. The id is the session file's name without `.jsonl`. */
  session?: string;
  /** Replaced in tests. @default Date.now */
  now?: () => number;
  /** Total characters of prompt excerpts; titles and headings are not counted. @default 6000 */
  budgetChars?: number;
  /**
   * Newest prompts every project keeps before the rest of `budgetChars` is
   * spent newest-first across projects. @default 3
   */
  guaranteedPrompts?: number;
  /** Longer prompts are cut with an ellipsis. @default 300 */
  maxPromptChars?: number;
  /** Shorter prompts are dropped as conversational noise. @default 40 */
  minPromptChars?: number;
  /** Used only to shorten project names. @default os.homedir() */
  home?: string;
};

/** One session file, reduced to the fields the digest is built from. */
export type Session = {
  sessionId: string;
  project: string;
  branch?: string;
  title?: string;
  lastActivity: number;
  prompts: Array<{ at: number; text: string }>;
};

// One line of a session .jsonl. Every field is optional: which ones are present
// depends on `type`, and lines of types this module does not know about are
// common.
type SessionRecord = {
  type?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  aiTitle?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: { content?: unknown };
};

/**
 * The id of the session a command is running inside: Claude Code hands it to
 * the shell as `CLAUDE_CODE_SESSION_ID`. `undefined` outside a session; an
 * empty value counts as unset.
 */
export function currentSessionId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.CLAUDE_CODE_SESSION_ID || undefined;
}

/**
 * InterestSource that turns Claude Code sessions under `dir` into
 * `RecentWork`: those active inside the window, or with `session`, that one
 * alone. Jev cannot summarize, so all compression is done here. Rejects when
 * there is no session to describe.
 */
export function createClaudeSessionsInterestSource(
  opts: ClaudeSessionsOptions = {},
): InterestSource {
  const dir = opts.dir ?? join(homedir(), ".claude", "projects");
  const days = opts.days ?? 7;
  const now = opts.now ?? Date.now;
  const home = opts.home ?? homedir();
  const shape: SelectOptions = {
    budgetChars: opts.budgetChars ?? 6000,
    guaranteedPrompts: opts.guaranteedPrompts ?? 3,
    maxPromptChars: opts.maxPromptChars ?? 300,
    minPromptChars: opts.minPromptChars ?? 40,
  };

  if (opts.session !== undefined) {
    const id = opts.session;
    return {
      name: `claude-sessions:${id}`,
      async load(): Promise<RecentWork> {
        if (id !== basename(id)) throw new Error(`"${id}" is not a session id`);
        const path = await findSessionFile(dir, id);
        if (!path) throw new Error(`no Claude Code session ${id} under ${dir}`);
        const session = await readSession(path, 0, home);
        if (!session)
          throw new Error(`Claude Code session ${id} has no dated records`);
        return select([session], shape);
      },
    };
  }
  return {
    name: `claude-sessions:${days}d`,
    async load(): Promise<RecentWork> {
      const since = now() - days * 86_400_000;
      const sessions = await collectSessions(dir, since, home);
      if (sessions.length === 0) {
        throw new Error(
          `no Claude Code sessions in the last ${days} days under ${dir}`,
        );
      }
      return { days, ...select(sessions, shape) };
    },
  };
}

async function listProjectDirs(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// Session files are named by their id, so each project dir is probed for the
// one file instead of listed.
async function findSessionFile(
  dir: string,
  id: string,
): Promise<string | null> {
  for (const p of await listProjectDirs(dir)) {
    const path = join(dir, p, `${id}.jsonl`);
    try {
      await stat(path);
      return path;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err; // ENOTDIR: a file, not a dir
    }
  }
  return null;
}

async function collectSessions(
  dir: string,
  since: number,
  home: string,
): Promise<Session[]> {
  const sessions: Session[] = [];
  for (const p of await listProjectDirs(dir)) {
    const projectDir = join(dir, p);
    let files: string[];
    try {
      files = (await readdir(projectDir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue; // a file, not a dir
    }
    // Sessions live directly under the project dir. Deeper .jsonl files are
    // subagent transcripts (Claude talking to Claude) — deliberately skipped.
    for (const f of files) {
      const path = join(projectDir, f);
      // mtime is a cheap pre-filter; per-record timestamps decide.
      if ((await stat(path)).mtimeMs < since) continue;
      const session = await readSession(path, since, home);
      if (session) sessions.push(session);
    }
  }
  return sessions;
}

async function readSession(
  path: string,
  since: number,
  home: string,
): Promise<Session | null> {
  const text = await readFile(path, "utf8");
  let title: string | undefined;
  let cwd: string | undefined;
  let branch: string | undefined;
  let lastActivity = 0;
  const prompts: Session["prompts"] = [];

  for (const line of text.split("\n")) {
    if (!line) continue;
    let rec: SessionRecord;
    try {
      rec = JSON.parse(line) as SessionRecord;
    } catch {
      continue;
    }
    if (rec.type === "ai-title") {
      const t = rec.aiTitle?.trim();
      if (t) title = t;
      continue;
    }
    const at = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    if (Number.isNaN(at) || at < since) continue;
    if (rec.cwd) cwd = rec.cwd;
    if (rec.gitBranch) branch = rec.gitBranch;
    lastActivity = Math.max(lastActivity, at);

    if (rec.type !== "user") continue;
    if (rec.isMeta || rec.isSidechain) continue;
    const content = rec.message?.content;
    // Tool results arrive as arrays; the person's own words are a string.
    if (typeof content !== "string") continue;
    prompts.push({ at, text: content });
  }

  if (lastActivity === 0) return null; // nothing inside the window
  const session: Session = {
    sessionId: basename(path, ".jsonl"),
    project: projectName(cwd, home),
    lastActivity,
    prompts,
  };
  if (title) session.title = title;
  if (branch) session.branch = branch;
  return session;
}

/**
 * Display name for a session's cwd: the last two path segments (the `org/repo`
 * convention), with worktrees folded into their repo.
 * `/Users/me/dev/org/repo/.claude/worktrees/feature-x` → `org/repo`.
 * Paths directly under `home` keep only their own name, never the user name.
 */
export function projectName(
  cwd: string | undefined,
  home: string = homedir(),
): string {
  if (!cwd) return "(unknown project)";
  const root = cwd.replace(/\/\.claude\/worktrees\/[^/]+$/, "");
  const rel = root.startsWith(`${home}/`) ? root.slice(home.length + 1) : root;
  const segments = rel.split("/").filter(Boolean);
  return segments.slice(-2).join("/") || root;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, // OpenAI/Stripe-style
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\b[A-Za-z0-9_-]{40,}\b/g, // any long opaque token
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g, // email addresses (TLD must be letters: "pkg@0.1.0" is not one)
];

/**
 * Masks credential-shaped strings with `[redacted]`. Pattern-based and
 * deliberately over-eager (any 40+ char opaque token is hit); it is a
 * backstop, not a guarantee.
 */
export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}

/** The digest-shaping options, with defaults already applied. */
export type SelectOptions = Required<
  Pick<
    ClaudeSessionsOptions,
    "budgetChars" | "guaranteedPrompts" | "maxPromptChars" | "minPromptChars"
  >
>;

// Claude Code stores some of its own plumbing as `user` records with string
// content, indistinguishable from typed prompts except by these markers.
const PLUMBING = [
  /^<(?:bash-input|bash-stdout|bash-stderr|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|task-notification|ci-monitor-event|ide_[a-z_]+)\b/i,
  /<command-name>|<local-command-stdout>|<system-reminder>/i,
];

/** True for Claude Code's own records (command echoes, terminal captures, reminders). */
export function isPlumbing(text: string): boolean {
  return PLUMBING.some((re) => re.test(text));
}

// Claude Code also attaches context to the person's own message inside the
// same string: a worktree notice before the first prompt of a session, or the
// file open in the IDE. Those blocks are closed tags, unlike the records above.
const ATTACHED = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g,
];

/** The person's words with Claude Code's attached context blocks removed. */
export function stripAttached(text: string): string {
  let out = text;
  for (const re of ATTACHED) out = out.replace(re, "");
  return out;
}

type Candidate = { at: number; session: Session; text: string };

/**
 * Pure. Chooses what `RecentWork` carries. Guaranteed excerpts come first:
 * for each project, the opening prompt of each of its sessions and its
 * `guaranteedPrompts` newest excerpts, taken one per project in turn so a
 * tight budget still leaves every project its first pick. The rest of
 * `budgetChars` goes to the newest excerpts across all projects. Both passes
 * stop at the first excerpt that does not fit; a shorter, older one is not
 * picked in its place. Without the guarantees one busy day pushes every other
 * project out, and a long session pushes out the prompt that says what it is
 * for. A session's "opening" prompt is the oldest excerpt it was given that
 * survived the filters above, which for a session begun before a `days`
 * window is not its first message.
 */
export function select(sessions: Session[], o: SelectOptions): RecentWork {
  const raw: Candidate[] = sessions.flatMap((s) =>
    s.prompts.map((p) => ({
      at: p.at,
      session: s,
      text: normalize(stripAttached(p.text)),
    })),
  );
  raw.sort((a, b) => b.at - a.at);

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const c of raw) {
    if (
      c.text.length < o.minPromptChars ||
      c.text.startsWith("/") ||
      isPlumbing(c.text)
    )
      continue;
    // Prefix match, not equality: the same request retyped with a different
    // tail ("...please", "...again") should still count once.
    const key = c.text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ ...c, text: truncate(redact(c.text), o.maxPromptChars) });
  }

  const sessionsOf = new Map<string, Session[]>();
  for (const s of [...sessions].sort(
    (a, b) => b.lastActivity - a.lastActivity,
  )) {
    sessionsOf.set(s.project, [...(sessionsOf.get(s.project) ?? []), s]);
  }
  const candidatesOf = new Map<string, Candidate[]>();
  for (const c of candidates) {
    candidatesOf.set(c.session.project, [
      ...(candidatesOf.get(c.session.project) ?? []),
      c,
    ]);
  }

  const opening = new Map<Session, Candidate>();
  for (const c of [...candidates].reverse())
    if (!opening.has(c.session)) opening.set(c.session, c);

  const guaranteedOf = new Map<string, Candidate[]>();
  for (const [project, list] of candidatesOf) {
    const openings = (sessionsOf.get(project) ?? [])
      .map((s) => opening.get(s))
      .filter((c): c is Candidate => c !== undefined);
    guaranteedOf.set(project, [
      ...new Set([...openings, ...list.slice(0, o.guaranteedPrompts)]),
    ]);
  }
  const guaranteed: Candidate[] = [];
  const lists = [...guaranteedOf.values()];
  for (let turn = 0; lists.some((list) => turn < list.length); turn++) {
    for (const list of lists) {
      const c = list[turn];
      if (c) guaranteed.push(c);
    }
  }
  const taken = new Set(guaranteed);
  const order = guaranteed.concat(candidates.filter((c) => !taken.has(c)));

  const kept = new Set<Candidate>();
  let used = 0;
  for (const c of order) {
    if (used + c.text.length > o.budgetChars) break;
    used += c.text.length;
    kept.add(c);
  }

  const projects: RecentProject[] = [];
  for (const [name, list] of sessionsOf) {
    projects.push({
      name,
      branches: [
        ...new Set(
          list.map((s) => s.branch).filter((b): b is string => Boolean(b)),
        ),
      ],
      sessions: list.length,
      titles: [
        ...new Set(
          list.map((s) => s.title).filter((t): t is string => Boolean(t)),
        ),
      ].map(redact),
      prompts: (candidatesOf.get(name) ?? [])
        .filter((c) => kept.has(c))
        .map((c) => c.text),
    });
  }
  return { projects };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
