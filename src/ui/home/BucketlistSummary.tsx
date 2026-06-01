import { categories, type CategoryLabel } from "./home.data";

export function BucketlistSummary({
  counts,
  onSelectCategory,
  onAddLink,
}: {
  counts: Record<CategoryLabel, number> & { total: number };
  onSelectCategory: (category: CategoryLabel) => void;
  onAddLink: () => void;
}) {
  return (
    <section className="wr-bucketlist-wrap">
      <div className="wr-section-head"><h3>Your Bucketlist</h3></div>
      <div className="wr-bucketlist-card">
        <div className="wr-bucket-glow wr-bucket-glow-right" />
        <div className="wr-bucket-glow wr-bucket-glow-left" />
        <div className="wr-bucket-glow wr-bucket-glow-bottom" />

        <div className="wr-bucket-top">
          <div>
            <p className="wr-bucket-label">Saved world</p>
            <div className="wr-bucket-count-row">
              <h4>{counts.total}</h4>
              <p>places ready</p>
            </div>
          </div>
          <button
            type="button"
            className="wr-bucket-view-all"
            onClick={() => (counts.total ? onSelectCategory("Taste") : onAddLink())}
          >
            {counts.total ? "View all" : "Add place"}
          </button>
        </div>

        {counts.total ? (
          <div className="wr-bucket-grid">
            {categories.map((cat) => {
              return (
                <button
                  type="button"
                  key={cat.label}
                  className="wr-bucket-item"
                  onClick={() => onSelectCategory(cat.label)}
                  aria-label={`Open ${cat.label} category`}
                >
                  <div className="wr-bucket-item-layer" />
                  <div className="wr-bucket-item-content">
                    <div className="wr-bucket-item-tile">
                      <img src={cat.image} alt={cat.label} className="wr-bucket-item-image" loading="lazy" />
                    </div>
                    <div>
                      <p className="wr-bucket-item-title">{cat.label}</p>
                      <p className="wr-bucket-item-count">{counts[cat.label]}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="wr-bucket-empty-state">
            <h4>No places added yet</h4>
            <p>Save your first reel or place to see it here.</p>
            <button type="button" className="wr-category-empty-cta" onClick={onAddLink}>
              Add place
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
