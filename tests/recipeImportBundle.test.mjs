// Run after npm run build; intentionally not part of pre-build unit tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
test('production client assets have no provider endpoint, API key config or server adapter',()=>{
  const assets=readdirSync(new URL('../dist/assets/',import.meta.url)).filter(name=>name.endsWith('.js'));assert.ok(assets.length);
  for(const name of assets){const content=readFileSync(new URL(`../dist/assets/${name}`,import.meta.url),'utf8');assert.ok(!content.includes('api.openai.com/v1/responses'));assert.ok(!content.includes('OPENAI_API_KEY'));assert.ok(!content.includes('OpenAIRecipeExtractionProvider'));}
});
