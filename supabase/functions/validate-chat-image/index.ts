import { handleValidateChatImageRequest } from "./handler.ts";

Deno.serve((request) => handleValidateChatImageRequest(request));
