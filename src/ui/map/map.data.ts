import { BedDouble, Camera, FerrisWheel, Utensils } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type MapCategoryLabel = "Taste" | "Activity" | "Stay" | "Explore";

export type MapCategoryStyle = {
  label: MapCategoryLabel;
  icon: LucideIcon;
  color: string;
};

export const mapCategoryStyles: MapCategoryStyle[] = [
  { label: "Taste", icon: Utensils, color: "#E11D48" },
  { label: "Activity", icon: FerrisWheel, color: "#D97706" },
  { label: "Stay", icon: BedDouble, color: "#6D28D9" },
  { label: "Explore", icon: Camera, color: "#0E7490" },
];

export function runMapDataChecks(): void {
  if (mapCategoryStyles.length !== 4) {
    throw new Error("Map expects exactly 4 categories.");
  }

  if (!mapCategoryStyles.every((item) => item.label && item.color.trim().length > 0)) {
    throw new Error("Every map category must include label and color.");
  }
}
