'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('MVP-9 legacy local Notes mock remains absent from the active route chain', () => {
  const app = read('App.tsx');
  const sidebar = read('shared/components/Sidebar.tsx');
  assert.doesNotMatch(app, /from ['"]\.\/pages\/Notes['"]/);
  assert.match(app, /features\/notes\/pages\/NotesPage/);
  assert.match(sidebar, /Notlar|\/notes/);
});

test('MVP-9 recipe detail is authenticated and owner-scoped', () => {
  const service = read('features/recipes/services/recipeService.ts');
  const detail = read('pages/RecipeDetails.tsx');
  assert.match(service, /export const fetchRecipe/);
  assert.match(service, /assertAuthenticatedDietitianId\(\)/);
  assert.match(service, /\.eq\('id', recipeId\)/);
  assert.match(service, /\.eq\('dietitian_id', dietitianId\)/);
  assert.match(detail, /fetchRecipe\(id\)/);
  assert.doesNotMatch(detail, /RECIPES|images\.unsplash\.com/);
});

test('MVP-9 Settings contains only real profile navigation and subscription state', () => {
  const source = read('features/settings/pages/SettingsPage.tsx');
  assert.match(source, /SubscriptionPanel/);
  assert.match(source, /navigate\('\/profile'\)/);
  assert.doesNotMatch(source, /Mock|Simulate API|setTimeout|Bağlandı|toggles|twoFactor|emailNotif|smsNotif|marketing/iu);
});

test('MVP-9 active environment contract has no mock-data switch', () => {
  assert.doesNotMatch(read('lib/env.ts'), /enableMockData|VITE_ENABLE_MOCK_DATA/);
  assert.doesNotMatch(read('vite-env.d.ts'), /VITE_ENABLE_MOCK_DATA/);
  assert.doesNotMatch(read('.env.example'), /VITE_ENABLE_MOCK_DATA/);
});

test('MVP-9 meal-plan selection cache is scoped UI preference, not record truth', () => {
  const source = read('pages/MealPlans.tsx');
  assert.match(source, /dietbridge:meal-plans:last-client:\$\{dietitianId\}/);
  assert.match(source, /activeClients\.find\(\(client\) => client\.id === preferredId\)/);
  assert.match(source, /fetchWeeklyMealPlan\(/);
  assert.doesNotMatch(source, /setWeeklyPlan\(.*storedClientId/);
});
