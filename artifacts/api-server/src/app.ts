import express, { type Express } from "express";
import cors from "cors";
import { loggingMiddleware } from "./middlewares/logging";
import router from "./routes";

const app: Express = express();

app.use(loggingMiddleware());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
