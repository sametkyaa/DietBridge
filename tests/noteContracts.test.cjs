'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');
const contract = require(path.join(buildDir, 'features', 'notes', 'utils', 'noteContract.js'));
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const uuid = '11111111-1111-4111-8111-111111111111';

test('note draft validation normalizes required and optional fields', () => {
  assert.deepEqual(contract.validateNoteDraft({ clientId: uuid, title: ' Başlık ', content: ' İçerik ' }), {
    success: true, value: { clientId: uuid, title: 'Başlık', content: 'İçerik' },
  });
  assert.equal(contract.validateNoteDraft({ clientId: null, title: 'Genel', content: 'Not' }).success, true);
  for (const draft of [
    { clientId: 'bad', title: 'Başlık', content: 'İçerik' },
    { clientId: null, title: ' ', content: 'İçerik' },
    { clientId: null, title: 'x'.repeat(161), content: 'İçerik' },
    { clientId: null, title: 'Başlık', content: ' ' },
    { clientId: null, title: 'Başlık', content: 'x'.repeat(10001) },
  ]) assert.equal(contract.validateNoteDraft(draft).success, false);
});

test('note dates render in the Europe/Istanbul product timezone', () => {
  const formatted = contract.formatNoteDate('2026-08-12T21:30:00.000Z');
  assert.match(formatted, /13.*Ağu.*2026.*00:30|13.*08.*2026.*00:30/u);
});

test('note service is authenticated, owner-scoped and rejects fake mutation success', () => {
  const source = read('features/notes/services/noteService.ts');
  assert.doesNotMatch(source, /INITIAL_NOTES|Date\.now|localStorage|sessionStorage|mock/iu);
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.ok((source.match(/\.from\('dietitian_notes'\)/g) || []).length >= 4);
  assert.ok((source.match(/\.eq\('dietitian_id', dietitianId\)/g) || []).length >= 4);
  assert.match(source, /\.from\('dietitian_clients'\)[\s\S]*\.eq\('status', 'active'\)[\s\S]*\.maybeSingle\(\)/);
  assert.match(source, /fetchNoteClientOptions[\s\S]*\.select\('client:client_id \(id, full_name\)'\)/);
  assert.doesNotMatch(source, /client_profiles|medical|medication|email|avatar_url/iu);
  assert.match(source, /\.insert\([\s\S]*\.select\(NOTE_SELECT\)\.maybeSingle\(\)/);
  assert.match(source, /assertPersisted\(note, validation\.value\)/);
  assert.match(source, /\.delete\(\)[\s\S]*\.select\('id, dietitian_id'\)\.maybeSingle\(\)/);
  assert.match(source, /deleted\?\.id !== id \|\| deleted\.dietitian_id !== dietitianId/);
});

test('note hook protects stale reads, serializes mutations and reconciles backend truth', () => {
  const source = read('features/notes/hooks/useNotes.ts');
  assert.match(source, /const requestId = \+\+requestVersion\.current/);
  assert.match(source, /requestId !== requestVersion\.current/);
  assert.match(source, /if \(!allowed \|\| pendingRef\.current\)/);
  assert.match(source, /const refreshSucceeded = await refreshNotes\(\)/);
  assert.doesNotMatch(source, /setNotes|\.\.\.prev|localStorage|sessionStorage/);
});

test('migration creates private owner-only notes with active-client enforcement', () => {
  const source = read('supabase/migrations/20260813120000_create_persistent_dietitian_notes.sql');
  assert.match(source, /create table public\.dietitian_notes/i);
  for (const field of ['id', 'dietitian_id', 'client_id', 'title', 'content', 'created_at', 'updated_at']) {
    assert.match(source, new RegExp(`\\b${field}\\b`, 'i'));
  }
  assert.match(source, /alter table public\.dietitian_notes enable row level security/i);
  assert.equal((source.match(/create policy /gi) || []).length, 4);
  assert.ok((source.match(/is_current_user_dietitian\(\)/gi) || []).length >= 4);
  assert.match(source, /dc\.status = 'active'::public\.client_status/i);
  assert.match(source, /create policy "Approved dietitians can update own notes"[\s\S]*with check[\s\S]*dc\.status = 'active'::public\.client_status/i);
  assert.match(source, /new\.dietitian_id is distinct from old\.dietitian_id/i);
  assert.match(source, /revoke all privileges on table public\.dietitian_notes from public, anon, authenticated/i);
  assert.doesNotMatch(source, /insert into public\.dietitian_notes/i);
});

test('Notes route and navigation restore the protected real feature', () => {
  const app = read('App.tsx');
  const sidebar = read('shared/components/Sidebar.tsx');
  assert.match(app, /import NotesPage from '.\/features\/notes\/pages\/NotesPage'/);
  assert.match(app, /<Route path="\/notes" element=\{<NotesPage \/>\} \/>/);
  assert.match(sidebar, /label: 'Notlar', path: '\/notes'/);
});

test('Notes page covers loading, empty, error retry, CRUD, confirmation and persisted refetch', () => {
  const source = read('features/notes/pages/NotesPage.tsx');
  assert.match(source, /viewState\.status === 'loading'/);
  assert.match(source, /viewState\.status === 'error'[\s\S]*refreshNotes/);
  assert.match(source, /filtered\.length === 0/);
  assert.match(source, /await createNote\(validation\.value\)/);
  assert.match(source, /await updateNote\(selected\.id, validation\.value\)/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /await deleteNote\(note\.id\)/);
  assert.match(source, /formatNoteDate\(note\.updatedAt\)/);
  assert.doesNotMatch(source, /INITIAL_NOTES|\bCLIENTS\b|Date\.now|localStorage|sessionStorage|mock/u);
});

test('production-reachable Notes code contains no seeded or local persistence fallback', () => {
  const files = [
    'features/notes/pages/NotesPage.tsx', 'features/notes/hooks/useNotes.ts',
    'features/notes/services/noteService.ts', 'features/notes/types/note.ts',
    'features/notes/utils/noteContract.ts',
  ];
  for (const file of files) assert.doesNotMatch(read(file), /INITIAL_NOTES|hardcoded note|sample note|localStorage|sessionStorage|demo note|fake success/iu);
});

test('Notes runtime harness is loopback-only, compiles the real service and cleans residue', () => {
  const source = read('scripts/runDisposableNoteRuntimeHarness.mjs');
  assert.match(source, /127\.0\.0\.1|localhost/);
  assert.match(source, /features\/notes\/services\/noteService\.ts/);
  assert.match(source, /createNote/);
  assert.match(source, /updateNote/);
  assert.match(source, /deleteNote/);
  assert.match(source, /NOTE_RUNTIME_MATRIX_PASS/);
  assert.match(source, /TEMPORARY_NOTES_ZERO/);
  assert.match(source, /TEMPORARY_AUTH_USERS_ZERO/);
  assert.match(source, /DISPOSABLE_DOCKER_RESIDUE_ZERO/);
  assert.match(source, /process\.once\('SIGINT'/);
  assert.match(source, /process\.once\('SIGTERM'/);
  assert.match(source, /stopExactDisposableStack/);
  assert.match(source, /NOTES_BROWSER_E2E/);
  assert.match(source, /BROWSER_ACCEPTANCE_READY/);
});
