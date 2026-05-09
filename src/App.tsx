import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth.tsx";
import MyLeagues from "./pages/MyLeagues.tsx";
import LeagueShell from "./pages/LeagueShell.tsx";
import LeagueOverview from "./pages/LeagueOverview.tsx";
import TeamDeepDive from "./pages/TeamDeepDive.tsx";
import SendIt from "./pages/SendIt.tsx";
import Calc from "./pages/Calc.tsx";

function SignInScreen() {
  const { signIn } = useAuth();
  return (
    <div className="auth-screen">
      <div className="auth-eyebrow">DYNASTY FANTASY FOOTBALL</div>
      <h1 className="auth-title">SEND IT</h1>
      <p className="auth-tagline">Dynasty trade analysis. Don't get fleeced.</p>
      <button className="btn-google" onClick={signIn}>
        Sign in with Google
      </button>
    </div>
  );
}

function PendingScreen() {
  const { signOutUser } = useAuth();
  return (
    <div className="auth-screen">
      <div className="auth-eyebrow">DYNASTY FANTASY FOOTBALL</div>
      <h1 className="auth-title">SEND IT</h1>
      <p className="auth-tagline">You don't have beta access yet.</p>
      <button className="btn-link" onClick={signOutUser}>Sign out</button>
    </div>
  );
}

function AuthGate() {
  const { authState } = useAuth();

  if (authState.status === "loading") return null;
  if (authState.status === "signed_out") return <SignInScreen />;
  if (authState.status === "pending") return <PendingScreen />;

  return (
    <Routes>
      <Route path="/" element={<MyLeagues />} />
      <Route path="/league/:id" element={<LeagueShell />}>
        <Route index element={<LeagueOverview />} />
        <Route path="team/:rosterId" element={<TeamDeepDive />} />
        <Route path="sendit/:rosterId" element={<SendIt />} />
        <Route path="calc" element={<Calc />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </BrowserRouter>
  );
}
