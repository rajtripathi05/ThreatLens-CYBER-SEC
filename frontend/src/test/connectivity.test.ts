import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectivityManager } from "@/lib/connectivity";

const okRes = () => new Response('{"status":"ok"}', { status: 200 });
const make = (f: typeof fetch, timeout = 3000) => new ConnectivityManager("http://api.test", () => f, timeout);

afterEach(() => vi.useRealTimers());

describe("ConnectivityManager", () => {
  it("starts CHECKING and becomes CONNECTED on a 2xx health answer", async () => {
    const m = make(vi.fn().mockResolvedValue(okRes()));
    expect(m.getSnapshot().state).toBe("CHECKING");
    expect((await m.check()).state).toBe("CONNECTED");
  });

  it("becomes UNAVAILABLE when the host cannot be reached", async () => {
    const m = make(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const s = await m.check();
    expect(s.state).toBe("UNAVAILABLE");
    expect(s.error).toMatch(/Cannot reach the backend/);
  });

  it("becomes UNAVAILABLE on timeout, using a 3 s default", async () => {
    vi.useFakeTimers();
    const f = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const m = make(f as unknown as typeof fetch);
    const p = m.check();
    await vi.advanceTimersByTimeAsync(2999);
    expect(m.getSnapshot().state).toBe("CHECKING");
    await vi.advanceTimersByTimeAsync(2);
    expect((await p).state).toBe("UNAVAILABLE");
    expect(m.getSnapshot().error).toMatch(/did not answer within 3 s/);
  });

  it("shares one request between overlapping checks", async () => {
    const f = vi.fn().mockResolvedValue(okRes());
    const m = make(f);
    await Promise.all([m.check(), m.check(), m.check()]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("recovers on retry after the backend returns, and notifies subscribers", async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError("down")).mockResolvedValue(okRes());
    const m = make(f);
    const seen: string[] = [];
    m.subscribe(() => seen.push(m.getSnapshot().state));
    expect((await m.check()).state).toBe("UNAVAILABLE");
    expect((await m.check()).state).toBe("CONNECTED");
    expect(seen).toContain("UNAVAILABLE");
    expect(seen.at(-1)).toBe("CONNECTED");
  });

  it("does not poll on its own", async () => {
    vi.useFakeTimers();
    const f = vi.fn().mockResolvedValue(okRes());
    const m = make(f);
    await m.check();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a failure reported mid-request wins over a stale in-flight health result", async () => {
    let release!: (r: Response) => void;
    const f = vi.fn(() => new Promise<Response>((r) => { release = r; }));
    const m = make(f as unknown as typeof fetch);
    const p = m.check();
    m.reportNetworkFailure("lost during analysis");
    release(okRes());
    await p;
    expect(m.getSnapshot()).toMatchObject({ state: "UNAVAILABLE", error: "lost during analysis" });
  });

  it("treats a non-2xx health answer as unavailable with a distinct message", async () => {
    const m = make(vi.fn().mockResolvedValue(new Response("x", { status: 503 })));
    expect((await m.check()).error).toMatch(/HTTP 503/);
  });
});
