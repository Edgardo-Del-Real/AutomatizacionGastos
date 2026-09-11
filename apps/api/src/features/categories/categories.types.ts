import type { KeywordRule } from "./matcher";

export type CategoryEntity = {
  id: string;
  ownerId: string;
  name: string;
  createdAt: Date;
};

export type CategoryWithKeywords = CategoryEntity & {
  keywords: string[];
};

export type { KeywordRule };