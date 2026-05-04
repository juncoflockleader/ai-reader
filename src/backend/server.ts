import cors from "cors";
import express from "express";
import booksRouter from "./routes/books";
import chatRouter from "./routes/chat";
import highlightsRouter from "./routes/highlights";
import settingsRouter from "./routes/settings";
import { ensureDataDirs } from "./services/storage/files";
import { getDb } from "./services/storage/db";

const app = express();
const port = Number(process.env.PORT ?? 3127);

ensureDataDirs();
getDb();

app.use(cors({ origin: "http://127.0.0.1:5173" }));
app.use(express.json({ limit: "8mb" }));
app.use("/api/books", booksRouter);
app.use("/api", highlightsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/settings", settingsRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown server error.";
  console.error(error);
  res.status(500).json({ error: message });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`StudyReader API running at http://127.0.0.1:${port}`);
});
