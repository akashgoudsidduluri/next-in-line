import { Router, type IRouter } from "express";
import { z } from "zod";
import { registerCompany, loginCompany } from "../auth/service";
import { signCompanyToken } from "../auth/jwt";

const RegisterBody = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const router: IRouter = Router();

router.post("/company/auth/register", async (req, res, next) => {
  try {
    const body = RegisterBody.parse(req.body);
    const company = await registerCompany(body);
    res.status(201).json({
      token: signCompanyToken(company.id),
      company: { id: company.id, name: company.name, email: company.email },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/company/auth/login", async (req, res, next) => {
  try {
    const body = LoginBody.parse(req.body);
    const company = await loginCompany(body);
    res.json({
      token: signCompanyToken(company.id),
      company: { id: company.id, name: company.name, email: company.email },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
