#!/usr/bin/env node

var newEnv = require('./prepare')({
  silent: true,
  dryrun: true
})

for (var key in newEnv) {
  console.log('export ' + key + '=' + newEnv[key])
}
