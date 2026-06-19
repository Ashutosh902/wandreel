import "./App.css";
import { AppShell } from "./ui/layout/AppShell";
import { UxProvider } from "./ui/layout/UxProvider";
import { HomeScreen } from "./ui/home/HomeScreen";
import { AuthProvider } from "./ui/auth/AuthProvider";

function App() {
  return (
    <UxProvider>
      <AuthProvider>
        <AppShell>
          <HomeScreen />
        </AppShell>
      </AuthProvider>
    </UxProvider>
  );
}

export default App;
