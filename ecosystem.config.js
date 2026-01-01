module.exports = {
  apps: [
    {
      name: 'kenmei-api',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'kenmei-workers',
      script: 'npx',
      args: 'tsx src/workers/index.ts',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
