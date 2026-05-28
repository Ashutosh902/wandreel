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
  previewTitle: string;
  previewSubtitle: string;
  address: string;
  timing: string;
  imageUrl: string;
};

export const mapCategories: MapCategoryPin[] = [
  {
    label: "Taste",
    count: 18,
    icon: Utensils,
    color: "#E11D48",
    x: "18%",
    y: "31%",
    previewTitle: "Biryani by the Ganges",
    previewSubtitle: "Mughlai · Dinner",
    address: "Boring Canal Road, Boring Road Crossing, Patna, Bihar 800001",
    timing: "Open today · 11:30 AM - 11:00 PM",
    imageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=1200",
  },
  {
    label: "Activity",
    count: 9,
    icon: FerrisWheel,
    color: "#D97706",
    x: "72%",
    y: "38%",
    previewTitle: "Eco Park Cycle Loop",
    previewSubtitle: "Cycling trail · Family friendly",
    address: "Eco Park Gate 2, Rajbansi Nagar, Patna, Bihar 800015",
    timing: "Best time · 6:00 AM - 8:00 AM",
    imageUrl: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&q=80&w=1200",
  },
  {
    label: "Stay",
    count: 6,
    icon: BedDouble,
    color: "#6D28D9",
    x: "24%",
    y: "67%",
    previewTitle: "Riverfront Suites",
    previewSubtitle: "4-star stay · River view",
    address: "Ashok Rajpath, Near Collectorate, Patna, Bihar 800001",
    timing: "Check-in · From 1:00 PM",
    imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=1200",
  },
  {
    label: "Explore",
    count: 22,
    icon: Camera,
    color: "#0E7490",
    x: "75%",
    y: "60%",
    previewTitle: "Golghar Walkthrough",
    previewSubtitle: "Landmark · Heritage",
    address: "Golghar, Gandhi Maidan, Patna, Bihar 800001",
    timing: "Visit window · 9:00 AM - 6:00 PM",
    imageUrl: "https://images.unsplash.com/photo-1527631746610-bca00a040d60?auto=format&fit=crop&q=80&w=1200",
  },
];

export function runMapDataChecks(): void {
  if (mapCategories.length !== 4) {
    throw new Error("Map expects exactly 4 categories.");
  }

  if (!mapCategories.every((item) => item.label && item.color.trim().length > 0)) {
    throw new Error("Every map category must include label and color.");
  }
}
