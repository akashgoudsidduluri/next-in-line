import { useLocation } from "wouter";
import { AuthForm } from "./auth-form";
import { useAuth } from "@/contexts/AuthContext";
import { applicantLogin } from "@/lib/auth-api";

export default function ApplicantLoginPage() {
  const { loginAsApplicant } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <AuthForm
      mode="login"
      role="applicant"
      title="Applicant sign in"
      subtitle="Track your applications and acknowledge offers."
      switchHref="/applicant/register"
      switchLabel="New here? Create an applicant account →"
      onSubmit={async ({ email, password }) => {
        const res = await applicantLogin({ email, password });
        loginAsApplicant(res.token, res.applicant);
        setLocation("/applicant");
      }}
    />
  );
}
