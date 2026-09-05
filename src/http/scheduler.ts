export class RequestScheduler {
  private active = 0;
  private readonly pending: Array<{
    host: string;
    run: () => void;
  }> = [];
  private readonly activeHosts = new Set<string>();
  private readonly lastStarted = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly maxConcurrent = 8,
    private readonly hostIntervalMs = 1_000
  ) {}

  async run<T>(url: string | URL, task: () => Promise<T>): Promise<T> {
    const host = new URL(url).hostname.toLowerCase();
    await new Promise<void>((resolve) => {
      this.pending.push({ host, run: resolve });
      this.pump();
    });
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.activeHosts.delete(host);
      this.pump();
    }
  }

  private pump(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.active >= this.maxConcurrent) {
      return;
    }
    const now = Date.now();
    let waitMs: number | undefined;
    const index = this.pending.findIndex(({ host }) => {
      if (this.activeHosts.has(host)) {
        return false;
      }
      const remaining = (this.lastStarted.get(host) ?? 0) + this.hostIntervalMs - now;
      if (remaining > 0) {
        waitMs = waitMs === undefined ? remaining : Math.min(waitMs, remaining);
        return false;
      }
      return true;
    });
    if (index < 0) {
      if (waitMs !== undefined) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.pump();
        }, waitMs);
      }
      return;
    }
    const item = this.pending.splice(index, 1)[0];
    if (!item) {
      return;
    }
    const { host, run } = item;
    this.active += 1;
    this.activeHosts.add(host);
    this.lastStarted.set(host, Date.now());
    run();
    this.pump();
  }
}
