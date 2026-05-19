import { Router } from "express";

const writerRouter = Router();

writerRouter.use((_req, res) => {
  res.status(501).json({ error: "Writer API not implemented yet." });
});

export default writerRouter;
