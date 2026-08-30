import { describe, expect, it, vi } from "vitest";
import { DashboardRequestCoordinator } from "../../src/observability/DashboardRequestCoordinator";

describe("DashboardRequestCoordinator", () => {
  it("aborts the previous request and rejects late responses across resources", () => {
    const coordinator = new DashboardRequestCoordinator();
    const first = coordinator.begin("queue-a");
    const second = coordinator.begin("queue-b");

    expect(first.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);
    expect(second.requestId).toBeGreaterThan(first.requestId);
  });

  it("invalidates a cancelled request and disposes timers idempotently", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const coordinator = new DashboardRequestCoordinator();
    const token = coordinator.begin("queue");
    coordinator.registerTimer(setTimeout(callback, 100));

    expect(coordinator.cancelCurrent()).toEqual(token);
    expect(token.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(token)).toBe(false);
    coordinator.dispose();
    coordinator.dispose();
    vi.advanceTimersByTime(200);

    expect(callback).not.toHaveBeenCalled();
    expect(() => coordinator.begin("another")).toThrow("disposed");
    vi.useRealTimers();
  });

  it("stops pending refresh timers while remaining reusable", () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const coordinator = new DashboardRequestCoordinator();

    coordinator.registerTimer(setTimeout(first, 60_000));
    coordinator.clearTimers();
    vi.advanceTimersByTime(60_000);
    expect(first).not.toHaveBeenCalled();

    coordinator.registerTimer(setTimeout(second, 60_000));
    vi.advanceTimersByTime(60_000);
    expect(second).toHaveBeenCalledOnce();
    coordinator.dispose();
    vi.useRealTimers();
  });
});
