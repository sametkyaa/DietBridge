const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const indexTsx = fs.readFileSync(path.join(repoRoot, 'index.tsx'), 'utf8');
const globalCss = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');
const tailwindConfig = require(path.join(repoRoot, 'tailwind.config.cjs'));

test('package uses the minimum pinned build-time Tailwind toolchain', () => {
  assert.equal(packageJson.devDependencies.tailwindcss, '3.4.17');
  assert.equal(packageJson.devDependencies.postcss, '8.5.26');
  assert.equal(packageJson.devDependencies.autoprefixer, '10.4.20');
});

test('Tailwind content scanning covers active source directories only', () => {
  for (const requiredPath of [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{js,ts,jsx,tsx}',
    './context/**/*.{js,ts,jsx,tsx}',
    './features/**/*.{js,ts,jsx,tsx}',
    './pages/**/*.{js,ts,jsx,tsx}',
    './shared/**/*.{js,ts,jsx,tsx}',
  ]) {
    assert.ok(tailwindConfig.content.includes(requiredPath), `missing content path: ${requiredPath}`);
  }
  assert.equal(tailwindConfig.content.some((entry) => /node_modules|dist/.test(entry)), false);
});

test('CDN theme colors are preserved in the build-time config', () => {
  assert.deepEqual(tailwindConfig.theme.extend.colors, {
    primary: '#10B981',
    'primary-dark': '#059669',
    'diet-green': '#509F42',
    'background-light': '#F8FAFC',
    'card-light': '#FFFFFF',
    'text-main': '#334155',
    'text-muted': '#64748B',
  });
});

test('CDN font families are preserved in the build-time config', () => {
  assert.deepEqual(tailwindConfig.theme.extend.fontFamily, {
    sans: ['Poppins', 'sans-serif'],
    inter: ['Inter', 'sans-serif'],
  });
});

test('global CSS is the Tailwind build entrypoint and retains the scrollbar rules', () => {
  assert.match(globalCss, /@tailwind base;/);
  assert.match(globalCss, /@tailwind components;/);
  assert.match(globalCss, /@tailwind utilities;/);
  assert.match(globalCss, /::-webkit-scrollbar/);
  assert.match(globalCss, /::-webkit-scrollbar-thumb:hover/);
});

test('index.tsx imports the global Tailwind CSS entrypoint', () => {
  assert.match(indexTsx, /import ['"]\.\/styles\.css['"];?/);
});

test('production HTML has no runtime Tailwind, inline config, or importmap', () => {
  assert.doesNotMatch(indexHtml, /cdn\.tailwindcss\.com/i);
  assert.doesNotMatch(indexHtml, /tailwind\.config\s*=/i);
  assert.doesNotMatch(indexHtml, /aistudiocdn\.com/i);
  assert.doesNotMatch(indexHtml, /type="importmap"/i);
});

test('no broad Tailwind safelist is masking missing dynamic class analysis', () => {
  assert.deepEqual(tailwindConfig.safelist ?? [], []);
});
