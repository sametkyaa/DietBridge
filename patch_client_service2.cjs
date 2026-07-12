const fs = require('fs');
const file = 'features/clients/services/clientService.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/avatar: resolveProfilePhotoUrl\(client\.avatar_url\) \|\| USER_AVATAR,/g, "avatar: resolveProfilePhotoUrl(client.avatar_url) || USER_AVATAR,\n        profilePhotoUrl: resolveProfilePhotoUrl(client.avatar_url),");

code = code.replace(/avatar: resolveProfilePhotoUrl\(clientData\.avatar_url\) \|\| USER_AVATAR,/g, "avatar: resolveProfilePhotoUrl(clientData.avatar_url) || USER_AVATAR,\n      profilePhotoUrl: resolveProfilePhotoUrl(clientData.avatar_url),");

fs.writeFileSync(file, code);
