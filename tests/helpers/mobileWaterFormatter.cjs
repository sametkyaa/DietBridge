'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual component's formatter without loading a native runtime.
// Only its native imports are stubbed; the formatter implementation is unchanged.
module.exports = (mobileRepoRoot) => {
  const source = fs.readFileSync(path.join(mobileRepoRoot,
    'apps/mobile/src/features/clients/components/dashboard/WaterTrackerCard.js'), 'utf8');
  const { outputText } = ts.transpileModule(`${source}\nexport { formatLiters };`, {
    fileName: 'WaterTrackerCard.jsx',
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name) => {
      if (name === 'react-native') return {
        Animated: { createAnimatedComponent: () => null },
        StyleSheet: { create: (styles) => styles },
      };
      if (name.endsWith('/theme')) return { colors: {}, radius: {}, spacing: {}, typography: {} };
      return {};
    },
  }, { timeout: 1000 });
  return { source, formatLiters: module.exports.formatLiters };
};
