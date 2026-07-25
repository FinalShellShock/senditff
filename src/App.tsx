import { Component, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth.tsx";
import MyLeagues from "./pages/MyLeagues.tsx";
import LeagueShell from "./pages/LeagueShell.tsx";
import LeagueOverview from "./pages/LeagueOverview.tsx";
import TeamDeepDive from "./pages/TeamDeepDive.tsx";
import SendIt from "./pages/SendIt.tsx";
import Calc from "./pages/Calc.tsx";
import TradeGrades from "./pages/TradeGrades.tsx";
import Footer from "./pages/Footer.tsx";

class AppErrorBoundary extends Component<{ children: ReactNode }, { caught: Error | null }> {
  state: { caught: Error | null } = { caught: null };
  static getDerivedStateFromError(e: Error) { return { caught: e }; }
  render() {
    if (this.state.caught) {
      return (
        <div style={{ padding: 48, fontFamily: "monospace", color: "#ef4444" }}>
          <div style={{ marginBottom: 12, fontWeight: 700 }}>Something went wrong</div>
          <div style={{ marginBottom: 16, opacity: 0.8, fontSize: 13 }}>{this.state.caught.message}</div>
          <button onClick={() => { this.setState({ caught: null }); window.location.reload(); }}
            style={{ background: "none", border: "1px solid #ef4444", color: "#ef4444", padding: "6px 14px", cursor: "pointer", fontFamily: "monospace" }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  if (authState.status === "signed_out") return <><SignInScreen /><Footer /></>;
  if (authState.status === "pending") return <><PendingScreen /><Footer /></>;

  return (
    <>
      <Routes>
        <Route path="/" element={<MyLeagues />} />
        <Route path="/league/:id" element={<LeagueShell />}>
          <Route index element={<LeagueOverview />} />
          <Route path="team/:rosterId" element={<TeamDeepDive />} />
          <Route path="sendit/:rosterId" element={<SendIt />} />
          <Route path="calc" element={<Calc />} />
          <Route path="trades" element={<TradeGrades />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Footer authed />
    </>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
