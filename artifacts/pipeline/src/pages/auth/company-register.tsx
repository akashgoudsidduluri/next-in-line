import { useLocation } from "wouter";
import { AuthForm } from "./auth-form";
import { useAuth } from "@/contexts/AuthContext";
import { companyRegister } from "@/lib/auth-api";

export default function CompanyRegisterPage() {
  const { loginAsCompany } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <AuthForm
      mode="register"
      role="company"
      title="Create company account"
      subtitle="Spin up jobs and manage waitlists."
      switchHref="/company/login"
      switchLabel="Already have an account? Sign in →"
      onSubmit={async ({ name, email, password }) => {
        const res = await companyRegister({
          name: name ?? "",
          email,
          password,
        });
        loginAsCompany(res.token, res.company);
        setLocation("/company");
      }}
    />
  );
}
