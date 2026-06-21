import "./App.css";
import { AppShell } from "./ui/layout/AppShell";
import { UxProvider } from "./ui/layout/UxProvider";
import { HomeScreen } from "./ui/home/HomeScreen";
import AdminPage from "./ui/admin/AdminPage";
import { AuthProvider } from "./ui/auth/AuthProvider";

function App() {
  return (
    <UxProvider>
      <AuthProvider>
        <AppShell>
          {typeof window !== "undefined" && window.location.pathname.startsWith("/admin") ? (
            <AdminPage />
          ) : (
            <HomeScreen />
          )}
        </AppShell>
      </AuthProvider>
    </UxProvider>
  );
}

export default App;
