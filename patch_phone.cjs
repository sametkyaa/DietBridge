const fs = require('fs');
const fileService = 'features/clients/services/clientService.ts';
let codeS = fs.readFileSync(fileService, 'utf8');

codeS = codeS.replace(
  /select\('id, full_name, avatar_url, email'\)/,
  "select('id, full_name, avatar_url, email, phone')"
);

codeS = codeS.replace(
  /email: clientData\.email \|\| '',/,
  "email: clientData.email || '',\n      phone: clientData.phone || '',"
);

fs.writeFileSync(fileService, codeS);

const fileClient = 'pages/ClientDetails.tsx';
let codeC = fs.readFileSync(fileClient, 'utf8');

codeC = codeC.replace(
  /<div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">\s*<Phone className="w-4 h-4 text-slate-400" \/>\s*\+90 555 123 45 67\s*<\/div>/,
  `{client.phone && (<div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Phone className="w-4 h-4 text-slate-400" />
                        {client.phone}
                    </div>)}`
);

fs.writeFileSync(fileClient, codeC);
