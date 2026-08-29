const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const headerRule = config.headers?.find((rule) => rule.source === '/(.*)');
const headers = new Map((headerRule?.headers ?? []).map(({ key, value }) => [key, value]));
const csp = headers.get('Content-Security-Policy') ?? '';
const cspDirective = (name) => csp
  .split(';')
  .map((directive) => directive.trim())
  .find((directive) => directive.startsWith(`${name} `)) ?? '';

test('vercel.json is valid JSON and keeps the canonical SPA rewrite', () => {
  assert.deepEqual(config.rewrites, [
    { source: '/(.*)', destination: '/index.html' },
  ]);
});

test('security headers use one global matcher', () => {
  assert.equal(config.headers?.length, 1);
  assert.equal(headerRule?.source, '/(.*)');
});

test('Content-Security-Policy is present', () => {
  assert.ok(csp);
});

test('CSP has a same-origin default policy', () => {
  assert.equal(cspDirective('default-src'), "default-src 'self'");
});

test('CSP script policy is same-origin only', () => {
  const scriptSrc = cspDirective('script-src');
  assert.match(scriptSrc, /'self'/);
  assert.equal(scriptSrc, "script-src 'self'");
});

test('CSP script policy contains no Tailwind CDN, hashes, unsafe-eval, or unsafe-inline', () => {
  const scriptSrc = cspDirective('script-src');
  assert.doesNotMatch(scriptSrc, /cdn\.tailwindcss\.com/);
  assert.doesNotMatch(scriptSrc, /sha256-/);
  assert.doesNotMatch(scriptSrc, /'unsafe-eval'/);
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
});

test('CSP script policy contains no wildcard source', () => {
  assert.equal(cspDirective('script-src').includes('*'), false);
});

test('production entry HTML has no inline script or stale importmap dependency', () => {
  assert.doesNotMatch(indexHtml, /<script\s*(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/i);
  assert.doesNotMatch(indexHtml, /aistudiocdn\.com/i);
  assert.doesNotMatch(indexHtml, /tailwind\.config\s*=/i);
  assert.doesNotMatch(indexHtml, /cdn\.tailwindcss\.com/i);
});

test('production entry HTML keeps the normal Vite module entrypoint', () => {
  assert.match(indexHtml, /<script\s+type="module"\s+src="\/index\.tsx"\s*><\/script>/i);
});

test('CSP explicitly allows the canonical Supabase HTTPS API origin', () => {
  assert.match(cspDirective('connect-src'), /https:\/\/kagvxhyvxxypspdxcuxz\.supabase\.co/);
});

test('CSP explicitly allows the canonical Supabase Realtime WSS origin', () => {
  assert.match(cspDirective('connect-src'), /wss:\/\/kagvxhyvxxypspdxcuxz\.supabase\.co/);
});

test('CSP connect policy has no broad wildcard', () => {
  assert.equal(cspDirective('connect-src').includes('*'), false);
});

test('CSP has no insecure HTTP source or wildcard expression anywhere', () => {
  assert.equal(csp.includes('*'), false);
  assert.doesNotMatch(csp, /\bhttp:\/\//i);
  assert.doesNotMatch(csp, /\bhttps:\s*;/i);
});

test('CSP image policy allows same-origin, data, and blob images', () => {
  const imgSrc = cspDirective('img-src');
  assert.match(imgSrc, /'self'/);
  assert.match(imgSrc, /\bdata:/);
  assert.match(imgSrc, /\bblob:/);
});

test('CSP image policy allows exact Supabase Storage and avatar hosts', () => {
  const imgSrc = cspDirective('img-src');
  assert.match(imgSrc, /https:\/\/kagvxhyvxxypspdxcuxz\.supabase\.co/);
  assert.match(imgSrc, /https:\/\/lh3\.googleusercontent\.com/);
});

test('Supabase is not enabled as a script, stylesheet, or font source', () => {
  for (const directive of ['script-src', 'style-src', 'font-src']) {
    assert.equal(cspDirective(directive).includes('kagvxhyvxxypspdxcuxz.supabase.co'), false);
  }
});

test('CSP image policy preserves the validated legacy meal-photo host', () => {
  assert.match(cspDirective('img-src'), /https:\/\/images\.unsplash\.com/);
});

test('CSP styles allow the active inline style attributes and Google Fonts CSS', () => {
  const styleSrc = cspDirective('style-src');
  assert.match(styleSrc, /'self'/);
  assert.match(styleSrc, /'unsafe-inline'/);
  assert.match(styleSrc, /https:\/\/fonts\.googleapis\.com/);
});

test('CSP fonts allow same-origin and Google Fonts font files', () => {
  const fontSrc = cspDirective('font-src');
  assert.match(fontSrc, /'self'/);
  assert.match(fontSrc, /https:\/\/fonts\.gstatic\.com/);
});

test('Google Fonts origins are limited to stylesheet and font directives', () => {
  assert.match(cspDirective('style-src'), /https:\/\/fonts\.googleapis\.com/);
  assert.match(cspDirective('font-src'), /https:\/\/fonts\.gstatic\.com/);
  for (const directive of ['script-src', 'connect-src', 'img-src']) {
    assert.doesNotMatch(cspDirective(directive), /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  }
});

test('CSP blocks plugin and embedded-object execution', () => {
  assert.equal(cspDirective('object-src'), "object-src 'none'");
});

test('CSP restricts base URL resolution to the app origin', () => {
  assert.equal(cspDirective('base-uri'), "base-uri 'self'");
});

test('CSP prevents the app from being framed', () => {
  assert.equal(cspDirective('frame-ancestors'), "frame-ancestors 'none'");
});

test('CSP restricts form submissions to the app origin', () => {
  assert.equal(cspDirective('form-action'), "form-action 'self'");
});

test('CSP disables inline event-handler script attributes', () => {
  assert.equal(cspDirective('script-src-attr'), "script-src-attr 'none'");
});

test('X-Content-Type-Options uses nosniff', () => {
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
});

test('Referrer-Policy uses strict-origin-when-cross-origin', () => {
  assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
});

test('X-Frame-Options denies framing', () => {
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
});

test('HSTS has the requested one-year max-age only', () => {
  const hsts = headers.get('Strict-Transport-Security') ?? '';
  assert.equal(hsts, 'max-age=31536000');
  assert.doesNotMatch(hsts, /includeSubDomains/i);
  assert.doesNotMatch(hsts, /preload/i);
});

test('Permissions-Policy disables unused camera, microphone, and location APIs', () => {
  const policy = headers.get('Permissions-Policy') ?? '';
  for (const feature of ['camera', 'microphone', 'geolocation']) {
    assert.match(policy, new RegExp(`${feature}=\\(\\)`));
  }
});

test('Permissions-Policy disables unused payment and USB APIs', () => {
  const policy = headers.get('Permissions-Policy') ?? '';
  assert.match(policy, /payment=\(\)/);
  assert.match(policy, /usb=\(\)/);
});
