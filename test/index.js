var tape = require('tape')
var tmpFile = require('tmp').fileSync
var writeFile = require('fs').writeFileSync
var spawn = require('child_process').spawn
var prepare = require('../prepare')
var linereader = require('through2-linereader')
var pathJoin = require('path').join

var TEST_PORT = 39582
var TEST_TOKEN = 'test-token-1'

function test (name, options) {
  var pkg = options.pkg
  var secrets = options.secrets
  var expected = options.expected
  var throws = options.throws
  var packagePath = tmpFile().name

  function doIt () {
    prepare({
      VAULT_ADDR: `http://127.0.0.1:${TEST_PORT}`,
      VAULT_TOKEN: TEST_TOKEN,
      VAULT_ENV_PATH: packagePath,
      silent: true
    })
  }

  tape(name, function (t) {
    writeFile(packagePath, JSON.stringify(pkg))
    var vaultServer = spawn(process.argv[0], [pathJoin(__dirname, '/lib/fakevault.js')], {
      env: {
        TEST_TOKEN: TEST_TOKEN,
        TEST_PORT: TEST_PORT,
        TEST_SECRETS: JSON.stringify(secrets)
      }
    })
    var ready = false
    vaultServer.stdout.pipe(linereader()).on('data', function (line) {
      if (line.toString() === 'ready' && !ready) {
        ready = true
        try {
          if (throws) {
            t.throws(doIt, throws)
          } else {
            doIt()
            for (var key in expected) {
              t.equal(process.env[key], expected[key], key + ' should match')
            }
          }

          vaultServer.kill()
          t.end()
        } catch (err) {
          vaultServer.kill()
          t.fail(err)
        }
      } else {
        t.comment('vault server stdout: ' + line)
      }
    })
    vaultServer.stderr.pipe(linereader()).on('data', function (line) {
      t.comment('vault server stderr: ' + line)
    })
  })
}

test('one env var', {
  pkg: {
    'vault-secrets': {
      thing: 'secret/thing:url'
    }
  },
  secrets: {
    'secret/thing': {
      url: 'hellooooo'
    }
  },
  expected: {
    thing: 'hellooooo'
  }
})

test('two env vars', {
  pkg: {
    'vault-secrets': {
      thing1: 'secret/thing:url1',
      thing2: 'secret/thing:url2'
    }
  },
  secrets: {
    'secret/thing': {
      url1: 'hellooooo',
      url2: 'goodbyeeee'
    }
  },
  expected: {
    thing1: 'hellooooo',
    thing2: 'goodbyeeee'
  }
})

test('deeply nested secret paths', {
  pkg: {
    'vault-secrets': {
      thing1: 'secret/thing:deeply.nested.secret.path.thing1',
      thing2: 'secret/thing:deeply.nested.secret.path.thing2'
    }
  },
  secrets: {
    'secret/thing': {deeply: {nested: {secret: {path: {
      thing1: 'hellooooo',
      thing2: 'goodbyeeee'
    }}}}}
  },
  expected: {
    thing1: 'hellooooo',
    thing2: 'goodbyeeee'
  }
})

test('one invalid env var', {
  pkg: {
    'vault-secrets': {
      '2': 'secret/thing:url1'
    }
  },
  secrets: {},
  throws: /Invalid environment variable name: 2/
})

test('two invalid env vars', {
  pkg: {
    'vault-secrets': {
      '2': 'secret/thing:url1',
      '3': 'boop:thing'
    }
  },
  secrets: {},
  throws: /Invalid environment variable names: 2, 3/
})

test('missing secret', {
  pkg: {
    'vault-secrets': {
      boop: 'secret/thing:url'
    }
  },
  secrets: {},
  throws: /Server responded with status code 404:\nkey not found secret\/thing/
})

test('one invalid secret path', {
  pkg: {
    'vault-secrets': {
      thing: 'secrets/thing'
    }
  },
  secrets: {
    thing: 'boop'
  },
  throws: /Missing key \(syntax "secrets\/1:key"\) in thing/
})

test('two invalid secret paths', {
  pkg: {
    'vault-secrets': {
      thing: 'secrets/thing',
      stuff: 'secrets/stuff'
    }
  },
  secrets: {
    thing: 'boop'
  },
  throws: /Missing key \(syntax "secrets\/1:key"\) in thing, stuff/
})
