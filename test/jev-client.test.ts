import { describe, expect, it } from "vitest";
import { createJevClient, JevHttpError } from "../src/jev/client.ts";
import { QUESTIONS } from "../src/questions.ts";
import fixture from "./fixtures/jev-response.json" with { type: "json" };

const noBackoff = async () => {};

describe("createJevClient", () => {
  it("posts model, state and questions with the bearer key", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetch = async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify(fixture), { status: 200 });
    };
    const jev = createJevClient({ apiKey: "k", model: "jev-latest", fetch });
    const res = await jev.ask(
      { interests: "x", article: { title: "t" } },
      QUESTIONS,
    );

    expect(res).toEqual(fixture);
    expect(seen!.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(seen!.init.method).toBe("POST");
    expect(seen!.init.headers).toEqual({
      Authorization: "Bearer k",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(seen!.init.body as string)).toEqual({
      model: "jev-latest",
      state: { interests: "x", article: { title: "t" } },
      questions: QUESTIONS,
    });
  });

  it("retries 429 and 529 with backoff, then succeeds", async () => {
    const statuses = [429, 529];
    const attempts: number[] = [];
    const fetch = async () => {
      const s = statuses.shift();
      return s
        ? new Response("slow down", { status: s })
        : new Response(JSON.stringify(fixture));
    };
    const jev = createJevClient({
      apiKey: "k",
      model: "m",
      fetch,
      backoff: async (n) => {
        attempts.push(n);
      },
    });
    await expect(jev.ask({}, QUESTIONS)).resolves.toEqual(fixture);
    expect(attempts).toEqual([0, 1]);
  });

  it("gives up after maxRetries", async () => {
    let calls = 0;
    const fetch = async () => {
      calls++;
      return new Response("busy", { status: 529 });
    };
    const jev = createJevClient({
      apiKey: "k",
      model: "m",
      fetch,
      maxRetries: 2,
      backoff: noBackoff,
    });
    await expect(jev.ask({}, QUESTIONS)).rejects.toThrow(JevHttpError);
    expect(calls).toBe(3);
  });

  it("does not retry 401 or 422 and surfaces the body", async () => {
    let calls = 0;
    const fetch = async () => {
      calls++;
      return new Response('{"detail":"questions.depth.criteria: too short"}', {
        status: 422,
      });
    };
    const jev = createJevClient({
      apiKey: "k",
      model: "m",
      fetch,
      backoff: noBackoff,
    });
    await expect(jev.ask({}, QUESTIONS)).rejects.toThrow(
      '422: {"detail":"questions.depth.criteria: too short"}',
    );
    expect(calls).toBe(1);
  });
});
