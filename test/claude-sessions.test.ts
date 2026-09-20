import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createClaudeSessionsInterestSource,
  currentSessionId,
  isPlumbing,
  projectName,
  redact,
  type Session,
  select,
} from "../src/interests/claude-sessions.ts";
import type { RecentWork } from "../src/types.ts";

const NOW = Date.parse("2026-09-19T12:00:00Z");
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

type Line = Record<string, unknown>;

const user = (text: string, daysAgo: number, extra: Line = {}): Line => ({
  type: "user",
  timestamp: iso(daysAgo),
  cwd: "/Users/me/dev/org/repo",
  gitBranch: "main",
  sessionId: "s",
  message: { content: text },
  ...extra,
});

const toolResult = (daysAgo: number): Line => ({
  type: "user",
  timestamp: iso(daysAgo),
  cwd: "/Users/me/dev/org/repo",
  message: { content: [{ type: "tool_result", content: "SECRET OUTPUT" }] },
});

const assistant = (text: string, daysAgo: number): Line => ({
  type: "assistant",
  timestamp: iso(daysAgo),
  cwd: "/Users/me/dev/org/repo",
  message: { content: [{ type: "text", text }] },
});

const title = (t: string): Line => ({
  type: "ai-title",
  aiTitle: t,
  sessionId: "s",
});

describe("createClaudeSessionsInterestSource", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "raincheck-sessions-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const session = async (project: string, name: string, lines: Line[]) => {
    await mkdir(join(dir, project), { recursive: true });
    await writeFile(
      join(dir, project, `${name}.jsonl`),
      `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
    );
  };

  const load = (
    opts: Parameters<typeof createClaudeSessionsInterestSource>[0] = {},
  ) =>
    createClaudeSessionsInterestSource({
      dir,
      now: () => NOW,
      days: 7,
      home: "/Users/me",
      ...opts,
    }).load();

  const LONG =
    "Migrate the list screen to LazyColumn and fix recomposition of the row bookmarks";

  // Everything that leaves the machine, as one string, for "must not contain" checks.
  const text = (work: RecentWork) => JSON.stringify(work);

  it("carries project, branch, title, and long prompts; skips assistant text and tool results", async () => {
    await session("p", "a", [
      title("Compose list performance"),
      user(LONG, 1),
      toolResult(1),
      assistant(
        "I changed the stability annotations in a way you should not see here",
        1,
      ),
    ]);
    const out = await load();
    expect(out.days).toBe(7);
    expect(out.projects).toEqual([
      {
        name: "org/repo",
        branches: ["main"],
        sessions: 1,
        titles: ["Compose list performance"],
        prompts: [LONG],
      },
    ]);
    expect(text(out)).not.toContain("SECRET OUTPUT");
    expect(text(out)).not.toContain("stability annotations");
  });

  it("ignores records outside the window even in recently modified files", async () => {
    await session("p", "a", [
      title("old"),
      user(`${LONG} (old)`, 10),
      user(`${LONG} (new)`, 2),
    ]);
    const out = await load();
    expect(text(out)).toContain("(new)");
    expect(text(out)).not.toContain("(old)");
  });

  it("drops sessions with nothing inside the window and fails when none remain", async () => {
    await session("p", "a", [title("old"), user(LONG, 30)]);
    await expect(load()).rejects.toThrow(
      "no Claude Code sessions in the last 7 days",
    );
  });

  it("skips subagent transcripts nested under a session", async () => {
    await session("p", "a", [user(LONG, 1)]);
    await session("p/a/subagents", "agent-1", [
      user(`AGENT PROMPT: ${LONG}`, 1),
    ]);
    const out = await load();
    expect(text(out)).not.toContain("AGENT PROMPT");
  });

  it("drops short prompts, slash commands, meta and sidechain entries", async () => {
    await session("p", "a", [
      user(LONG, 1),
      user("OK", 1),
      user("ありがと", 1),
      user(`/commit ${LONG}`, 1),
      user(`META ${LONG}`, 1, { isMeta: true }),
      user(`SIDE ${LONG}`, 1, { isSidechain: true }),
    ]);
    const out = await load();
    expect(out.projects[0]!.prompts).toEqual([LONG]);
  });

  it("keeps the words after an attached reminder or IDE block, drops a bare one", async () => {
    await session("p", "a", [
      user(
        `<system-reminder>\nYou are operating in a git worktree.\nWorktree path: /x\n</system-reminder>\n\nFIRST ${LONG}`,
        1,
      ),
      user(`<ide_opened_file>src/a.ts</ide_opened_file>SECOND ${LONG}`, 2),
      user(
        "<system-reminder>\nThis conversation is now continuing in the Claude desktop app\n</system-reminder>",
        3,
      ),
    ]);
    const out = await load();
    expect(out.projects[0]!.prompts).toEqual([
      `FIRST ${LONG}`,
      `SECOND ${LONG}`,
    ]);
  });

  it("deduplicates repeated prompts and orders newest first", async () => {
    await session("p", "a", [
      user(`FIRST ${LONG}`, 3),
      user(`SECOND ${LONG}`, 1),
      user(`FIRST ${LONG}`, 2),
    ]);
    const out = await load();
    expect(out.projects[0]!.prompts).toEqual([
      `SECOND ${LONG}`,
      `FIRST ${LONG}`,
    ]);
  });

  it("truncates long prompts; a tight budget keeps the opening prompt and the newest", async () => {
    const big = (tag: string) => `${tag} ${"lorem ipsum ".repeat(50)}`;
    await session("p", "a", [
      user(big("OLDEST"), 3),
      user(big("MIDDLE"), 2),
      user(big("NEWEST"), 1),
    ]);
    const out = await load({ maxPromptChars: 100, budgetChars: 220 });
    const prompts = out.projects[0]!.prompts;
    expect(prompts.map((p) => p.slice(0, 6))).toEqual(["NEWEST", "OLDEST"]);
    expect(prompts[0]).toHaveLength(100);
    expect(prompts[0]!.endsWith("…")).toBe(true);
  });

  it("keeps the newest prompts of every project even when one busy project would fill the budget", async () => {
    const busy = Array.from({ length: 20 }, (_, i) =>
      user(`BUSY ${i} ${LONG}`, 1, { cwd: "/Users/me/dev/org/busy" }),
    );
    await session("p1", "a", busy);
    await session("p2", "b", [
      user(`QUIET 0 ${LONG}`, 4, { cwd: "/Users/me/dev/org/quiet" }),
      user(`QUIET 1 ${LONG}`, 5, { cwd: "/Users/me/dev/org/quiet" }),
    ]);
    const out = await load({
      budgetChars: 600,
      maxPromptChars: 100,
      guaranteedPrompts: 2,
    });
    expect(out.projects.map((p) => p.name)).toEqual(["org/busy", "org/quiet"]);
    expect(out.projects[1]!.prompts.map((p) => p.slice(0, 7))).toEqual([
      "QUIET 0",
      "QUIET 1",
    ]);
    expect(out.projects[0]!.prompts.length).toBeGreaterThan(2);
  });

  it("groups sessions by project with worktrees folded into their repo", async () => {
    await session("p1", "a", [
      user(`${LONG} one`, 1, {
        cwd: "/Users/me/dev/org/repo/.claude/worktrees/feat-x",
        gitBranch: "feat-x",
      }),
    ]);
    await session("p2", "b", [
      user(`${LONG} two`, 2, {
        cwd: "/Users/me/dev/org/repo",
        gitBranch: "main",
      }),
    ]);
    await session("p3", "c", [
      user(`${LONG} three`, 3, {
        cwd: "/Users/me/dev/other",
        gitBranch: "main",
      }),
    ]);
    const out = await load();
    expect(out.projects.map((p) => [p.name, p.branches, p.sessions])).toEqual([
      ["org/repo", ["feat-x", "main"], 2],
      ["dev/other", ["main"], 1],
    ]);
  });

  it("redacts obvious secrets in prompts and titles", async () => {
    await session("p", "a", [
      title("Rotate token ghp_abcdefghijklmnopqrstuvwxyz0123"),
      user(
        `Use Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig and mail me@example.com ${LONG}`,
        1,
      ),
    ]);
    const out = await load();
    expect(text(out)).not.toContain("ghp_");
    expect(text(out)).not.toContain("eyJhbGci");
    expect(text(out)).not.toContain("me@example.com");
    expect(text(out)).toContain("[redacted]");
  });

  it("returns [] cleanly when the projects dir does not exist", async () => {
    await expect(load({ dir: join(dir, "nope") })).rejects.toThrow(
      "no Claude Code sessions",
    );
  });

  describe("with session", () => {
    it("reads that session whole, whichever project it is under, and no other", async () => {
      await session("p", "a", [user(`OTHER ${LONG}`, 1)]);
      await session("q", "b", [
        title("This one"),
        user(`OLD ${LONG}`, 30),
        user(`NEW ${LONG}`, 1),
      ]);
      await writeFile(join(dir, "stray"), ""); // a file among the project dirs
      const out = await load({ session: "b" });
      expect(out.days).toBeUndefined();
      expect(out.projects).toEqual([
        {
          name: "org/repo",
          branches: ["main"],
          sessions: 1,
          titles: ["This one"],
          prompts: [`NEW ${LONG}`, `OLD ${LONG}`],
        },
      ]);
    });

    it("fails when no project has that session", async () => {
      await session("p", "a", [user(LONG, 1)]);
      await expect(load({ session: "b" })).rejects.toThrow(
        "no Claude Code session b",
      );
      await expect(
        load({ session: "b", dir: join(dir, "nope") }),
      ).rejects.toThrow("no Claude Code session b");
    });

    it("tells an empty session file apart from a missing one", async () => {
      await session("p", "a", []);
      await expect(load({ session: "a" })).rejects.toThrow(
        "session a has no dated records",
      );
    });

    it("rejects an id that would name a file outside the projects dir", async () => {
      await session("p", "a", [user(LONG, 1)]);
      await expect(load({ session: "../p/a" })).rejects.toThrow(
        "not a session id",
      );
    });
  });
});

describe("currentSessionId", () => {
  it("reads CLAUDE_CODE_SESSION_ID; empty counts as unset", () => {
    expect(currentSessionId({ CLAUDE_CODE_SESSION_ID: "abc" })).toBe("abc");
    expect(currentSessionId({ CLAUDE_CODE_SESSION_ID: "" })).toBeUndefined();
    expect(currentSessionId({})).toBeUndefined();
  });
});

describe("select", () => {
  const prompt = (text: string, daysAgo: number) => ({
    at: NOW - daysAgo * DAY,
    text,
  });
  const session = (
    project: string,
    lastActivityDaysAgo: number,
    prompts: Session["prompts"],
  ): Session => ({
    sessionId: project,
    project,
    lastActivity: NOW - lastActivityDaysAgo * DAY,
    prompts,
  });
  // 50 chars each so budgets below count in whole prompts; words, not a run of
  // one letter, or `redact` would treat the padding as a token.
  const P = (tag: string) =>
    `${tag} lorem ipsum dolor sit amet consectetur adipiscing elit`.slice(
      0,
      50,
    );
  const opts = {
    budgetChars: 500,
    guaranteedPrompts: 3,
    maxPromptChars: 300,
    minPromptChars: 40,
  };

  it("gives every session its opening prompt and every project its newest prompts, then spends the rest newest-first", () => {
    const busy = session(
      "busy",
      1,
      Array.from({ length: 20 }, (_, i) => prompt(P(`busy${i}`), 1 + i / 100)),
    );
    const quiet = session("quiet", 3, [
      prompt(P("quiet0"), 3),
      prompt(P("quiet1"), 4),
      prompt(P("quiet2"), 5),
      prompt(P("quiet3"), 6),
    ]);
    const older = session("older", 6, [prompt(P("older0"), 6)]);
    const d = select([older, quiet, busy], opts);

    expect(d.projects.map((p) => p.name)).toEqual(["busy", "quiet", "older"]);
    // 500 chars = 10 prompts. Guaranteed: busy0-2 + busy19 (opening), quiet0-2 + quiet3 (opening),
    // older0. One left for recency: busy3.
    expect(d.projects[0]!.prompts.map((t) => t.slice(0, 6))).toEqual([
      "busy0 ",
      "busy1 ",
      "busy2 ",
      "busy3 ",
      "busy19",
    ]);
    expect(d.projects[1]!.prompts.map((t) => t.slice(0, 6))).toEqual([
      "quiet0",
      "quiet1",
      "quiet2",
      "quiet3",
    ]);
    expect(d.projects[2]!.prompts).toHaveLength(1);
  });

  it("keeps only opening prompts beyond pure recency when the per-project guarantee is zero", () => {
    const busy = session(
      "busy",
      1,
      Array.from({ length: 20 }, (_, i) => prompt(P(`busy${i}`), 1 + i / 100)),
    );
    const quiet = session("quiet", 3, [
      prompt(P("quiet0"), 3),
      prompt(P("quiet1"), 4),
    ]);
    const d = select([quiet, busy], { ...opts, guaranteedPrompts: 0 });
    // busy19 and quiet1 open their sessions; the other 8 slots go newest-first, all to busy.
    expect(d.projects[0]!.prompts).toHaveLength(9);
    expect(d.projects[0]!.prompts.at(-1)).toContain("busy19");
    expect(d.projects[1]!.prompts.map((t) => t.slice(0, 6))).toEqual([
      "quiet1",
    ]);
  });

  it("shares a budget too small for every guarantee one excerpt per project at a time", () => {
    const many = (name: string, days: number) =>
      session(
        name,
        days,
        Array.from({ length: 6 }, (_, i) =>
          prompt(P(`${name}${i}`), days + i / 100),
        ),
      );
    const d = select([many("c", 5), many("b", 3), many("a", 1)], {
      ...opts,
      budgetChars: 300,
    });
    // Each project asks for 4 (opening + newest 3); 300 chars = 6 prompts, so two rounds of three.
    expect(d.projects.map((p) => [p.name, p.prompts.length])).toEqual([
      ["a", 2],
      ["b", 2],
      ["c", 2],
    ]);
    expect(d.projects[2]!.prompts.map((t) => t.slice(0, 2))).toEqual([
      "c0",
      "c5",
    ]);
  });

  it("carries branches, session counts and redacted titles", () => {
    const a = {
      ...session("repo", 1, [prompt(P("a"), 1)]),
      branch: "main",
      title: "Rotate ghp_abcdefghijklmnopqrstuvwxyz0123",
    };
    const b = { ...session("repo", 2, []), branch: "feat", title: "Other" };
    const [p] = select([a, b], opts).projects;
    expect(p).toMatchObject({
      name: "repo",
      branches: ["main", "feat"],
      sessions: 2,
    });
    expect(p!.titles).toEqual(["Rotate [redacted]", "Other"]);
  });
});

describe("projectName", () => {
  const home = homedir();
  it("keeps the last two segments and folds worktrees into their repo", () => {
    expect(projectName(`${home}/dev/org/repo`)).toBe("org/repo");
    expect(
      projectName(`${home}/dev/org/repo/.claude/worktrees/feat-1234`),
    ).toBe("org/repo");
    expect(projectName(`${home}/src/deep/org/repo`)).toBe("org/repo");
    expect(projectName(`${home}/other/place`)).toBe("other/place");
  });

  it("never leaks the user name for paths directly under home", () => {
    expect(projectName(`${home}/solo`)).toBe("solo");
  });

  it("handles paths outside home and missing cwd", () => {
    expect(projectName("/srv/app")).toBe("srv/app");
    expect(projectName("/app")).toBe("app");
    expect(projectName(undefined)).toBe("(unknown project)");
  });
});

describe("redact", () => {
  it("masks common token shapes and emails, leaves prose alone", () => {
    expect(redact("sk-abcdefghijklmnopqrstuvwxyz")).toBe("[redacted]");
    expect(redact("AKIAIOSFODNN7EXAMPLE")).toBe("[redacted]");
    expect(redact("xoxb-1234567890-abcdef")).toBe("[redacted]");
    expect(redact("a".repeat(40))).toBe("[redacted]");
    expect(redact("Fix the LazyColumn recomposition bug")).toBe(
      "Fix the LazyColumn recomposition bug",
    );
  });
});

describe("isPlumbing", () => {
  it("recognises Claude Code plumbing stored as user messages", () => {
    for (const t of [
      "<bash-input>cp a b</bash-input><bash-stdout>ok</bash-stdout>",
      "<command-name>/login</command-name> <command-message>login</command-message>",
      "<local-command-stdout>Goodbye!</local-command-stdout>",
      "<system-reminder> This conversation is now continuing in the Claude desktop app",
      "<ide_opened_file>foo.ts</ide_opened_file>",
    ]) {
      expect(isPlumbing(t), t).toBe(true);
    }
  });

  it("leaves real prompts alone, including ones mentioning tags or files", () => {
    for (const t of [
      "Explain how <div> nesting affects layout in this component",
      '@"/Users/me/spec.md" read this and build it',
      "> quoted output from a tool, then my question about it",
    ]) {
      expect(isPlumbing(t), t).toBe(false);
    }
  });
});

describe("redact email rule", () => {
  it("does not treat package@version as an email", () => {
    expect(redact("> raincheck@0.1.0 check:live")).toBe(
      "> raincheck@0.1.0 check:live",
    );
    expect(redact("mail me at someone@example.co.jp please")).toBe(
      "mail me at [redacted] please",
    );
  });
});
