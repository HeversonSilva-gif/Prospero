import { describe, expect, it, beforeEach, vi } from "vitest";
import { useBudgetsStore } from "./budgets.js";

const ipcMock = {
  getBudgets: vi.fn(),
  setBudgets: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (
    globalThis as unknown as {
      window: { prospero: { costs: typeof ipcMock } };
    }
  ).window = {
    prospero: { costs: ipcMock },
  };
  useBudgetsStore.setState({
    budgets: {
      maxTokensPerDayPerAgent: 2_000_000,
      maxTokensPerIssue: 200_000,
      rateLimitWindowTokens: 1_000_000,
      rateLimitWindowHours: 5,
    },
    loaded: false,
  });
});

describe("useBudgetsStore", () => {
  it("load fetches from IPC and marks loaded", async () => {
    ipcMock.getBudgets.mockResolvedValue({
      maxTokensPerDayPerAgent: 500_000,
      maxTokensPerIssue: 100_000,
      rateLimitWindowTokens: 800_000,
      rateLimitWindowHours: 4,
    });
    await useBudgetsStore.getState().load();
    expect(useBudgetsStore.getState().loaded).toBe(true);
    expect(useBudgetsStore.getState().budgets.maxTokensPerDayPerAgent).toBe(500_000);
  });

  it("save patches via IPC and replaces local budgets", async () => {
    ipcMock.setBudgets.mockResolvedValue({
      maxTokensPerDayPerAgent: 100,
      maxTokensPerIssue: 200_000,
      rateLimitWindowTokens: 1_000_000,
      rateLimitWindowHours: 5,
    });
    await useBudgetsStore.getState().save({ maxTokensPerDayPerAgent: 100 });
    expect(ipcMock.setBudgets).toHaveBeenCalledWith({ maxTokensPerDayPerAgent: 100 });
    expect(useBudgetsStore.getState().budgets.maxTokensPerDayPerAgent).toBe(100);
  });

  it("save surfaces IPC errors as thrown", async () => {
    ipcMock.setBudgets.mockRejectedValue(new Error("[budgets] must be a positive integer"));
    await expect(useBudgetsStore.getState().save({ maxTokensPerIssue: -1 })).rejects.toThrow(
      /positive integer/i,
    );
  });
});
