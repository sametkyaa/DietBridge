const fs = require('fs');
const file = 'pages/ClientDetails.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /table: 'client_profiles', filter: \`client_id=eq\.\$\{id\}\`/g,
  "table: 'client_profiles', filter: \`user_id=eq.\${id}\`"
);

fs.writeFileSync(file, code);
