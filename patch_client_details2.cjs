const fs = require('fs');
const file = 'pages/ClientDetails.tsx';
let code = fs.readFileSync(file, 'utf8');

// Update dependency array for error reset
code = code.replace(/\[client\?\.id, client\?\.avatar\]/g, "[client?.id, client?.profilePhotoUrl]");

// Fix image logic
code = code.replace(
  /\{\!profileImageError \? \(\s*<img\s*src=\{client\.avatar\}\s*alt=""/g,
  "{client.profilePhotoUrl && !profileImageError ? (\n                  <img \n                    src={client.profilePhotoUrl} \n                    alt=\"\""
);

fs.writeFileSync(file, code);
