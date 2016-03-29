var SECRETFILE_PATTERN = /^([a-zA-Z_][a-zA-Z0-9_]+)\s+([^:\s]+)(:(.+))?$/
var SECRETFILE_COMMENT_PATTERN = /(^#)|(^\s*$)/
var SECRETFILE_VAR_PATTERN = /\$(?:([a-zA-Z_][a-zA-Z0-9_]*)|\{([a-zA-Z_][a-zA-Z0-9_]*)\})/g

module.exports = function parseSecretfile (data) {
  var lines = data.split('\n').map(function (line, i) {
    if (SECRETFILE_COMMENT_PATTERN.test(line)) return

    var matches = SECRETFILE_PATTERN.exec(line)
    if (!matches) return 'Invalid line ' + i + ': ' + line

    var missingEnvVars = []
    var path = matches[2].replace(SECRETFILE_VAR_PATTERN, function (_, a, b) {
      var envVar = process.env[a || b]
      if (typeof envVar === 'undefined' && missingEnvVars.indexOf(envVar) !== -1) {
        missingEnvVars.push(envVar)
      }
      return envVar
    })

    if (missingEnvVars.length) {
      return 'Missing environment variables on line ' + i + ' (' + missingEnvVars.join(', ') + ') ' + line
    }

    return [
      matches[1],
      path,
      (matches[4] || '').split(':')
    ]
  })

  var errorMessage = lines.filter(function (line) { return typeof line === 'string' }).join('\n')
  if (errorMessage) {
    throw new Error('Error parsing Secretfile:\n' + errorMessage)
  }

  return lines.filter(Array.isArray).reduce((map, row) => {
    map[row[0]] = row.slice(1)
    return map
  }, {})
}
