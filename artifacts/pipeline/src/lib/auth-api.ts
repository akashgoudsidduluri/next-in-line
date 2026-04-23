/**
 * Raw fetch helpers for the auth endpoints. The generated API client is built
 * from the OpenAPI spec and does not expose register/login (these were added
 * after the spec was generated), so we call them directly with `fetch`.
 *
 * All other API calls go through the generated client which automatically
 * attaches the bearer token via setAuthTokenGetter (see AuthContext).
 */

export type AuthError = { error: string; code: string };

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = parsed as AuthError | null;
    throw new Error(err?.error ?? `Request failed (${res.status})`);
  }
  return parsed as T;
}

export type CompanyAuthResponse = {
  token: string;
  company: { id: string; name: string; email: string };
};
export type ApplicantAuthResponse = {
  token: string;
  applicant: { id: string; name: string; email: string };
};

export const companyRegister = (input: {
  name: string;
  email: string;
  password: string;
}) => postJson<CompanyAuthResponse>("/api/company/auth/register", input);

export const companyLogin = (input: { email: string; password: string }) =>
  postJson<CompanyAuthResponse>("/api/company/auth/login", input);

export const applicantRegister = (input: {
  name: string;
  email: string;
  password: string;
}) => postJson<ApplicantAuthResponse>("/api/applicant/auth/register", input);

export const applicantLogin = (input: { email: string; password: string }) =>
  postJson<ApplicantAuthResponse>("/api/applicant/auth/login", input);
