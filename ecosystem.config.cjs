module.exports = {
  apps: [
    {
      name: 'blather-api',
      script: 'packages/api/dist/index.js',
      cwd: '/home/code/blather',
      env: {
        RESEND_API_KEY: 'REDACTED_RESEND_KEY',
        RESEND_FROM: 'Blather <admin@pbd.bot>',
        OPENAI_API_KEY: 'REDACTED_OPENAI_KEY',
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
