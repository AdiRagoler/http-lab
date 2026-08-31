import express from "express";
import type { Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { createTask, createUser, getTask, getTasksByUserId, updateTaskDone, deleteTask } from "./tasks.js";
import { ERRORS } from "./errors.js";

const limiter = rateLimit({
  windowMs: 60000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: ERRORS.rateLimited,
});

const listeningPort = 3003;
const app = express();

app.use(limiter);
app.use(express.json({ limit: "5kb" }));

app.post('/users/:userId/tasks', createTask);

app.post('/users', createUser);

app.get('/users/:userId/tasks', getTasksByUserId);

app.get('/tasks/:id', getTask);

app.patch('/tasks/:id', updateTaskDone);

app.delete('/users/:userId/tasks/:id', deleteTask);

app.use((err: unknown, _req: Request, res: Response, _next:NextFunction) => {
    const status =
    typeof err === "object" && err !== null && "status" in err
        ? err.status
        : undefined;

    if (status === 400) {
        res.status(400).json(ERRORS.badReq);
        return;
    }

    if (status === 413) {
        res.status(413).json(ERRORS.bodyTooLarge);
        return;
    }

    if (status === 415) {
        res.status(415).json(ERRORS.badChar);
        return;
    }

    console.error(err);
    res.status(500).json(ERRORS.internalError);
    });

app.listen(listeningPort, () => {
  console.log(`listening on port ${listeningPort}`);
});
