import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

export function RequireCompany({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!auth || auth.role !== "company") {
      setLocation("/company/login");
    }
  }, [auth, setLocation]);

  if (!auth || auth.role !== "company") return null;
  return <>{children}</>;
}

export function RequireApplicant({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!auth || auth.role !== "applicant") {
      setLocation("/applicant/login");
    }
  }, [auth, setLocation]);

  if (!auth || auth.role !== "applicant") return null;
  return <>{children}</>;
}
