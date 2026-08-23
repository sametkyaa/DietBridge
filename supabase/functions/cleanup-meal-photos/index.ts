import { handleCleanupRequest } from "./handler.ts";

Deno.serve((request) => handleCleanupRequest(request));
