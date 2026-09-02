import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { withDestinationLock } from "./atomic.js";

describe("withDestinationLock", () => {
  it("serializes operations for the same destination", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mdhq-lock-"));
    const file = path.join(directory, "example.md");
    let releaseFirst: (() => void) | undefined;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted: (() => void) | undefined;
    const firstDidStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const order: string[] = [];
    const first = withDestinationLock(file, async () => {
      order.push("first-start");
      firstStarted?.();
      await firstMayFinish;
      order.push("first-end");
    });
    await firstDidStart;

    let secondStarted: (() => void) | undefined;
    const secondDidStart = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    const second = withDestinationLock(file, async () => {
      order.push("second-start");
      secondStarted?.();
      order.push("second-end");
    });
    expect(
      await Promise.race([
        secondDidStart.then(() => true),
        delay(25).then(() => false)
      ])
    ).toBe(false);

    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual([
      "first-start",
      "first-end",
      "second-start",
      "second-end"
    ]);
    await expect(access(`${file}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("waits for a healthy writer beyond the previous short retry window", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mdhq-lock-"));
    const file = path.join(directory, "example.md");
    let releaseFirst: (() => void) | undefined;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted: (() => void) | undefined;
    const firstDidStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const first = withDestinationLock(file, async () => {
      firstStarted?.();
      await firstMayFinish;
    });
    await firstDidStart;

    const second = withDestinationLock(file, async () => "second");
    await delay(2_000);
    releaseFirst?.();
    await expect(second).resolves.toBe("second");
    await first;
  });
});
