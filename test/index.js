var tape = require('tape')
var tmpFile = require('tmp').fileSync
var writeFile = require('fs').writeFileSync
var spawn = require('child_process').spawn
var prepare = require('../prepare')
var linereader = require('through2-linereader')
var pathJoin = require('path').join

var TEST_PORT = 39582
var TEST_TOKEN = 'test-token-1'
process.env.SAMPLE = 'hello'

function test (name, options) {
  var secretfile = options.secretfile
  var secrets = options.secrets
  var expected = options.expected
  var overrides = options.overrides
  var throws = options.throws
  var local = options.local
  var secretfilePath = tmpFile().name

  function doIt () {
    for (var key in overrides) {
      process.env[key] = overrides[key]
    }
    return prepare({
      VAULT_ADDR: `http://127.0.0.1:${TEST_PORT}`,
      VAULT_TOKEN: TEST_TOKEN,
      VAULT_ENV_PATH: secretfilePath,
      silent: false,
      local: local
    })
  }
  function cleanup () {
    for (var key in expected) {
      delete process.env[key]
    }
  }

  tape(name, function (t) {
    writeFile(secretfilePath, secretfile)
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
            var mySecret = doIt()
            for (var key in expected) {
              if (!options.local) {
                  t.equal(process.env[key], expected[key], key + ' should match')
              } else {
                  t.notEqual(process.env[key], expected[key], key + ' should not match')
                  t.equal(mySecret[key], expected[key], key + ' should match')
              }
            }
          }

          cleanup()
          vaultServer.kill()
          t.end()
        } catch (err) {
          cleanup()
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
  secretfile: 'thing secret/thing:url',
  secrets: {
    'secret/thing': {
      url: 'hellooooo'
    }
  },
  expected: {
    thing: 'hellooooo'
  }
})

test('override env var', {
  secretfile: 'thing secret/thing:url',
  secrets: {},
  expected: {
    thing: 'hellooooo'
  },
  overrides: {
    thing: 'hellooooo'
  }
})

test('two env vars', {
  secretfile: 'thing1 secret/thing:url1\nthing2 secret/thing:url2',
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

test('one invalid env var', {
  secretfile: '2 secret/thing:url1',
  secrets: {},
  throws: /Error parsing Secretfile:\nInvalid line 0: 2 secret\/thing:url1/
})

test('two invalid env vars', {
  secretfile: '2 secret/thing:url1\n3 boop:thing',
  secrets: {},
  throws: /Error parsing Secretfile:\nInvalid line 0: 2 secret\/thing:url1\nInvalid line 1: 3 boop:thing/
})

test('missing secret', {
  secretfile: 'boop secret/thing:url',
  secrets: {},
  throws: /key not found/
})

test('one invalid secret path', {
  secretfile: 'thing secret/thing',
  secrets: {
    thing: 'boop'
  },
  throws: /key not found/
})

test('two invalid secret paths', {
  secretfile: 'thing secrets/thing\nstuff secrets/stuff',
  secrets: {
    thing: 'boop'
  },
  throws: /key not found/
})

test('multiple secrets from one path', {
  secretfile: 'one secrets/test:one\ntwo secrets/test:two',
  secrets: {
    'secrets/test': { one: 'one', two: 'two' }
  },
  expected: {
    one: 'one',
    two: 'two'
  }
})

test('env substitution', {
  secretfile: 'one secrets/$SAMPLE:one\ntwo secrets/${SAMPLE}:two',
  secrets: {
    'secrets/hello': { one: 'one', two: 'two' }
  },
  expected: {
    one: 'one',
    two: 'two'
  }
})

test('one var local only', {
    secretfile: 'thing secret/thing:url',
    secrets: {
        'secret/thing': {
            url: 'hellooooo'
        }
    },
    expected: {
        thing: 'hellooooo'
    },
    local: 'true'
})

test('two vars local only', {
    secretfile: 'thing1 secret/thing:url1\nthing2 secret/thing:url2',
    secrets: {
        'secret/thing': {
            url1: 'hellooooo',
            url2: 'goodbyeeee'
        }
    },
    expected: {
        thing1: 'hellooooo',
        thing2: 'goodbyeeee'
    },
    local: 'true'
})
