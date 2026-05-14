import { describe, expect, it, beforeEach, vi } from "vitest";
import { useCompaniesStore } from "./companies.js";

const ipcMock = {
  companies: {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  settings: {
    get: vi.fn(),
    update: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: { dashboardAgent: typeof ipcMock } }).window = {
    dashboardAgent: ipcMock,
  };
  useCompaniesStore.setState({ companies: [], activeId: null, loaded: false });
});

const co = (id: string, name: string) => ({ id, name, createdAt: 0 });

describe("useCompaniesStore", () => {
  it("load fetches companies and seeds activeId from settings", async () => {
    ipcMock.companies.list.mockResolvedValue([co("co_1", "A"), co("co_2", "B")]);
    ipcMock.settings.get.mockResolvedValue({ activeCompanyId: "co_2" });
    await useCompaniesStore.getState().load();
    expect(useCompaniesStore.getState().companies).toHaveLength(2);
    expect(useCompaniesStore.getState().activeId).toBe("co_2");
    expect(useCompaniesStore.getState().loaded).toBe(true);
  });

  it("load falls back to first company when settings has no activeCompanyId", async () => {
    ipcMock.companies.list.mockResolvedValue([co("co_1", "A"), co("co_2", "B")]);
    ipcMock.settings.get.mockResolvedValue({ activeCompanyId: null });
    await useCompaniesStore.getState().load();
    expect(useCompaniesStore.getState().activeId).toBe("co_1");
  });

  it("load with stale persisted id falls back to first company", async () => {
    ipcMock.companies.list.mockResolvedValue([co("co_1", "A")]);
    ipcMock.settings.get.mockResolvedValue({ activeCompanyId: "co_deleted" });
    await useCompaniesStore.getState().load();
    expect(useCompaniesStore.getState().activeId).toBe("co_1");
  });

  it("load with zero companies leaves activeId null", async () => {
    ipcMock.companies.list.mockResolvedValue([]);
    ipcMock.settings.get.mockResolvedValue({ activeCompanyId: null });
    await useCompaniesStore.getState().load();
    expect(useCompaniesStore.getState().activeId).toBeNull();
  });

  it("create inserts via IPC and makes the new company active", async () => {
    ipcMock.companies.create.mockResolvedValue(co("co_new", "New"));
    ipcMock.settings.update.mockResolvedValue({ activeCompanyId: "co_new" });
    useCompaniesStore.setState({
      companies: [co("co_1", "A")],
      activeId: "co_1",
      loaded: true,
    });
    const created = await useCompaniesStore.getState().create("New");
    expect(created.id).toBe("co_new");
    expect(useCompaniesStore.getState().companies).toHaveLength(2);
    expect(useCompaniesStore.getState().activeId).toBe("co_new");
    expect(ipcMock.settings.update).toHaveBeenCalledWith({ activeCompanyId: "co_new" });
  });

  it("delete removes the company and falls back to first remaining when deleting active", async () => {
    useCompaniesStore.setState({
      companies: [co("co_1", "A"), co("co_2", "B"), co("co_3", "C")],
      activeId: "co_2",
      loaded: true,
    });
    ipcMock.companies.delete.mockResolvedValue({ ok: true });
    ipcMock.settings.update.mockResolvedValue({ activeCompanyId: "co_1" });
    await useCompaniesStore.getState().delete("co_2");
    expect(useCompaniesStore.getState().companies.map((c) => c.id)).toEqual(["co_1", "co_3"]);
    expect(useCompaniesStore.getState().activeId).toBe("co_1");
  });

  it("delete the only company sets activeId to null", async () => {
    useCompaniesStore.setState({
      companies: [co("co_1", "A")],
      activeId: "co_1",
      loaded: true,
    });
    ipcMock.companies.delete.mockResolvedValue({ ok: true });
    ipcMock.settings.update.mockResolvedValue({ activeCompanyId: null });
    await useCompaniesStore.getState().delete("co_1");
    expect(useCompaniesStore.getState().companies).toEqual([]);
    expect(useCompaniesStore.getState().activeId).toBeNull();
  });

  it("delete non-active leaves active unchanged", async () => {
    useCompaniesStore.setState({
      companies: [co("co_1", "A"), co("co_2", "B")],
      activeId: "co_1",
      loaded: true,
    });
    ipcMock.companies.delete.mockResolvedValue({ ok: true });
    await useCompaniesStore.getState().delete("co_2");
    expect(useCompaniesStore.getState().activeId).toBe("co_1");
    expect(ipcMock.settings.update).not.toHaveBeenCalled();
  });

  it("setActive persists via settings.update", async () => {
    useCompaniesStore.setState({
      companies: [co("co_1", "A"), co("co_2", "B")],
      activeId: "co_1",
      loaded: true,
    });
    ipcMock.settings.update.mockResolvedValue({ activeCompanyId: "co_2" });
    await useCompaniesStore.getState().setActive("co_2");
    expect(useCompaniesStore.getState().activeId).toBe("co_2");
    expect(ipcMock.settings.update).toHaveBeenCalledWith({ activeCompanyId: "co_2" });
  });
});
