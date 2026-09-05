import { describe, expect, it, vi } from "vitest";
import { RequestScheduler } from "./scheduler.js";

describe("RequestScheduler", () => {
  it("limits concurrent tasks", async () => {
    const scheduler = new RequestScheduler(2, 0);
    let active = 0;
    let maximum = 0;
    const pending: Array<() => void> = [];
    const tasks = Array.from({ length: 5 }, (_, index) =>
      scheduler.run(`https://host-${index}.example`, async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => pending.push(resolve));
        active -= 1;
      })
    );
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(maximum).toBe(2);
    pending.splice(0, 2).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending.splice(0, 2).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.splice(0).forEach((resolve) => resolve());
    await Promise.all(tasks);
    expect(maximum).toBe(2);
  });

  it("serializes and spaces tasks for the same host", async () => {
    const scheduler = new RequestScheduler(8, 20);
    const starts: number[] = [];
    const task = () =>
      scheduler.run("https://example.com/page", async () => {
        starts.push(Date.now());
      });
    await Promise.all([task(), task()]);
    expect(starts).toHaveLength(2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(20);
  });
});
