import { pool } from "./db.js";
import type { Request, Response } from "express";

async function createUser(req: Request, res: Response) {
    const username = req.body?.username;
    if (typeof username !== "string" || username.trim() === "") {
        invalidReq(res);
        return;
    }
    const result = await pool.query(`INSERT INTO users (username)
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

    const result = await pool.query(`INSERT INTO tasks (user_id, body)
                                    VALUES ($1, $2)
                                    RETURNING *`,
                                    [id, body]);

    res.status(201).json(result.rows[0]);
}

async function getTask(req: Request, res: Response) {
    const id = parseId(req.params.id);
    if (id === null) { 
        invalidReq(res); 
        return; 
    }
    const result = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
    if (result.rows[0] === undefined) {
        nonExistentId(res);
        return;
    }

    res.status(200).json(result.rows[0]);
}

async function getTasksByUserId(req: Request, res: Response) {
    const id = parseId(req.params.userId);
    if (id === null) { 
        invalidReq(res); 
        return; 
    }
    const idCheck = await pool.query("SELECT EXISTS (SELECT 1 FROM users WHERE user_id = $1)", [id]);
    if (!idCheck.rows[0].exists) {
        nonExistentId(res);
        return;
    }
    
    const result = await pool.query("SELECT * FROM tasks WHERE user_id = $1", [id]);
    res.status(200).json(result.rows);
}

async function updateTaskDone(req: Request, res: Response) {
    const id = parseId(req.params.id);
    if (id === null) { 
        invalidReq(res); 
        return; 
    }
    const result = await pool.query(`UPDATE tasks 
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
    const result = await pool.query(`DELETE  
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
    res.status(400).json({
        error: {
            code: "bad_req",
            message: "Invalid Request",
        },
    });
    return;
}

function nonExistentId(res: Response) {
    res.status(404).json({
        error: {
            code: "not_found",
            message: "Id not found",
        },
    });
    return;
}

function parseId(raw: unknown): number | null {
    if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
}

export {createTask, createUser, getTask, getTasksByUserId, updateTaskDone, deleteTask};