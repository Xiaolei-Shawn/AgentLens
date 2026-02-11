import { useState } from "react";
import { LoadSession } from "./components/LoadSession";
import { ReplayView } from "./components/ReplayView";
import type { Session } from "./types/session";

import "./App.css";

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleLoad = (s: Session) => {
    setSession(s);
    setLoadError(null);
  };

  const handleBack = () => {
    setSession(null);
    setLoadError(null);
  };

  if (session) {
    return <ReplayView session={session} onBack={handleBack} />;
  }

  return (
    <>
      {loadError && (
        <div className="app-error" role="alert">
          {loadError}
        </div>
      )}
      <LoadSession onLoad={handleLoad} onError={setLoadError} />
    </>
  );
}

export default App;
