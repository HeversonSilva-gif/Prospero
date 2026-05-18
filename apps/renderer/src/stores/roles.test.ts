import { describe, expect, it, beforeEach, vi } from "vitest";
import { useRolesStore } from "./roles.js";

const ipcMock = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  clone: vi.fn(),
  getCharter: vi.fn(),
  saveCharter: vi.fn(),
};

const roleSummary = (id: string, name: string) => ({
  id,
  name,
  description: "d",
  defaultSystemPrompt: "p",
  defaultCapabilities: ["chat"],
  defaultModel: "claude-sonnet-4-6",
  icon: null,
  isSeedExample: false,
  createdAt: 1,
  updatedAt: 1,
  agentCount: 0,
});

const roleDetail = (id: string, name: string) => ({
  ...roleSummary(id, name),
  resolvedTools: [],
  agentsUsing: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: { prospero: { roles: typeof ipcMock } } }).window = {
    prospero: { roles: ipcMock },
  };
  useRolesStore.setState({
    roles: [],
    selectedId: null,
    selectedDetail: null,
    selectedCharter: null,
    loaded: false,
  });
});

describe("useRolesStore", () => {
  it("load fetches roles and selects the first", async () => {
    ipcMock.list.mockResolvedValue([roleSummary("r1", "One")]);
    ipcMock.get.mockResolvedValue(roleDetail("r1", "One"));
    ipcMock.getCharter.mockResolvedValue({ body: "# c" });
    await useRolesStore.getState().load();
    expect(useRolesStore.getState().loaded).toBe(true);
    expect(useRolesStore.getState().selectedId).toBe("r1");
    expect(useRolesStore.getState().selectedCharter).toBe("# c");
  });

  it("create adds a role and selects it", async () => {
    ipcMock.list.mockResolvedValue([roleSummary("r1", "One")]);
    ipcMock.create.mockResolvedValue(roleSummary("r2", "Two"));
    ipcMock.get.mockResolvedValue(roleDetail("r2", "Two"));
    ipcMock.getCharter.mockResolvedValue({ body: "# skeleton" });
    const created = await useRolesStore.getState().create({
      name: "Two",
      description: "d",
      icon: null,
      defaultModel: "claude-sonnet-4-6",
      defaultCapabilities: ["chat"],
    });
    expect(created.id).toBe("r2");
    expect(ipcMock.create).toHaveBeenCalledOnce();
    expect(useRolesStore.getState().selectedId).toBe("r2");
  });

  it("remove deletes a role and reloads the list", async () => {
    ipcMock.delete.mockResolvedValue({ ok: true });
    ipcMock.list.mockResolvedValue([]);
    await useRolesStore.getState().remove("r1");
    expect(ipcMock.delete).toHaveBeenCalledWith("r1");
    expect(ipcMock.list).toHaveBeenCalled();
  });

  it("remove surfaces an in-use error as thrown", async () => {
    ipcMock.delete.mockRejectedValue(new Error("role in use by 2 agent(s)"));
    await expect(useRolesStore.getState().remove("r1")).rejects.toThrow(/in use/i);
  });

  it("saveCharter persists and updates selectedCharter", async () => {
    useRolesStore.setState({ selectedId: "r1" });
    ipcMock.saveCharter.mockResolvedValue({ ok: true });
    await useRolesStore.getState().saveCharter("r1", "# edited");
    expect(ipcMock.saveCharter).toHaveBeenCalledWith("r1", "# edited");
    expect(useRolesStore.getState().selectedCharter).toBe("# edited");
  });
});
