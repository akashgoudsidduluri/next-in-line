import { useLocation } from "wouter";
import { AuthForm } from "./auth-form";
import { useAuth } from "@/contexts/AuthContext";
import { applicantRegister } from "@/lib/auth-api";

export default function ApplicantRegisterPage() {
  const { loginAsApplicant } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <AuthForm
      mode="register"
      role="applicant"
      title="Create applicant account"
      subtitle="Apply to jobs and track your queue position."
      switchHref="/applicant/login"
      switchLabel="Already registered? Sign in →"
      onSubmit={async ({ name, email, password }) => {
        const res = await applicantRegister({
          name: name ?? "",
          email,
          password,
        });
        loginAsApplicant(res.token, res.applicant);
        setLocation("/applicant");
      }}
    />
  );
}
