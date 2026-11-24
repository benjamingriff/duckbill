import { createContext, useContext } from "react";
import type { Category } from "@duckbill/api/types";

// Category display (label, colour, group) comes from the API's category table,
// never from the code, so a new taxonomy needs no page changes.
export type CategoryMap = ReadonlyMap<string, Category>;

export const CategoryContext = createContext<CategoryMap>(new Map());

const FALLBACK_COLOUR = "#77716c";

/** Display for a category key, with a readable fallback for unknown keys. */
export function useCategory(): (key: string) => Category {
  const categories = useContext(CategoryContext);
  return (key) =>
    categories.get(key) ?? {
      category: key,
      label: key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      colour: FALLBACK_COLOUR,
      parent: null,
      group: "flexible",
    };
}
