import { Router, type IRouter } from "express";
import { z } from "zod";
import { registerApplicant, loginApplicant } from "../auth/service";
import { signApplicantToken } from "../auth/jwt";

const RegisterBody = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export const applicantAuthRouter: IRouter = Router();

applicantAuthRouter.post("/applicant/auth/register", async (req, res, next) => {
  try {
    const body = RegisterBody.parse(req.body);
    const applicant = await registerApplicant(body);
    res.status(201).json({
      token: signApplicantToken(applicant.id),
      applicant: {
        id: applicant.id,
        name: applicant.name,
        email: applicant.email,
      },
    });
  } catch (err) {
    next(err);
  }
});

applicantAuthRouter.post("/applicant/auth/login", async (req, res, next) => {
  try {
    const body = LoginBody.parse(req.body);
    const applicant = await loginApplicant(body);
    res.json({
      token: signApplicantToken(applicant.id),
      applicant: {
        id: applicant.id,
        name: applicant.name,
        email: applicant.email,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default applicantAuthRouter;
