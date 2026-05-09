import { AuthProvider, useAuth } from "./hooks/useAuth.tsx";

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

function AppShell() {
  const { authState, signOutUser } = useAuth();
  const user = authState.status === "approved" ? authState.user : null;

  return (
    <div className="shell">
      <div className="status-bar">
        <span className="status-brand">Send It <span className="status-beta">Beta</span></span>
        <div className="status-right">
          {user && <span className="status-user">{user.displayName}</span>}
          <button className="btn-link" onClick={signOutUser}>Sign out</button>
        </div>
      </div>
      <div className="app-content">
        <p className="placeholder">App coming soon.</p>
      </div>
    </div>
  );
}

function AuthGate() {
  const { authState } = useAuth();

  if (authState.status === "loading") return null;
  if (authState.status === "signed_out") return <SignInScreen />;
  if (authState.status === "pending") return <PendingScreen />;
  return <AppShell />;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
