const fs = require('fs');
const file = 'shared/types.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/avatar: string;/, "avatar: string;\n  profilePhotoUrl?: string | null;");

fs.writeFileSync(file, code);
