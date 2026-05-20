import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Routine } from "@prospero/shared";
import { useRoutinesStore } from "./routines.js";

const makeRoutine = (overrides: Partial<Routine> = {}): Routine => ({
  id: "routine_1",
  companyId: "c1",
  name: "Standup",
  enabled: true,
  triggerType: "schedule",
  scheduleSpec: { freq: "daily", atMinute: 540 },
  nextFireAt: 1000,
  eventSpec: null,
  targetAgentId: "a1",
  instruction: "x",
  lastFiredAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const stubApi = (
  overrides: Partial<{
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    runNow: ReturnType<typeof vi.fn>;
  }> = {},
): void => {
  (globalThis as unknown as { window: { prospero: { routines: unknown } } }).window = {
    prospero: {
      routines: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn().mockResolvedValue({ ok: true }),
        runNow: vi.fn().mockResolvedValue({ ok: true }),
        ...overrides,
      },
    },
  };
};

beforeEach(() => {
  useRoutinesStore.setState({ routines: null, loading: false, error: null });
});

describe("useRoutinesStore", () => {
  it("load — fetches and sets routines", async () => {
    const r = makeRoutine();
    stubApi({ list: vi.fn().mockResolvedValue([r]) });
    await useRoutinesStore.getState().load("c1");
    expect(useRoutinesStore.getState().routines).toEqual([r]);
    expect(useRoutinesStore.getState().loading).toBe(false);
  });

  it("load — sets error on failure", async () => {
    stubApi({ list: vi.fn().mockRejectedValue(new Error("boom")) });
    await useRoutinesStore.getState().load("c1");
    expect(useRoutinesStore.getState().routines).toBeNull();
    expect(useRoutinesStore.getState().error).toBe("boom");
  });

  it("getById — returns routine by id from loaded list", async () => {
    const r1 = makeRoutine({ id: "routine_1" });
    const r2 = makeRoutine({ id: "routine_2" });
    stubApi({ list: vi.fn().mockResolvedValue([r1, r2]) });
    await useRoutinesStore.getState().load("c1");
    expect(useRoutinesStore.getState().getById("routine_2")).toEqual(r2);
    expect(useRoutinesStore.getState().getById("nope")).toBeNull();
  });

  it("create — appends to list", async () => {
    const created = makeRoutine({ id: "routine_new" });
    stubApi({ list: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue(created) });
    await useRoutinesStore.getState().load("c1");
    await useRoutinesStore.getState().create({ name: "X" });
    expect(useRoutinesStore.getState().routines).toEqual([created]);
  });

  it("update — replaces routine in list", async () => {
    const r = makeRoutine({ id: "routine_1", name: "Old" });
    const updated = makeRoutine({ id: "routine_1", name: "New" });
    stubApi({
      list: vi.fn().mockResolvedValue([r]),
      update: vi.fn().mockResolvedValue(updated),
    });
    await useRoutinesStore.getState().load("c1");
    await useRoutinesStore.getState().update({ id: "routine_1", name: "New" });
    expect(useRoutinesStore.getState().routines?.[0]?.name).toBe("New");
  });

  it("delete — removes routine from list", async () => {
    const r = makeRoutine({ id: "routine_1" });
    stubApi({ list: vi.fn().mockResolvedValue([r]) });
    await useRoutinesStore.getState().load("c1");
    await useRoutinesStore.getState().delete("routine_1");
    expect(useRoutinesStore.getState().routines).toEqual([]);
  });

  it("toggleEnabled — flips optimistically and calls update", async () => {
    const r = makeRoutine({ id: "routine_1", enabled: true });
    const updateFn = vi.fn().mockResolvedValue(makeRoutine({ id: "routine_1", enabled: false }));
    stubApi({ list: vi.fn().mockResolvedValue([r]), update: updateFn });
    await useRoutinesStore.getState().load("c1");
    const promise = useRoutinesStore.getState().toggleEnabled("routine_1");
    // optimistic: enabled flipped synchronously
    expect(useRoutinesStore.getState().routines?.[0]?.enabled).toBe(false);
    await promise;
    expect(updateFn).toHaveBeenCalledWith({ input: { id: "routine_1", enabled: false } });
  });

  it("toggleEnabled — reverts on IPC failure", async () => {
    const r = makeRoutine({ id: "routine_1", enabled: true });
    const updateFn = vi.fn().mockRejectedValue(new Error("denied"));
    stubApi({ list: vi.fn().mockResolvedValue([r]), update: updateFn });
    await useRoutinesStore.getState().load("c1");
    await useRoutinesStore.getState().toggleEnabled("routine_1");
    expect(useRoutinesStore.getState().routines?.[0]?.enabled).toBe(true);
    expect(useRoutinesStore.getState().error).toBe("denied");
  });

  it("runNow — calls IPC, does not mutate routines list", async () => {
    const r = makeRoutine();
    const runNowFn = vi.fn().mockResolvedValue({ ok: true });
    stubApi({ list: vi.fn().mockResolvedValue([r]), runNow: runNowFn });
    await useRoutinesStore.getState().load("c1");
    await useRoutinesStore.getState().runNow("routine_1");
    expect(runNowFn).toHaveBeenCalledWith({ id: "routine_1" });
  });
});
