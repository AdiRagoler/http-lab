import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createTask, createUser, getTask, getTasksByUserId, updateTaskDone, deleteTask } from "./tasks.js";

const listeningPort = 3003;
const app = express();
app.use(express.json());

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
    
    const code = 
    typeof err === "object" && err !== null && "code" in err
        ? err.code
        : undefined;

    if (status === 400) {
        res.status(400).json({
            error: {
            code: "bad_req",
            message: "Invalid Request",
            },
        });
        return;
    }

    if (code === "23503") {
        res.status(404).json({
            error: {
                code: "no_such_user",
                message: "This User doesn't exist",
            }
        });
        return;
    }

    console.error(err);
    res.status(500).json({
        error: {
            code: "internal_error",
            message: "Something went wrong",
        },
    });
    });

app.listen(listeningPort, () => {
  console.log(`listening on port ${listeningPort}`);
});
