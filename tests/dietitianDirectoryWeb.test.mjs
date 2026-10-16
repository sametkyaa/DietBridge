import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSocialLinks, validateSocialLink, validateSocialLinks } from '../features/inquiries/utils/socialLinks.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('social links accept https links on the expected hosts only', () => {
  assert.equal(validateSocialLink('instagram', 'https://www.instagram.com/diyetisyen'), null);
  assert.equal(validateSocialLink('x', 'https://twitter.com/diyetisyen'), null);
  assert.equal(validateSocialLink('website', 'https://ornek.com.tr'), null);
  assert.equal(validateSocialLink('instagram', ''), null);
  assert.ok(validateSocialLink('instagram', 'http://instagram.com/a'));
  assert.ok(validateSocialLink('instagram', 'https://evil.com/instagram.com'));
  assert.ok(validateSocialLink('linkedin', 'javascript:alert(1)'));
  assert.ok(validateSocialLink('website', `https://ornek.com/${'a'.repeat(200)}`));
  assert.deepEqual(Object.keys(validateSocialLinks({ tiktok: 'https://youtube.com/x', youtube: 'https://youtu.be/x' })), ['tiktok']);
});

test('social links are normalized to known, non-empty keys', () => {
  assert.deepEqual(normalizeSocialLinks(null), {});
  assert.deepEqual(normalizeSocialLinks(['https://x.com/a']), {});
  assert.deepEqual(
    normalizeSocialLinks({ instagram: ' https://instagram.com/a ', website: '', other: 'https://a.com', x: 5 }),
    { instagram: 'https://instagram.com/a' },
  );
});

test('directory fields are only sent when the loaded profile has them', () => {
  const service = read('features/dietitians/services/dietitianService.ts');
  assert.match(service, /'is_publicly_listed' in data/);
  assert.match(service, /updates\.is_publicly_listed !== undefined/);
  const edit = read('features/dietitians/pages/EditProfilePage.tsx');
  assert.match(edit, /supportsDirectory = profile\?\.is_publicly_listed !== undefined/);
  assert.match(edit, /canBeListed = profile\?\.verification_status === 'approved'/);
});

test('inquiry data access stays in the feature service and uses RPCs', () => {
  const service = read('features/inquiries/services/inquiryService.ts');
  for (const rpc of ['list_my_dietitian_inquiries', 'send_dietitian_inquiry_message', 'close_dietitian_inquiry', 'mark_dietitian_inquiry_read', 'list_my_dietitian_connection_requests', 'respond_dietitian_connection_request']) {
    assert.ok(service.includes(`'${rpc}'`), rpc);
  }
  assert.doesNotMatch(read('features/inquiries/pages/InquiriesPage.tsx'), /supabase/);
  assert.doesNotMatch(read('features/inquiries/hooks/useInquiries.ts'), /from\(['"]/);
});

test('inquiries page is routed and listed next to messages', () => {
  assert.match(read('App.tsx'), /path="\/inquiries" element={<InquiriesPage \/>}/);
  const sidebar = read('shared/components/Sidebar.tsx');
  assert.match(sidebar, /label: 'Ön görüşmeler', path: '\/inquiries'/);
  assert.match(sidebar, /byPath\('\/messages'\), byPath\('\/inquiries'\)/);
});
