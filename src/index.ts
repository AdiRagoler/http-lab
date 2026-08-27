import express from "express";
import { createTask, getTask, getTasks, updateTask, deleteTask } from "./tasks.js";

const listeningPort = 3003;
const app = express();
app.use(express.json());

app.post('/tasks', createTask);

app.get('/tasks', getTasks);

app.get('/tasks/:id', getTask);

app.put('/tasks/:id', updateTask);

app.delete('/tasks/:id', deleteTask);

app.listen(listeningPort, () => {
  console.log(`listening on port ${listeningPort}`);
});
