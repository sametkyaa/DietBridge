import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {inviteDomainAssociations} from '../scripts/createInviteDomainAssociations.mjs';
import { inviteUrl, inviteWhatsAppUrl, normalizeInviteCode, resolveClientInviteMode } from '../features/clients/utils/inviteCode.ts';
const code='DB-ABCD-2345-EFGH-6789';
test('invite flag fails closed to the legacy production behavior',()=>{
  for(const value of [undefined,'','invalid','legacy_email']) assert.equal(resolveClientInviteMode(value),'legacy_email');
  assert.equal(resolveClientInviteMode('invite_code'),'invite_code');
});
test('sharing uses canonical HTTPS URL and a plain Turkish message',()=>{
  const url=inviteUrl(code); assert.equal(url,'https://app.dietbridge.com.tr/davet/DBABCD2345EFGH6789');
  const whatsapp=new URL(inviteWhatsAppUrl(code)); assert.equal(whatsapp.origin,'https://wa.me');
  assert.ok(whatsapp.searchParams.get('text').includes(code)); assert.ok(whatsapp.searchParams.get('text').includes(url));
  assert.equal(normalizeInviteCode(code.toLowerCase()),'DBABCD2345EFGH6789');
  assert.throws(()=>inviteUrl('../../invalid'));
});
test('QR encodes exactly the HTTPS invite URL and generates downloadable PNG',async()=>{
  const url=inviteUrl(code);
  const qr=QRCode.create(url);
  assert.equal(qr.segments.map(segment=>typeof segment.data==='string'?segment.data:Buffer.from(segment.data).toString()).join(''),url);
  assert.match(await QRCode.toDataURL(url,{width:512,margin:4}),/^data:image\/png;base64,/);
});
test('domain association generator requires actual values and confines routes to invites',()=>{
  assert.throws(()=>inviteDomainAssociations({androidFingerprints:[],appleTeamId:''}));
  const value=inviteDomainAssociations({androidFingerprints:[Array.from({length:32},()=> 'AA').join(':')],appleTeamId:'TESTONLY12'});
  assert.equal(value.android[0].target.package_name,'com.dietbridge.app');assert.equal(value.apple.applinks.details[0].appID,'TESTONLY12.com.dietbridge.app');assert.deepEqual(value.apple.applinks.details[0].paths,['/davet/*']);
});
