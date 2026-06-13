import { App, staticFiles } from "fresh";
import { define, type State } from "./utils.ts";
import { initializeDatabase } from "./db/init.ts";

export const app = new App<State>();

app.use(staticFiles());
app.use(define.middleware((ctx) => ctx.next()));

await initializeDatabase();

app.fsRoutes();
