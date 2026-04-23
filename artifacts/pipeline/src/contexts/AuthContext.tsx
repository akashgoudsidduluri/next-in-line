import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

export type CompanyIdentity = { id: string; name: string; email: string };
export type ApplicantIdentity = { id: string; name: string; email: string };

export type AuthState =
  | { role: "company"; token: string; company: CompanyIdentity }
  | { role: "applicant"; token: string; applicant: ApplicantIdentity }
  | null;

const STORAGE_KEY = "hiring-pipeline.auth.v1";

function readStoredAuth(): AuthState {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthState;
    if (
      parsed &&
      typeof parsed === "object" &&
      "token" in parsed &&
      typeof parsed.token === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredAuth(auth: AuthState): void {
  if (typeof window === "undefined") return;
  if (auth === null) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  }
}

type AuthContextValue = {
  auth: AuthState;
  loginAsCompany: (token: string, company: CompanyIdentity) => void;
  loginAsApplicant: (token: string, applicant: ApplicantIdentity) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => readStoredAuth());

  // Wire the generated API client so every request carries the bearer token.
  useEffect(() => {
    setAuthTokenGetter(() => auth?.token ?? null);
    return () => setAuthTokenGetter(null);
  }, [auth]);

  const loginAsCompany = useCallback(
    (token: string, company: CompanyIdentity) => {
      const next: AuthState = { role: "company", token, company };
      writeStoredAuth(next);
      setAuth(next);
    },
    [],
  );

  const loginAsApplicant = useCallback(
    (token: string, applicant: ApplicantIdentity) => {
      const next: AuthState = { role: "applicant", token, applicant };
      writeStoredAuth(next);
      setAuth(next);
    },
    [],
  );

  const logout = useCallback(() => {
    writeStoredAuth(null);
    setAuth(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ auth, loginAsCompany, loginAsApplicant, logout }),
    [auth, loginAsCompany, loginAsApplicant, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
