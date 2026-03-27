const { readFileSync } = require('fs');
const { resolve } = require('path');

// Load .env file
const envFile = resolve(__dirname, '.env');
const envVars = {};
try {
  readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) envVars[match[1].trim()] = match[2].trim();
  });
} catch {}

module.exports = {
  apps: [
    {
      name: 'blather-api',
      script: 'packages/api/dist/index.js',
      cwd: '/home/code/blather',
      env: {
        ...envVars,
      },
    },
    {
      name: 'blather-web',
      script: 'node_modules/.bin/serve',
      args: 'packages/web/dist -l 8080 -s',
      cwd: '/home/code/blather',
    },
  ],
};
