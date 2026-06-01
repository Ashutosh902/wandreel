import {
  BedDouble,
  Camera,
  Compass,
  FerrisWheel,
  Globe2,
  LogIn,
  MapPin,
  Plus,
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import tasteCategoryImage from "../assets/categories/taste.png";
import activityCategoryImage from "../assets/categories/activity.png";
import stayCategoryImage from "../assets/categories/stay.png";
import exploreCategoryImage from "../assets/categories/explore.png";

export type CategoryItem = {
  label: CategoryLabel;
  icon: LucideIcon;
  fill: string;
  image: string;
};

export type NavLabel = "Discover" | "Map" | "Add" | "Connect" | "Login";
export type CategoryLabel = "Taste" | "Activity" | "Stay" | "Explore";

export type NavItem = {
  label: NavLabel;
  icon: LucideIcon;
};

export const categories: CategoryItem[] = [
  { label: "Taste", icon: Utensils, fill: "from-[#C2410C] to-[#E11D48]", image: tasteCategoryImage },
  { label: "Activity", icon: FerrisWheel, fill: "from-[#B45309] to-[#D97706]", image: activityCategoryImage },
  { label: "Stay", icon: BedDouble, fill: "from-[#4C1D95] to-[#6D28D9]", image: stayCategoryImage },
  { label: "Explore", icon: Camera, fill: "from-[#0F766E] to-[#0E7490]", image: exploreCategoryImage },
];

export const navItems: NavItem[] = [
  { label: "Discover", icon: Compass },
  { label: "Map", icon: MapPin },
  { label: "Add", icon: Plus },
  { label: "Connect", icon: Globe2 },
  { label: "Login", icon: LogIn },
];

export function runHomeDataChecks(): void {
  if (categories.length !== 4) {
    throw new Error("Wandreel home expects exactly 4 category tiles.");
  }

  if (!categories.every((category) => category.label && category.fill.trim().length > 0)) {
    throw new Error("Every category must include label and fill.");
  }

  if (navItems.length !== 5) {
    throw new Error("Bottom navigation expects exactly 5 items.");
  }

  if (new Set(navItems.map((item) => item.label)).size !== navItems.length) {
    throw new Error("Bottom navigation labels must be unique.");
  }
}
