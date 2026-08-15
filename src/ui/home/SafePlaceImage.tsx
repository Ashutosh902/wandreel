import { useEffect, useState } from "react";
import type { CategoryLabel } from "./home.data";
import { getSavedPlaceFallbackImage, normalizeSavedPlaceImageUrl } from "./savedPlaces";

type SafePlaceImageProps = {
  src: string | null | undefined;
  category: CategoryLabel;
  alt: string;
  className: string;
  loading?: "eager" | "lazy";
};

export function SafePlaceImage({ src, category, alt, className, loading = "lazy" }: SafePlaceImageProps) {
  const fallbackSrc = getSavedPlaceFallbackImage(category);
  const normalizedSrc = normalizeSavedPlaceImageUrl(src) || fallbackSrc;
  const [currentSrc, setCurrentSrc] = useState(normalizedSrc);

  useEffect(() => {
    setCurrentSrc(normalizedSrc);
  }, [normalizedSrc]);

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      loading={loading}
      onError={() => {
        if (currentSrc !== fallbackSrc) {
          setCurrentSrc(fallbackSrc);
        }
      }}
    />
  );
}
