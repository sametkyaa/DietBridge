const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('dietitian registration treats KVKK as information, not blanket consent', () => {
  const source = fs.readFileSync(path.join(__dirname, '../features/auth/pages/RegisterPage.tsx'), 'utf8');
  assert.match(source, /KVKK Aydınlatma Metni<\/a>'ni okudum ve kişisel verilerimin işlenmesi hakkında bilgilendirildim\./);
  assert.doesNotMatch(source, /kişisel verilerimin işlenmesini kabul ediyorum/);
  assert.match(source, /termsAccepted: formData\.isConfirmed/);
  assert.match(source, /kvkkAccepted: formData\.kvkkAccepted/);
});
