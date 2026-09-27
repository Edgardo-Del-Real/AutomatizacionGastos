import type { KeywordRule } from "./matcher";

/** Category kind (D9): SAVINGS categories ("ahorro") hold only SAVINGS movements. */
export type CategoryType = "NORMAL" | "SAVINGS";

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