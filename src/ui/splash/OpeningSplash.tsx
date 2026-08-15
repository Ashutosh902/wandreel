import openingSplashMark from "../assets/brand/opening-splash-mark.png";

type OpeningSplashProps = {
  onComplete?: () => void;
};

export function OpeningSplash({ onComplete }: OpeningSplashProps) {
  return (
    <section className="opening-splash" onClick={onComplete}>
      <div className="splash-brand-lockup">
        <div className="splash-image-shell">
          <div className="splash-image-glow" aria-hidden="true" />
          <img className="splash-image splash-image-mark" src={openingSplashMark} alt="Wandreel" />
        </div>
        <div className="splash-text-lockup">
          <h1 className="splash-wordmark">WANDREEL</h1>
          <p className="splash-tagline">FROM SCROLL TO STROLL</p>
        </div>
      </div>
    </section>
  );
}
