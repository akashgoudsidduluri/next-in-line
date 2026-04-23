import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Briefcase } from "lucide-react";

type Mode = "login" | "register";

export type AuthFormProps = {
  mode: Mode;
  role: "company" | "applicant";
  title: string;
  subtitle: string;
  switchHref: string;
  switchLabel: string;
  onSubmit: (input: {
    name?: string;
    email: string;
    password: string;
  }) => Promise<void>;
  footer?: ReactNode;
};

export function AuthForm(props: AuthFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await props.onSubmit({
        name: props.mode === "register" ? name : undefined,
        email: email.trim(),
        password,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100dvh-64px)] flex items-center justify-center bg-muted/20 px-4 py-10">
      <Card className="w-full max-w-md shadow-md">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
            <Briefcase size={20} />
          </div>
          <CardTitle className="text-2xl">{props.title}</CardTitle>
          <CardDescription>{props.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {props.mode === "register" && (
              <div className="space-y-2">
                <Label htmlFor="name">
                  {props.role === "company" ? "Company name" : "Full name"}
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={1}
                  placeholder={
                    props.role === "company" ? "Acme Inc." : "Jane Doe"
                  }
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="At least 8 characters"
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting
                ? "Please wait…"
                : props.mode === "register"
                  ? "Create account"
                  : "Sign in"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            <Link href={props.switchHref} className="text-primary hover:underline">
              {props.switchLabel}
            </Link>
          </div>

          {props.footer && <div className="mt-4">{props.footer}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
