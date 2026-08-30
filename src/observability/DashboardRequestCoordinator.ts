export type DashboardRequestToken = {
  requestId: number;
  resourceKey: string;
  signal: AbortSignal;
};

/** Coordinates one dashboard panel's requests without owning source clients. */
export class DashboardRequestCoordinator {
  private generation = 0;
  private controller: AbortController | undefined;
  private currentToken: DashboardRequestToken | undefined;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  begin(resourceKey: string): DashboardRequestToken {
    if (this.disposed) {
      throw new Error("Dashboard request coordinator is disposed.");
    }
    this.controller?.abort();
    this.controller = new AbortController();
    this.currentToken = {
      requestId: ++this.generation,
      resourceKey,
      signal: this.controller.signal,
    };
    return this.currentToken;
  }

  isCurrent(token: Pick<DashboardRequestToken, "requestId" | "resourceKey">): boolean {
    return (
      !this.disposed &&
      this.currentToken?.requestId === token.requestId &&
      this.currentToken.resourceKey === token.resourceKey
    );
  }

  getCurrent(): DashboardRequestToken | undefined {
    return this.currentToken;
  }

  registerTimer(timer: ReturnType<typeof setTimeout>): void {
    if (this.disposed) {
      clearTimeout(timer);
      return;
    }
    this.timers.add(timer);
  }

  clearTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  cancelCurrent(): DashboardRequestToken | undefined {
    const cancelled = this.currentToken;
    this.controller?.abort();
    this.controller = undefined;
    this.currentToken = undefined;
    this.generation++;
    return cancelled;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelCurrent();
    this.clearTimers();
  }
}
