import { MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useUx } from "../layout/UxProvider";

export function LocationSelector({ inline = false }: { inline?: boolean }) {
  const {
    currentLocationLabel,
    isLocating,
    searchLocations,
    setLocationFromPlaceId,
    useDeviceLocationAsCurrent,
    deviceLocationLabel,
    showToast,
  } = useUx();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ placeId: string; label: string; secondaryText: string | null; description: string | null }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handle = window.setTimeout(async () => {
      const nextQuery = query.trim();
      if (nextQuery.length < 2) {
        setResults([]);
        return;
      }
      setIsSearching(true);
      setSearchUnavailable(false);
      try {
        const next = await searchLocations(nextQuery);
        setResults(next);
      } catch {
        setResults([]);
        setSearchUnavailable(true);
      } finally {
        setIsSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(handle);
  }, [isOpen, query, searchLocations]);

  return (
    <section ref={rootRef} className={`wr-location-section${inline ? " wr-location-section-inline" : ""}`}>
      <div className="wr-location-pill">
        <div className="wr-location-main">
          <MapPin size={16} className="wr-location-icon" />
          <p className="wr-location-text">{currentLocationLabel}</p>
        </div>
        <button type="button" className="wr-location-change" onClick={() => setIsOpen((open) => !open)}>
          {isLocating ? "Locating..." : "Change"}
        </button>
      </div>
      {isOpen ? (
        <div className="wr-location-menu" role="dialog" aria-label="Change location">
          <input
            type="text"
            className="wr-location-input"
            placeholder="Search city or locality..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <button
            type="button"
            className="wr-location-option is-current"
            onClick={() => {
              void useDeviceLocationAsCurrent();
              setIsOpen(false);
            }}
          >
            <span>Current location</span>
            <small>{deviceLocationLabel || "Use device GPS"}</small>
          </button>
          {isSearching ? <p className="wr-location-helper">Searching...</p> : null}
          {!isSearching && searchUnavailable ? (
            <p className="wr-location-helper">Location suggestions unavailable right now.</p>
          ) : null}
          {!isSearching && query.trim().length >= 2 && results.length === 0 ? (
            <p className="wr-location-helper">
              {searchUnavailable ? "Try again in a moment." : "No matching places found."}
            </p>
          ) : null}
          {results.map((item) => (
            <button
              key={item.placeId}
              type="button"
              className="wr-location-option"
              onClick={async () => {
                const ok = await setLocationFromPlaceId(item.placeId);
                if (!ok) {
                  showToast({ message: "Couldn’t set that location. Please try again.", variant: "error" });
                  return;
                }
                setIsOpen(false);
                setQuery("");
                setResults([]);
              }}
            >
              <span>{item.label}</span>
              <small>{item.secondaryText || item.description || ""}</small>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
