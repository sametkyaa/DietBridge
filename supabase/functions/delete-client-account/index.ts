import { handleDeleteClientAccountRequest } from "./handler.ts";

Deno.serve((request) => handleDeleteClientAccountRequest(request));
