import { Link, useLocation } from "wouter";
import { Briefcase, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";

export function TopNav() {
  const { auth, logout } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogout = () => {
    logout();
    setLocation("/");
  };

  const homeHref =
    auth?.role === "company"
      ? "/company"
      : auth?.role === "applicant"
        ? "/applicant"
        : "/";

  return (
    <header className="border-b border-border bg-card/50 px-6 py-3 sticky top-0 z-20 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <Link href={homeHref} className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary">
            <Briefcase size={18} />
          </div>
          <h1 className="text-lg font-medium tracking-tight group-hover:text-primary transition-colors">
            Hiring Pipeline
          </h1>
        </Link>

        {auth ? (
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="capitalize text-xs">
              {auth.role}
            </Badge>
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {auth.role === "company" ? auth.company.name : auth.applicant.name}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-muted-foreground"
            >
              <LogOut size={14} className="mr-1.5" /> Sign out
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/company/login">
              <Button variant="ghost" size="sm">
                Company
              </Button>
            </Link>
            <Link href="/applicant/login">
              <Button variant="ghost" size="sm">
                Applicant
              </Button>
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
