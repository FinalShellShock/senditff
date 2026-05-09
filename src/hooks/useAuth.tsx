import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { auth, db } from "../lib/firebase.ts";

type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "pending"; user: User }   // signed in but not yet approved
  | { status: "approved"; user: User }; // signed in and approved

type AuthContextValue = {
  authState: AuthState;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
  getToken: () => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function checkApproval(user: User): Promise<boolean> {
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() && snap.data()?.["approved"] === true;
}

async function ensureUserDoc(user: User): Promise<void> {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email,
      displayName: user.displayName,
      approved: false,
      createdAt: new Date().toISOString(),
    });
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAuthState({ status: "signed_out" });
        return;
      }
      try {
        await ensureUserDoc(user);
        const approved = await checkApproval(user);
        setAuthState(approved ? { status: "approved", user } : { status: "pending", user });
      } catch (err) {
        console.error("Auth state error:", err);
        setAuthState({ status: "pending", user });
      }
    });
  }, []);

  const signIn = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
  }, []);

  const getToken = useCallback(async (): Promise<string> => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    return user.getIdToken();
  }, []);

  return (
    <AuthContext.Provider value={{ authState, signIn, signOutUser, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
