const fs = require('fs');
const file = 'pages/ClientDetails.tsx';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('profileImageError')) {
  // Add state
  code = code.replace(
    /const \[isRemoving, setIsRemoving\] = useState\(false\);/,
    "const [isRemoving, setIsRemoving] = useState(false);\n  const [profileImageError, setProfileImageError] = useState(false);"
  );

  // Add useEffect to reset error
  code = code.replace(
    /useEffect\(\(\) => {\n    loadData\(\);/,
    "useEffect(() => {\n    setProfileImageError(false);\n  }, [client?.id, client?.avatar]);\n\n  useEffect(() => {\n    loadData();"
  );

  // Add Fallback Component
  const fallbackComp = `
const ProfileAvatarFallback = ({ name, className }: { name: string, className?: string }) => {
  const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  return (
    <div className={\`flex items-center justify-center bg-slate-200 text-slate-500 font-bold \${className}\`}>
      {initials}
    </div>
  );
};
`;
  code = code.replace(/const ClientDetails = \(\) => {/, fallbackComp + "\nconst ClientDetails = () => {");

  // Replace grayscale image (isRemoving)
  code = code.replace(
    /<img src={client\.avatar} alt={client\.name} className="w-32 h-32 rounded-full object-cover border-4 border-slate-100 shadow-sm opacity-60 grayscale" \/>/,
    `{!profileImageError ? (
                    <img 
                      src={client.avatar} 
                      alt="" 
                      className="w-32 h-32 rounded-full object-cover border-4 border-slate-100 shadow-sm opacity-60 grayscale" 
                      onError={() => setProfileImageError(true)}
                    />
                  ) : (
                    <ProfileAvatarFallback name={client.name} className="w-32 h-32 rounded-full border-4 border-slate-100 shadow-sm opacity-60 grayscale text-3xl" />
                  )}`
  );

  // Replace real image
  code = code.replace(
    /<img src={client\.avatar} alt={client\.name} className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-md" \/>/,
    `{!profileImageError ? (
                  <img 
                    src={client.avatar} 
                    alt="" 
                    className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-md" 
                    onError={() => setProfileImageError(true)}
                  />
                ) : (
                  <ProfileAvatarFallback name={client.name} className="w-32 h-32 rounded-full border-4 border-white shadow-md text-3xl" />
                )}`
  );

  fs.writeFileSync(file, code);
}
