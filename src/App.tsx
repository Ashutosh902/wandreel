import "./App.css";
import { AppShell } from "./ui/layout/AppShell";
import { UxProvider } from "./ui/layout/UxProvider";
import { HomeScreen } from "./ui/home/HomeScreen";

function App() {
  return (
    <UxProvider>
      <AppShell>
        <HomeScreen />
      </AppShell>
    </UxProvider>
  );
}

export default App;
