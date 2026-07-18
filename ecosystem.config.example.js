/**
 * PM2 ecosystem config — copy to ecosystem.config.js and adapt paths
 */
module.exports = {
  apps: [
    {
      name: 'nodyx-core',
      script: 'dist/index.js',
      cwd: './nodyx-core',
      watch: false,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'nodyx-frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: 'preview --host',
      cwd: './nodyx-frontend',
      watch: false,
      interpreter: 'node',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'caddy',
      script: '/usr/bin/caddy',           // Linux: /usr/bin/caddy | Windows: C:/caddy/caddy.exe
      args: 'run --config ./Caddyfile.example --adapter caddyfile',
      cwd: './',
      watch: false,
      interpreter: 'none',
    },
  ],
}
