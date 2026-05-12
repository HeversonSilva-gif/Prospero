export type Project = {
  id: string;
  companyId: string;
  name: string;
  path: string;
  color: string;
  slug: string | null;
  createdAt: number;
};

export type ProjectPathStatus = "available" | "missing";
