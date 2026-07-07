import postgres from "postgres";

import { config } from "../config.js";

export const pg = postgres(config.DATABASE_URL);
