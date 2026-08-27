import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { tasks } from "./schema.js";
import type { Request, Response } from "express";

async function createTask(req: Request, res: Response) {

}

async function getTask(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { 
        invalidId(res); 
        return; 
    }
    const row = await db.select().from(tasks).where(eq(tasks.id, id));
    if (row[0] === undefined) {
        invalidId(res);
        return;
    }

    res.status(200).json(row[0]);
}

async function getTasks(req: Request, res: Response) {

}

async function updateTask(req: Request, res: Response) {

}

async function deleteTask(req: Request, res: Response) {

}

function invalidId(res: Response) {
    res.status(404).json({
        error: {
            code: "not_found",
            message: "Invalid id",
        },
    });
    return;
}

export {createTask, getTask, getTasks, updateTask, deleteTask};