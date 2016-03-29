var findRoot = require('find-root')
var request = require('sync-request')
var asyncRequest = require('then-request')
var readFile = require('fs').readFileSync
var inspect = require('util').inspect
var EventEmitter = require('events')
var parseSecretfile = require('./parseSecretfile')

function plural (n) {
  return n === 1 ? '' : 's'
}

function parseLeaseResponse (response) {
  return JSON.parse(response.getBody().toString())
}

function formatText (text, before, after) {
  return process.stdout.isTTY ? '\u001b[' + before + 'm' + text + '\u001b[' + after + 'm' : text
}
function bold (text) {
  return formatText(text, 1, 22)
}
function green (text) {
  return formatText(text, 32, 39)
}
function red (text) {
  return formatText(text, 31, 39)
}

var logPrefix = bold('vault-env: ')

module.exports = function prepare (options) {
  options = options || {}
  var VAULT_ADDR = (options.VAULT_ADDR || process.env.VAULT_ADDR || 'http://127.0.0.1:8200').replace(/([^\/])$/, '$1/')
  var VAULT_TOKEN = options.VAULT_TOKEN || process.env.VAULT_TOKEN
  var VAULT_API_VERSION = options.VAULT_API_VERSION || process.env.VAULT_API_VERSION || 'v1'
  var VAULT_ENV_PATH = options.VAULT_ENV_PATH || process.env.VAULT_ENV_PATH || findRoot(process.cwd()) + '/Secretfile'
  var varsWritten = {}
  var emitter = new EventEmitter()

  if (!VAULT_TOKEN) {
    throw new Error('Expected VAULT_TOKEN to be set')
  }

  var originalSecrets = parseSecretfile(readFile(VAULT_ENV_PATH, 'utf8'))

  var secretsByPath = {}
  Object.keys(originalSecrets).forEach(function (key) {
    var vaultPath = originalSecrets[key][0]
    var vaultProp = originalSecrets[key][1]
    secretsByPath[vaultPath] = secretsByPath[vaultPath] || {}
    secretsByPath[vaultPath][key] = vaultProp
  })

  var secretCount = Object.keys(originalSecrets).length
  !options.silent && console.log(
    logPrefix + 'fetching ' + secretCount + ' secret' + plural(secretCount) + ' from ' + VAULT_ADDR
  )

  function getNewLease (vaultPath, sync) {
    var req = sync ? request : asyncRequest
    var fullUrl = (
      VAULT_ADDR +
      VAULT_API_VERSION +
      '/' + vaultPath
    )
    var response = req('GET', fullUrl, {
      headers: {
        'X-Vault-Token': VAULT_TOKEN
      }
    })
    if (sync) {
      onLease(vaultPath, parseLeaseResponse(response))
    } else {
      !options.silent && console.log(logPrefix + 'rotating lease for ' + Object.keys(secretsByPath[vaultPath]).join(', '))
      response
        .then(parseLeaseResponse)
        .then(onLease.bind(null, vaultPath))
        .catch(function retry (err) {
          console.error(logPrefix + 'ERROR trying to rotate lease ' + vaultPath)
          console.error(logPrefix + (err && err.stack ? err.stack : err))
          console.error('retrying in 1s')
          setTimeout(getNewLease.bind(null, vaultPath), 1000)
        })
    }
  }

  function onLease (vaultPath, lease) {
    var secretsByName = secretsByPath[vaultPath]
    var previousValues = {}
    for (var secretName in secretsByName) {
      var keyPath = secretsByName[secretName]
      var data = lease.data
      for (var i = 0; i < keyPath.length; i++) {
        if (typeof data !== 'object' || typeof data[keyPath[i]] === 'undefined') {
          throw new Error('Missing ' + keyPath[i] + ' in ' + vaultPath + ':' + secretsByName[secretName])
        }
        data = data[keyPath[i]]
      }
      if (typeof data !== 'string' && typeof data !== 'number') {
        throw new Error('Unexpected ' + typeof data + ' ' + inspect(data) + ' for ' + vaultPath + ':' + secretsByName[secretName])
      }
      if (options.autoRotate) {
        previousValues[secretName] = process.env[secretName]
      }
      process.env[secretName] = data
      varsWritten[secretName] = data
    }
    if (!options.dryrun) {
      Object.keys(secretsByName).forEach(function (secretName) {
        if (process.env[secretName] !== previousValues[secretName]) {
          emitter.emit(secretName, process.env[secretName], previousValues[secretName])
        }
      })
    }
    if (options.autoRotate) {
      var ttl = lease.ttl || lease.lease_duration
      if (!ttl) {
        console.error(
          logPrefix + 'Refusing to refresh vault lease no lease duration for ' +
          Object.keys(secretsByName).join(', ') +
          ' at ' + vaultPath
        )
      } else {
        setTimeout(getNewLease.bind(null, vaultPath), (ttl / 2) * 1000)
      }
    }
  }

  Object.keys(secretsByPath).forEach(function (vaultPath) {
    var secretsByName = secretsByPath[vaultPath]
    var names = Object.keys(secretsByName)
    !options.silent && process.stdout.write(logPrefix + 'loading ' + names.join(', ') + ' from ' + vaultPath)
    try {
      getNewLease(vaultPath, true)
      !options.silent && process.stdout.write(' ' + green('✓') + '\n')
    } catch (err) {
      !options.silent && process.stdout.write(' ' + red('✕') + '\n')
      throw err
    }
  })

  return options.autoRotate ? emitter : varsWritten
}
