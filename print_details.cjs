const fs = require('fs');
const content = fs.readFileSync('pages/ClientDetails.tsx', 'utf8');
console.log(content.slice(0, 1500));
