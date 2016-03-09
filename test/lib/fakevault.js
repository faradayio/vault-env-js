var createServer = require('http').createServer

var TOKEN = process.env.TEST_TOKEN
var PORT = process.env.TEST_PORT
var SECRETS = JSON.parse(process.env.TEST_SECRETS)

createServer(function responder (req, res) {
  var key = req.url.slice(1)
  var version = key.slice(0, 2)
  key = key.slice(3)
  if (version !== 'v1') {
    res.writeHeader(500)
    res.end('invalid api version ' + version)
  } else if (req.method !== 'GET') {
    res.writeHeader(404)
    res.end('only get method is allowed')
  } else if (req.headers['x-vault-token'] !== TOKEN) {
    res.writeHeader(503)
    res.end('invalid token')
  } else if (typeof SECRETS[key] === 'undefined') {
    res.writeHeader(404)
    res.end('key not found ' + key)
  } else {
    res.writeHeader(200)
    res.end(JSON.stringify({ data: SECRETS[key] }))
    delete SECRETS[key]
  }
}).listen(PORT, function () {
  console.log('ready')
})

process.on('disconnect', function () {
  process.exit()
})
