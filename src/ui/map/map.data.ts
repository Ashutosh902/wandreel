import { BedDouble, Camera, FerrisWheel, Utensils } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type MapCategoryLabel = "Taste" | "Activity" | "Stay" | "Explore";

export type MapCategoryPin = {
  label: MapCategoryLabel;
  count: number;
  icon: LucideIcon;
  color: string;
  x: string;
  y: string;
};

export const mapCategories: MapCategoryPin[] = [
  { label: "Taste", count: 18, icon: Utensils, color: "#E11D48", x: "18%", y: "31%" },
  { label: "Activity", count: 9, icon: FerrisWheel, color: "#D97706", x: "72%", y: "38%" },
  { label: "Stay", count: 6, icon: BedDouble, color: "#6D28D9", x: "24%", y: "67%" },
  { label: "Explore", count: 22, icon: Camera, color: "#0E7490", x: "75%", y: "60%" },
];

export function runMapDataChecks(): void {
  if (mapCategories.length !== 4) {
    throw new Error("Map expects exactly 4 categories.");
  }

  if (!mapCategories.every((item) => item.label && item.color.trim().length > 0)) {
    throw new Error("Every map category must include label and color.");
  }
}
