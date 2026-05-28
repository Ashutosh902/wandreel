import logoMark from "../assets/brand/logo-mark.svg";
import wordmark from "../assets/brand/wordmark.svg";
import tagline from "../assets/brand/tagline.svg";

type OpeningSplashProps = {
  onComplete?: () => void;
};

export function OpeningSplash({ onComplete }: OpeningSplashProps) {
  return (
    <section className="opening-splash" onClick={onComplete}>
      <div className="splash-center">
        <img className="brand-mark" src={logoMark} alt="Wandreel logo" />
        <img className="brand-wordmark" src={wordmark} alt="Wandreel" />
        <img className="brand-tagline" src={tagline} alt="From scroll to stroll" />
      </div>

      <div className="splash-scenery" aria-hidden="true">
        <svg viewBox="0 0 360 280" className="scenery-svg">
          <path d="M0 210 Q40 160 95 188 T210 178 T360 205 L360 280 L0 280 Z" fill="#daccc0" />
          <path d="M0 232 Q65 180 145 206 T290 194 T360 218 L360 280 L0 280 Z" fill="#e6d8cd" />
          <path d="M82 212 Q140 172 200 196 T312 188" fill="none" stroke="#ba8f73" strokeWidth="3" strokeDasharray="8 8" />
          <circle cx="272" cy="188" r="8" fill="#ff6a1f" />
          <path d="M272 174c-6 0-11 5-11 11 0 3 1 6 3 8l6 7c1 1 3 1 4 0l6-7c2-2 3-5 3-8 0-6-5-11-11-11z" fill="#ff6a1f" />
        </svg>
      </div>
    </section>
  );
}
