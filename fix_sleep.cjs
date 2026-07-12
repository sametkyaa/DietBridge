const fs = require('fs');
const file = 'pages/ClientDetails.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /\{client\.sleepHours \? \`\$\{client\.sleepHours\} Saat\` : '-'\}/g,
  "{client.sleepHours !== undefined && client.sleepHours !== null ? `${client.sleepHours} Saat` : '-'}"
);

fs.writeFileSync(file, code);
