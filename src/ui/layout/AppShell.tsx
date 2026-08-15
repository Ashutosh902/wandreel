import { useEffect, useMemo, useState } from "react";
import { SPLASH_DURATION_MS } from "../theme/tokens";
import { OpeningSplash } from "../splash/OpeningSplash";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const [showSplash, setShowSplash] = useState(true);
  const [splashVisible, setSplashVisible] = useState(true);

  useEffect(() => {
    const done = setTimeout(() => setShowSplash(false), SPLASH_DURATION_MS);
    return () => clearTimeout(done);
  }, []);

  useEffect(() => {
    if (!showSplash) {
      const fade = setTimeout(() => setSplashVisible(false), 320);
      return () => clearTimeout(fade);
    }
  }, [showSplash]);

  const splashClass = useMemo(() => (showSplash ? "splash-layer is-active" : "splash-layer is-exit"), [showSplash]);

  return (
    <div className="app-shell-root">
      {splashVisible ? (
        <div className={splashClass}>
          <OpeningSplash onComplete={() => setShowSplash(false)} />
        </div>
      ) : null}
      <div className={`main-layer ${splashVisible ? "is-hidden" : "is-visible"}`}>{children}</div>
    </div>
  );
}
