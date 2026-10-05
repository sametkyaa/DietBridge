// Prepare hosting files using actual signing identities. Does not deploy.
import { mkdirSync,writeFileSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function inviteDomainAssociations({androidFingerprints,appleTeamId}) {
  if(!Array.isArray(androidFingerprints)||!androidFingerprints.length||androidFingerprints.some(value=>typeof value!=='string'||!/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/i.test(value)))throw new Error('Real Android SHA-256 signing fingerprints required');
  if(typeof appleTeamId!=='string'||!(/^[A-Z0-9]{10}$/).test(appleTeamId))throw new Error('Real Apple Team ID required');
  return {
    android:[{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:'com.dietbridge.app',sha256_cert_fingerprints:androidFingerprints.map(value=>value.toUpperCase())}}],
    apple:{applinks:{apps:[],details:[{appID:`${appleTeamId}.com.dietbridge.app`,paths:['/davet/*']}]}}
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const fingerprints=process.argv.find(value=>value.startsWith('--android-sha256='))?.split('=').slice(1).join('=').split(',');
  const team=process.argv.find(value=>value.startsWith('--apple-team-id='))?.split('=')[1];
  const values=inviteDomainAssociations({androidFingerprints:fingerprints,appleTeamId:team});
  const output=join(resolve(dirname(fileURLToPath(import.meta.url)),'..'),'public','.well-known');mkdirSync(output,{recursive:true});
  writeFileSync(join(output,'assetlinks.json'),JSON.stringify(values.android,null,2)+'\n');
  writeFileSync(join(output,'apple-app-site-association'),JSON.stringify(values.apple,null,2)+'\n');
  process.stdout.write('Prepared domain association files from supplied real identities. Deployment not performed.\n');
}
