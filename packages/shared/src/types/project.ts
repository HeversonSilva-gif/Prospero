export type Project = {
  id: string;
  companyId: string;
  name: string;
  path: string;
  color: string;
  icon: string | null;
  archivedAt: number | null;
  slug: string | null;
  digestPath: string | null;
  createdAt: number;
};

export type ProjectPathStatus = "available" | "missing";
