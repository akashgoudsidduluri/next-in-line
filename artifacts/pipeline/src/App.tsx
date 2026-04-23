import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TopNav } from "@/components/top-nav";
import { RequireCompany, RequireApplicant } from "@/components/route-guards";

import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import JobDashboard from "@/pages/job-dashboard";
import ApplicantView from "@/pages/application";
import CompanyDashboard from "@/pages/company-dashboard";
import ApplicantPortal from "@/pages/applicant-portal";
import CompanyLoginPage from "@/pages/auth/company-login";
import CompanyRegisterPage from "@/pages/auth/company-register";
import ApplicantLoginPage from "@/pages/auth/applicant-login";
import ApplicantRegisterPage from "@/pages/auth/applicant-register";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />

      <Route path="/company/login" component={CompanyLoginPage} />
      <Route path="/company/register" component={CompanyRegisterPage} />
      <Route path="/applicant/login" component={ApplicantLoginPage} />
      <Route path="/applicant/register" component={ApplicantRegisterPage} />

      <Route path="/company">
        <RequireCompany>
          <CompanyDashboard />
        </RequireCompany>
      </Route>
      <Route path="/jobs/:jobId">
        <RequireCompany>
          <JobDashboard />
        </RequireCompany>
      </Route>

      <Route path="/applicant">
        <RequireApplicant>
          <ApplicantPortal />
        </RequireApplicant>
      </Route>
      <Route path="/apply/:applicationId">
        <RequireApplicant>
          <ApplicantView />
        </RequireApplicant>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

// Hooks a 401 handler into every query: if the token is stale or missing,
// log out and send the user back to the appropriate login screen.
function AuthAwareQueryClient({ children }: { children: React.ReactNode }) {
  const { auth, logout } = useAuth();
  const [, setLocation] = useLocation();

  const client = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
        queryCache: new QueryCache(),
      }),
    [],
  );

  useEffect(() => {
    const unsubscribe = client.getQueryCache().subscribe((evt) => {
      if (evt.type !== "updated") return;
      const err = evt.query.state.error as { status?: number } | null;
      if (err && err.status === 401) {
        logout();
        setLocation(
          auth?.role === "applicant" ? "/applicant/login" : "/company/login",
        );
      }
    });
    return () => unsubscribe();
  }, [client, auth, logout, setLocation]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <AuthAwareQueryClient>
            <TooltipProvider>
              <div className="min-h-[100dvh] bg-background">
                <TopNav />
                <Router />
              </div>
              <Toaster />
            </TooltipProvider>
          </AuthAwareQueryClient>
        </AuthProvider>
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;
