import type { ImportLimits } from './recipeFiles.ts';
import type { ImportItem } from './recipeSpreadsheet.ts';
export interface RecipeExtractionInput { bytes:Uint8Array;mime:string;extension:string;jobId:string;limits:ImportLimits }
export interface RecipeExtractionMetrics { model:string;inputTokens?:number;outputTokens?:number;attemptCount:number;durationMs:number }
export interface RecipeExtractionResult { items:ImportItem[];metrics:RecipeExtractionMetrics }
export interface RecipeExtractionProvider { extract(input:RecipeExtractionInput):Promise<RecipeExtractionResult> }
