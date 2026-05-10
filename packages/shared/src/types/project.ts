export type Project = {
  id: string;
  companyId: string;
  name: string;
  path: string;
  color: string;
  createdAt: number;
};

export type ProjectPathStatus = "available" | "missing";
