import { useLocation } from "wouter";
import { AuthForm } from "./auth-form";
import { useAuth } from "@/contexts/AuthContext";
import { companyLogin } from "@/lib/auth-api";

export default function CompanyLoginPage() {
  const { loginAsCompany } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <AuthForm
      mode="login"
      role="company"
      title="Company sign in"
      subtitle="Manage your hiring pipeline."
      switchHref="/company/register"
      switchLabel="No company account yet? Register →"
      onSubmit={async ({ email, password }) => {
        const res = await companyLogin({ email, password });
        loginAsCompany(res.token, res.company);
        setLocation("/company");
      }}
    />
  );
}
