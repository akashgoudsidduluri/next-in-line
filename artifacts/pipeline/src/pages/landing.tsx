import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Briefcase, UserCircle, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function Landing() {
  const { auth } = useAuth();
  const [, setLocation] = useLocation();

  // Already signed in? Bounce to the appropriate dashboard.
  useEffect(() => {
    if (auth?.role === "company") setLocation("/company");
    else if (auth?.role === "applicant") setLocation("/applicant");
  }, [auth, setLocation]);

  return (
    <div className="min-h-[calc(100dvh-64px)] flex items-center justify-center px-4 py-10 bg-muted/10">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-10 space-y-3">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Bounded-capacity hiring, done right.
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            A deterministic pipeline with strict capacity limits, an ordered
            waitlist, and decay penalties for ghosting. Choose how you'd like to
            sign in.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="hover:shadow-md transition-shadow border-primary/10">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                <Briefcase size={22} />
              </div>
              <CardTitle>I'm hiring</CardTitle>
              <CardDescription>
                Create jobs, set capacity, and watch the pipeline fill up in real
                time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/company/login">
                <Button className="w-full" size="lg">
                  Sign in as company <ArrowRight size={16} className="ml-2" />
                </Button>
              </Link>
              <Link href="/company/register">
                <Button variant="outline" className="w-full" size="sm">
                  Create a company account
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow border-primary/10">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                <UserCircle size={22} />
              </div>
              <CardTitle>I'm applying</CardTitle>
              <CardDescription>
                Browse open jobs, apply, see your queue position, and acknowledge
                offers before they decay.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/applicant/login">
                <Button className="w-full" size="lg">
                  Sign in as applicant <ArrowRight size={16} className="ml-2" />
                </Button>
              </Link>
              <Link href="/applicant/register">
                <Button variant="outline" className="w-full" size="sm">
                  Create an applicant account
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
