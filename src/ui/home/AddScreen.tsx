import { useEffect, useMemo, useState } from "react";
import { Bell, Link2, RefreshCw, Sparkles, X } from "lucide-react";

type DetectedCategory = "Taste" | "Activity" | "Stay" | "Explore";

type DetectedPlace = {
  id: string;
  name: string;
  category: DetectedCategory;
  locality: string;
  source: string;
  imageUrl: string;
  fullAddress: string;
  videoUrl: string;
};

const mockDetectedPlaces: DetectedPlace[] = [
  {
    id: "1",
    name: "Litti Courtyard",
    category: "Taste",
    locality: "Patna City",
    source: "Instagram Reel",
    imageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=1200",
    fullAddress: "Patna City, near Ashok Rajpath, Patna, Bihar",
    videoUrl: "https://www.instagram.com/reel/mock",
  },
  {
    id: "2",
    name: "Eco Park Patna",
    category: "Activity",
    locality: "Bailey Road",
    source: "YouTube Short",
    imageUrl: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&q=80&w=1200",
    fullAddress: "Eco Park, Jawaharlal Nehru Marg, Patna, Bihar",
    videoUrl: "https://youtube.com/shorts/mock",
  },
  {
    id: "3",
    name: "Mint Leaf Cafe",
    category: "Taste",
    locality: "Patliputra Colony",
    source: "Instagram Reel",
    imageUrl: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=1200",
    fullAddress: "Patliputra Colony, Patna, Bihar",
    videoUrl: "https://www.instagram.com/reel/mock2",
  },
  {
    id: "4",
    name: "Golghar",
    category: "Explore",
    locality: "Ashok Rajpath",
    source: "YouTube Short",
    imageUrl: "https://images.unsplash.com/photo-1527631746610-bca00a040d60?auto=format&fit=crop&q=80&w=1200",
    fullAddress: "Golghar, Ashok Rajpath, Patna, Bihar",
    videoUrl: "https://youtube.com/shorts/mock2",
  },
];

const chipOrder: Array<"Auto-detect" | DetectedCategory> = [
  "Auto-detect",
  "Taste",
  "Activity",
  "Stay",
  "Explore",
];

export function AddScreen() {
  const [linkInput, setLinkInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [selectedDetectedCategory, setSelectedDetectedCategory] = useState<"Auto-detect" | DetectedCategory>("Auto-detect");
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const [detectedPlaces, setDetectedPlaces] = useState<DetectedPlace[]>([]);
  const [isPreviewVisible, setIsPreviewVisible] = useState(true);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    if (!saveMessage) return;
    const timer = window.setTimeout(() => setSaveMessage(""), 1800);
    return () => window.clearTimeout(timer);
  }, [saveMessage]);

  const categoryCounts = useMemo(() => {
    const base: Record<DetectedCategory, number> = {
      Taste: 0,
      Activity: 0,
      Stay: 0,
      Explore: 0,
    };
    for (const item of detectedPlaces) base[item.category] += 1;
    return {
      total: detectedPlaces.length,
      ...base,
    };
  }, [detectedPlaces]);

  const visibleDetectedPlaces = useMemo(() => {
    if (selectedDetectedCategory === "Auto-detect") return detectedPlaces;
    return detectedPlaces.filter((item) => item.category === selectedDetectedCategory);
  }, [detectedPlaces, selectedDetectedCategory]);

  const selectedPreview = visibleDetectedPlaces[selectedPreviewIndex] ?? null;

  const handleAnalyze = () => {
    if (!linkInput.trim() || isAnalyzing) return;
    setIsAnalyzing(true);
    setHasAnalyzed(false);
    setIsPreviewVisible(true);
    setDetectedPlaces([]);
    setSelectedDetectedCategory("Auto-detect");
    setSelectedPreviewIndex(0);

    window.setTimeout(() => {
      setDetectedPlaces(mockDetectedPlaces);
      setHasAnalyzed(true);
      setIsAnalyzing(false);
      setSelectedDetectedCategory("Auto-detect");
      setSelectedPreviewIndex(0);
      setIsPreviewVisible(true);
    }, 1450);
  };

  const handleCategorySelect = (next: "Auto-detect" | DetectedCategory) => {
    setSelectedDetectedCategory(next);
    setSelectedPreviewIndex(0);
    setIsPreviewVisible(true);
  };

  const handleSavePlace = () => {
    if (!selectedPreview) return;
    setSaveMessage(`Saved to ${selectedPreview.category}`);
  };

  const getChipCount = (chip: "Auto-detect" | DetectedCategory) => {
    if (chip === "Auto-detect") return categoryCounts.total;
    return categoryCounts[chip];
  };

  return (
    <section className="wr-add-page" aria-label="Add page">
      <div className="wr-add-top-mini">
        <div className="wr-add-quick-pill">
          <Sparkles size={13} />
          <span>Quick capture</span>
        </div>
        <button type="button" className="wr-add-notify-btn" aria-label="Notifications">
          <Bell size={16} />
        </button>
      </div>

      <div className="wr-add-title-block">
        <h2>Add a Wandreel</h2>
        <p>Save the scroll. Make it a stroll.</p>
      </div>

      <article className="wr-add-paste-card">
        <div className="wr-add-card-head">
          <div>
            <h3>Paste your link</h3>
            <p>Instagram, YouTube, TikToks.</p>
          </div>
          <button type="button" className="wr-add-refresh-btn" aria-label="Refresh link input">
            <RefreshCw size={13} />
          </button>
        </div>

        <label className="wr-add-link-input-wrap">
          <Link2 size={16} className="wr-add-link-icon" />
          <input
            type="url"
            value={linkInput}
            onChange={(event) => setLinkInput(event.target.value)}
            placeholder="Paste link here..."
            className="wr-add-link-input"
          />
        </label>

        <button
          type="button"
          className={`wr-add-analyze-btn ${isAnalyzing ? "is-loading" : ""}`}
          disabled={isAnalyzing || !linkInput.trim()}
          onClick={handleAnalyze}
        >
          <span>{isAnalyzing ? "Turning scroll into stroll..." : "Analyze link"}</span>
          {isAnalyzing ? (
            <span className="wr-add-stroll-loader" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
          ) : null}
        </button>
      </article>

      {hasAnalyzed ? (
        <section className="wr-add-detected-wrap" aria-label="Detected places">
          <div className="wr-add-detected-head">
            <p>Detected from this link</p>
            <span>{categoryCounts.total} places</span>
          </div>

          <div className="wr-add-chip-row">
            {chipOrder.map((chip) => {
              const count = getChipCount(chip);
              const isSelected = selectedDetectedCategory === chip;
              return (
                <button
                  type="button"
                  key={chip}
                  className={`wr-add-chip is-${chip.replace("Auto-detect", "auto").toLowerCase().replace(" ", "-")} ${isSelected ? "is-selected" : ""}`}
                  onClick={() => handleCategorySelect(chip)}
                >
                  <span>{chip}</span>
                  <strong>{count}</strong>
                </button>
              );
            })}
          </div>

          {isPreviewVisible && selectedPreview ? (
            <article className="wr-add-preview-card">
              <button type="button" className="wr-add-preview-close" aria-label="Close preview card" onClick={() => setIsPreviewVisible(false)}>
                <X size={14} />
              </button>
              <img src={selectedPreview.imageUrl} alt={selectedPreview.name} className="wr-add-preview-image" />
              <div className="wr-add-preview-body">
                <p className="wr-add-preview-kicker">
                  DETECTED PREVIEW {selectedPreviewIndex + 1} OF {visibleDetectedPlaces.length || 1}
                </p>
                <h4>{selectedPreview.name}</h4>
                <p>{selectedPreview.category} · {selectedPreview.locality}</p>
                <p>From {selectedPreview.source}</p>
                <div className="wr-add-preview-actions">
                  <button type="button" className="wr-add-preview-btn">Edit details</button>
                  <button type="button" className="wr-add-preview-btn is-primary" onClick={handleSavePlace}>Save place</button>
                </div>
              </div>
            </article>
          ) : null}

          {saveMessage ? <p className="wr-add-save-toast">{saveMessage}</p> : null}
        </section>
      ) : (
        <section className="wr-add-empty-state" aria-label="Detected preview empty state">
          Your detected place will appear here.
        </section>
      )}
    </section>
  );
}
