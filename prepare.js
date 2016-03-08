var findRoot = require('find-root')
var request = require('sync-request')
var readFile = require('fs').readFileSync

function plural (n) {
  return n === 1 ? '' : 's'
}

var ENV_PATTERN = /^[a-z_]+[a-z0-9_]*$/i
var ENV_INTERPOLATE_PATTERN = /@([a-z_]+[a-z0-9_]*)@/gi
var VAULT_PATH_PATTERN = /^([^:]+)(:(.+))?$/

module.exports = function prepare (options) {
  options = options || {}
  var VAULT_ADDR = options.VAULT_ADDR || process.env.VAULT_ADDR || 'http://127.0.0.1:8200'
  var VAULT_TOKEN = options.VAULT_TOKEN || process.env.VAULT_TOKEN
  var VAULT_API_VERSION = options.VAULT_API_VERSION || process.env.VAULT_API_VERSION || 'v1'
  var VAULT_ENV_PATH = options.VAULT_ENV_PATH || process.env.VAULT_ENV_PATH || findRoot(process.cwd()) + '/package.json'
  var envDest = options.dryrun ? {} : process.env

  var originalSecrets = JSON.parse(readFile(VAULT_ENV_PATH))['vault-secrets'] || {}

  var invalidKeys = []
  var missingEnvVars = []
  var missingColons = []
  var secrets = {}
  Object.keys(originalSecrets).forEach(function (key) {
    var value = originalSecrets[key]

    if (!ENV_PATTERN.test(key)) {
      invalidKeys.push(key)
    }
    value = value.replace(ENV_INTERPOLATE_PATTERN, function (_, varname) {
      if (typeof process.env[varname] === 'undefined') {
        missingEnvVars.push(varname)
      }
      return process.env[varname]
    })
    var matches = value.match(VAULT_PATH_PATTERN)
    value = [matches[1], matches[3]]
    if (!matches[3]) {
      missingColons.push(key)
    }

    secrets[key] = value
  })

  var errors = []
  if (!VAULT_TOKEN) {
    errors.push('Expected VAULT_TOKEN to be set')
  }
  if (invalidKeys.length) {
    errors.push('Invalid environment variable name' + plural(invalidKeys.length) + ': ' + invalidKeys.join(', '))
  }
  if (missingEnvVars.length) {
    errors.push('Expected environment variable' + plural(missingEnvVars.length) + ' to be set: ' + missingEnvVars.join(', '))
  }
  if (missingColons.length) {
    errors.push('Missing key (syntax "secrets/1:key") in ' + missingColons.join(', '))
  }
  if (errors.length) {
    throw new Error('Error encountered while parsing vault-secrets in ' + VAULT_ENV_PATH + '\n' + errors.join('\n'))
  }

  var secretCount = Object.keys(secrets).length
  !options.silent && console.log(
    'VAULT: fetching ' + secretCount + ' secret' + plural(secretCount) + ' from ' + VAULT_ADDR
  )

  Object.keys(secrets).forEach(function (key) {
    var value = secrets[key]
    var originalValue = value.join(':')
    var vaultPath = value[0]
    var vaultKey = value[1]
    var fullUrl = (
      VAULT_ADDR.replace(/([^\/])$/, '$1/') +
      VAULT_API_VERSION +
      vaultPath.replace(/^([^\/])/, '/$1')
    )
    !options.silent && process.stdout.write('VAULT: ' + key + ' = ' + vaultPath + ':' + vaultKey)
    try {
      var response = request('GET', fullUrl, {
        headers: {
          'X-Vault-Token': VAULT_TOKEN
        }
      })
      var lease = JSON.parse(response.getBody().toString())
      var data = lease.data
      if (vaultKey) {
        var keyPath = vaultKey.split('.')
        for (var i = 0; i < keyPath.length; i++) {
          if (typeof data !== 'object' || typeof data[keyPath[i]] === 'undefined') {
            throw new Error('Missing ' + keyPath[i] + ' in ' + originalValue)
          }
          data = data[keyPath[i]]
        }
      }
      if (typeof data !== 'string' && typeof data !== 'number') {
        throw new Error('Unexpected type ' + typeof data + ' for ' + originalValue)
      }
      envDest[key] = data
      !options.silent && process.stdout.write(' ✓\n')
    } catch (err) {
      !options.silent && process.stdout.write(' ✕\n')
      throw err
    }
  })

  !options.silent && console.log('VAULT: ready')

  return envDest
}
