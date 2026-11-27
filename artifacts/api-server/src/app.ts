import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json({ limit: "128kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err === "object" && err !== null && "status" in err ? Number(err.status) : 503;
  req.log.error({ status }, "Request failed");
  res.status(status >= 400 && status < 500 ? status : 503).json({
    error: status === 413 ? "Notes are too large. Limit notes to 20,000 characters; the editor is unchanged." :
      status === 400 ? "Invalid JSON request." : "Storage or processing is unavailable. Your notes have not been cleared. Retry with the same request key to check whether the run was saved.",
  });
});

export default app;
