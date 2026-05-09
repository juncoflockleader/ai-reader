import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import booksRouter from "./routes/books";
import chatRouter from "./routes/chat";
import highlightsRouter from "./routes/highlights";
import settingsRouter from "./routes/settings";
import { ensureDataDirs } from "./services/storage/files";
import { getDb } from "./services/storage/db";
import { getBasicAuthCredentials, host, isProduction, port, validateDeploymentConfig, type BasicAuthCredentials } from "./config";

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frontendDir = path.join(root, "dist/frontend");
const frontendIndex = path.join(frontendDir, "index.html");

validateDeploymentConfig();
ensureDataDirs();
getDb();

const basicAuthCredentials = getBasicAuthCredentials();
if (basicAuthCredentials) app.use(createBasicAuthMiddleware(basicAuthCredentials));
if (!isProduction) app.use(cors({ origin: "http://127.0.0.1:5173" }));
app.use(express.json({ limit: "8mb" }));
app.use("/api/books", booksRouter);
app.use("/api", highlightsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/settings", settingsRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

if (isProduction) {
  if (!fs.existsSync(frontendIndex)) {
    throw new Error("Missing dist/frontend/index.html. Run `npm run build` before `npm run serve`.");
  }
  app.use(express.static(frontendDir));
  app.get("*", (_req, res) => {
    res.sendFile(frontendIndex);
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown server error.";
  console.error(error);
  res.status(500).json({ error: message });
});

app.listen(port, host, () => {
  const mode = isProduction ? "app" : "API";
  const authStatus = basicAuthCredentials ? "auth enabled" : "auth disabled";
  console.log(`StudyReader ${mode} running at http://${host}:${port} (${authStatus})`);
});

function createBasicAuthMiddleware(credentials: BasicAuthCredentials): express.RequestHandler {
  return (req, res, next) => {
    const parsed = parseBasicAuth(req.header("authorization"));
    if (parsed && safeEqual(parsed.user, credentials.user) && safeEqual(parsed.password, credentials.password)) {
      next();
      return;
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="StudyReader AI", charset="UTF-8"');
    res.status(401).send("Authentication required.");
  };
}

function parseBasicAuth(header: string | undefined) {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

function safeEqual(actual: string, expected: string) {
  const actualHash = crypto.createHash("sha256").update(actual).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}
