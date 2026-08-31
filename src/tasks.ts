import { pool } from "./db.js";
import { ERRORS } from "./errors.js";
import { z } from "zod";
import type { Request, Response } from "express";

const DEFAULT_LIMIT = 10;
const DEFAULT_OFFSET = 0;
const MAX_LIMIT = 50;

type Task = {
  id: string;
  user_id: string;
  body: string;
  done: boolean;
  created_at: Date;
};

type User = {
    user_id: string;
    username: string;
};

type JoinedTaskRow = { [K in keyof Task]: Task[K] | null };

//Requests handlers
async function createUser(req: Request, res: Response) {
    const username = req.body?.username;
    if (typeof username !== "string" || username.trim() === "") {
        invalidReq(res);
        return;
    }
    const result = await pool.query<User>(`INSERT INTO users (username)
                                VALUES ($1)
                                RETURNING *`,
                                [username])
    res.status(201).json(result.rows[0]);
}

async function createTask(req: Request, res: Response) {
    const id = parseId(req.params.userId);
    const body = req.body?.body;
    if (id === null || typeof body !== "string" || body.trim() === "") { 
        invalidReq(res); 
        return; 
    }

    const result = await pool.query<Task>(`INSERT INTO tasks (user_id, body)
                                    SELECT $1, $2
                                    WHERE EXISTS (SELECT 1 FROM users WHERE user_id = $1)
                                    RETURNING *`,
                                    [id, body]);

    if (result.rows[0] === undefined) {
        nonExistentId(res);
        return;
    }
    res.status(201).json(result.rows[0]);
}

async function getTask(req: Request, res: Response) {
    const id = parseId(req.params.id);
    if (id === null) { 
        invalidReq(res); 
        return; 
    }
    const result = await pool.query<Task>("SELECT * FROM tasks WHERE id = $1", [id]);
    if (result.rows[0] === undefined) {
        nonExistentId(res);
        return;
    }

    res.status(200).json(result.rows[0]);
}

async function getTasksByUserId(req: Request, res: Response) {
    const id = parseId(req.params.userId);
    const query = parsePagination(req.query);

    if (id === null || query === null) {
        invalidReq(res);
        return;
    }
    
    const result = await pool.query<JoinedTaskRow>(`SELECT tasks.id, 
                                                    tasks.user_id, 
                                                    tasks.body, 
                                                    tasks.done, 
                                                    tasks.created_at
                                                    FROM users
                                                    LEFT JOIN ( SELECT * FROM tasks WHERE user_id = $1
                                                                ORDER BY created_at, id LIMIT $2 OFFSET $3 ) tasks
                                                    ON users.user_id = tasks.user_id
                                                    WHERE users.user_id = $1`, 
                                                    [id, query.limit, query.offset]);
    if (result.rows[0] === undefined) {
        nonExistentId(res);
        return;
    }
    if (result.rows[0].id === null) {
        res.status(200).json([]);
        return;    
    }
    res.status(200).json(result.rows);
}

async function updateTaskDone(req: Request, res: Response) {
    const id = parseId(req.params.id);
    if (id === null) { 
        invalidReq(res); 
        return; 
    }
    const result = await pool.query<Task>(`UPDATE tasks 
                                    SET done = TRUE 
                                    WHERE id = $1 
                                    RETURNING *`, 
                                    [id]);
    if (result.rows[0] === undefined) {
        nonExistentId(res);
        return;
    }

    res.status(200).json(result.rows[0]);
}

async function deleteTask(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    if (id === null || userId === null) { 
        invalidReq(res); 
        return; 
    }
    const result = await pool.query<Task>(`DELETE  
                                    FROM tasks 
                                    WHERE id = $1 AND user_id = $2
                                    RETURNING *`, 
                                    [id, userId]);

    if (result.rows[0] === undefined) {
        nonExistentId(res);
        return;
    }

    res.status(200).json(result.rows[0]);
}

function invalidReq(res: Response) {
    res.status(400).json(ERRORS.badReq);
    return;
}

function nonExistentId(res: Response) {
    res.status(404).json(ERRORS.notFound);
    return;
}

//schemas
const idSchema = z.string()
                .regex(/^[1-9]\d*$/)
                .transform(Number)
                .refine(Number.isSafeInteger);

const nonNegInt = z.string().regex(/^\d+$/).transform(Number).refine(Number.isSafeInteger);

const pageQuerySchema = z.object({
  limit:  nonNegInt.transform(n => Math.min(n, MAX_LIMIT)).optional(),
  offset: nonNegInt.optional(),
});

//helpers
function parseId(raw: unknown): number | null {
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) {
        return null;
    }
    return parsed.data;
}

function parsePagination(raw: unknown) {
  const parsed = pageQuerySchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    limit:  parsed.data.limit  ?? DEFAULT_LIMIT,
    offset: parsed.data.offset ?? DEFAULT_OFFSET,
  };
}

export {createTask, createUser, getTask, getTasksByUserId, updateTaskDone, deleteTask};