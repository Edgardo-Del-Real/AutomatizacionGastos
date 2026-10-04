import type { KeywordRule } from "./matcher";

/** Category kind: movement-compatible categories plus the reserved savings category. */
export type CategoryType = "NORMAL" | "MIXED" | "EXPENSE" | "INCOME" | "SAVINGS";

export type CategoryEntity = {
  id: string;
  ownerId: string;
  name: string;
  type: CategoryType;
  createdAt: Date;
};

export type CategoryWithKeywords = CategoryEntity & {
  keywords: string[];
};

export type { KeywordRule };