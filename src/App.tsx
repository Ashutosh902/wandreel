import "./App.css";
import { AppShell } from "./ui/layout/AppShell";
import { HomeScreen } from "./ui/home/HomeScreen";

function App() {
  return (
    <AppShell>
      <HomeScreen />
    </AppShell>
  );
}

export default App;
