# vault-env-js
Put your vault secrets in your process.env

Install the package

```console
npm install --save vault-env
```

Add your secrets to `package.json`

```json
{
  "vault-secrets": {
    "DATABASE_URL": "secrets/databases/main:url"
  }
}
```

Require `vault-env` and the environment variables are loaded

```js
require('vault-env')

console.log(process.env.DATABASE_URL)
// => 'postgres://...'
```
