const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const registerPage = fs.readFileSync(
  path.join(repoRoot, 'features', 'auth', 'pages', 'RegisterPage.tsx'),
  'utf8',
);

const termsLinkMatch = registerPage.match(
  /<a\b(?=[^>]*\bhref="([^"]+)")(?=[^>]*\btarget="([^"]+)")(?=[^>]*\brel="([^"]+)")[^>]*>Kullanım Koşulları<\/a>/u,
);

test('registration terms link targets the public terms page in a secure new tab', () => {
  assert.ok(termsLinkMatch, 'the registration page must contain the Kullanım Koşulları link contract');

  const [, href, target, rel] = termsLinkMatch;
  assert.notEqual(href, '#');
  assert.equal(href, 'https://dietbridge.com.tr/kullanim-kosullari');
  assert.equal(target, '_blank');

  const relTokens = rel.split(/\s+/u);
  assert.equal(relTokens.includes('noopener'), true);
  assert.equal(relTokens.includes('noreferrer'), true);
});
