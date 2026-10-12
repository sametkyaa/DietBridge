import { handleValidateChatMediaRequest } from './handler.ts';
Deno.serve((request) => handleValidateChatMediaRequest(request));
