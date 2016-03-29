# vault-env-js
Put your [vault](https://www.vaultproject.io/) secrets in your [process.env](https://nodejs.org/api/process.html#process_process_env)

![vault-env demo](https://i.imgur.com/W7cyRiP.gif)

Install the package

```console
npm install --save vault-env
```

Write a `Secretfile` in your app directory

```
DATABASE_URL secrets/databases/main:url
```

Require `vault-env` and the environment variables are loaded

```js
require('vault-env')

console.log(process.env.DATABASE_URL)
// => 'postgres://...'
```

Provide your app with `VAULT_ADDR` and `VAULT_TOKEN` environment variables when
you run it.

```console
VAULT_ADDR=https://localhost:8200 VAULT_TOKEN=12345 node ./app.js
```

Require `vault-env/rotate` and vault-env will request new leases before your
secrets expire, keeping your environment variables up to date forever.

```js
require('vault-env/rotate')

// check the database url
console.log(process.env.DATABASE_URL)
// => 'postgres://username:password@host/db'

// check again in six weeks
setTimeout(function () {
  console.log(process.env.DATABASE_URL)
  // => 'postgres://user:newpassword@host/db'
}, 1000 * 60 * 60 * 24 * 7 * 6)
```

You can also watch for secret changes

```js
var vaultEnv = require('vault-env/rotate')

vaultEnv.on('DATABASE_URL', function (newDB, oldDB) {
  console.log('DATABASE_URL has changed to ' + newDB + ' from ' + oldDB)
})
```
