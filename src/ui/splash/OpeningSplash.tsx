import openingSplashLogo from "../assets/brand/opening-splash-logo.png";
import wordmark from "../assets/brand/wordmark.svg";
import tagline from "../assets/brand/tagline.svg";

type OpeningSplashProps = {
  onComplete?: () => void;
};

export function OpeningSplash({ onComplete }: OpeningSplashProps) {
  return (
    <section className="opening-splash" onClick={onComplete}>
      <div className="splash-brand-lockup">
        <div className="splash-image-shell">
          <div className="splash-image-glow" aria-hidden="true" />
          <div className="splash-mark-frame" aria-hidden="true">
            <img className="splash-image splash-image-mark" src={openingSplashLogo} alt="" />
          </div>
        </div>
        <div className="splash-text-lockup">
          <img className="brand-wordmark splash-wordmark" src={wordmark} alt="Wandreel" />
          <img className="brand-tagline splash-tagline" src={tagline} alt="From scroll to stroll" />
        </div>
      </div>
    </section>
  );
}
