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
  // Whether this account can approve join requests. Read from the user doc,
  // which is Admin SDK only (firestore.rules), so this is a UI hint rather
  // than the gate. Every admin endpoint re-checks server-side.
  isAdmin: boolean;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
  getToken: () => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readAccess(user: User): Promise<{ approved: boolean; admin: boolean }> {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) return { approved: false, admin: false };
  const d = snap.data();
  return {
    approved: d?.["approved"] === true || d?.["subscribed"] === true,
    admin: d?.["admin"] === true,
  };
}

async function ensureUserDoc(user: User): Promise<void> {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;

  // Always created UNAPPROVED. Access is granted server-side, never here.
  //
  // This used to migrate approval from a V1 email-keyed doc, which meant the
  // client wrote `approved` itself. That was the loophole the Firestore rules
  // had to leave open, and with it open the approval gate was decorative:
  // anyone who could sign in could set the flag in devtools. All three V1
  // users were verified migrated on 2026-07-25, so the path was dead code
  // keeping a hole propped open.
  await setDoc(ref, {
    email: user.email,
    displayName: user.displayName,
    approved: false,
    leagueIds: [],
    createdAt: new Date().toISOString(),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAuthState({ status: "signed_out" });
        setIsAdmin(false);
        return;
      }
      try {
        await ensureUserDoc(user);
        const { approved, admin } = await readAccess(user);
        setIsAdmin(admin);
        setAuthState(approved ? { status: "approved", user } : { status: "pending", user });
      } catch (err) {
        console.error("Auth state error:", err);
        setIsAdmin(false);
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
    <AuthContext.Provider value={{ authState, isAdmin, signIn, signOutUser, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
