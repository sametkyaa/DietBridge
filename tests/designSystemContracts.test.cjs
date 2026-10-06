'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const sourceFiles = (directory) => {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
};

const activeSources = ['index.tsx', 'App.tsx', ...['features', 'pages', 'shared', 'lib'].flatMap(sourceFiles)];

test('the removed root components/ folder stays deleted and nothing imports from it', () => {
  assert.equal(fs.existsSync(path.join(root, 'components')), false);
  for (const file of activeSources) {
    const source = read(file);
    for (const match of source.matchAll(/from\s+['"]((?:\.\.?\/)+components\/[^'"]+)['"]/g)) {
      const resolved = path.resolve(path.dirname(path.join(root, file)), match[1]);
      assert.notEqual(
        path.relative(root, resolved).split(path.sep)[0],
        'components',
        `${file} imports from the removed root components/ folder: ${match[1]}`,
      );
    }
  }
});

test('shared UI kit exports the Faz 1 components from one barrel', () => {
  const barrel = read('shared/ui/index.ts');
  for (const name of [
    'Icon', 'Button', 'IconButton', 'LinkButton', 'Card', 'CardHeader', 'KpiTile', 'KpiGrid', 'Badge', 'Chip', 'Tag',
    'CountPill', 'Tabs', 'TabPanel', 'SegmentedControl', 'PillGroup', 'Table', 'TableCard', 'Th', 'Td', 'PersonCell',
    'Pagination', 'EmptyState', 'ErrorState', 'LoadingState', 'Skeleton', 'Callout', 'ProgressBar', 'Modal',
    'ConfirmDialog', 'Drawer', 'Input', 'SearchInput', 'Select', 'Textarea', 'Checkbox', 'Toggle', 'RadioCards',
    'Avatar', 'PageHeader', 'PageContainer',
  ]) {
    assert.match(barrel, new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\} from`), `missing export: ${name}`);
  }
});

test('icons are local prototype SVG paths, not a new icon package', () => {
  const pkg = JSON.parse(read('package.json'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.equal(deps.some((name) => /phosphor/i.test(name)), false);
  const icon = read('shared/ui/Icon.tsx');
  assert.doesNotMatch(icon, /from ['"](?!react['"]|\.\/)/);
  const paths = read('shared/ui/iconPaths.ts');
  for (const name of ['house', 'calendar-blank', 'chat-circle', 'users', 'fork-knife', 'chart-bar', 'calendar-dots', 'bowl-food', 'note-pencil', 'gear', 'bell', 'magnifying-glass', 'x', 'caret-down']) {
    assert.match(paths, new RegExp(`'${name}': \\[`), `missing icon: ${name}`);
  }
});

test('modal keeps dialog semantics, focus trap and Escape handling', () => {
  const modal = read('shared/ui/Modal.tsx');
  const behavior = read('shared/ui/useDialogBehavior.ts');
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby=\{titleId\}/);
  assert.match(modal, /createPortal/);
  assert.match(behavior, /event\.key === 'Escape'/);
  assert.match(behavior, /event\.key !== 'Tab'/);
  assert.match(behavior, /previouslyFocused\.focus/);
});

test('shell keeps every route, Panelim label, grouped navigation and admin entitlement', () => {
  const app = read('App.tsx');
  const sidebar = read('shared/components/Sidebar.tsx');
  const layout = read('shared/components/DashboardLayout.tsx');
  for (const route of ['/', '/appointments', '/clients', '/clients/:id', '/clients/:id/meal-tracking', '/meal-tracking', '/analytics', '/meal-plans', '/messages', '/notes', '/recipes', '/recipes/:id', '/settings', '/profile', '/profile/edit', '/admin', '/admin/dietitians', '/admin/dietitians/:id']) {
    assert.match(app, new RegExp(`path="${route.replace(/[/:]/g, (c) => `\\${c}`)}"`), `missing route ${route}`);
  }
  const order = ['Panelim', 'Randevular', 'Mesajlar', 'Danışanlar', 'Öğün takibi', 'Analizler', 'Beslenme planı', 'Tarifler', 'Notlar', 'Ayarlar'];
  let cursor = -1;
  for (const label of order) {
    const index = sidebar.indexOf(`label: '${label}'`);
    assert.ok(index > cursor, `nav label out of order or missing: ${label}`);
    cursor = index;
  }
  assert.match(sidebar, /title: 'Danışan yönetimi'/);
  assert.match(sidebar, /title: 'Kaynaklar'/);
  assert.match(sidebar, /title: 'Hesap'/);
  assert.match(sidebar, /APP_LOGO_MARK/);
  assert.match(sidebar, /to="\/profile"/);
  assert.match(sidebar, /adminAccess\.status === 'authorized'/);
  assert.match(read('shared/constants.ts'), /APP_LOGO_MARK = "\/images\/dietbridge-logo-seffaf\.png"/);
  assert.ok(fs.existsSync(path.join(root, 'public/images/dietbridge-logo-seffaf.png')));
  assert.match(layout, /<NotificationDrawer \/>/);
  assert.match(layout, /<Outlet \/>/);
});
