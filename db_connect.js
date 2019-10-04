var mysql = require('mysql')
  , async = require('async')

var state = {
  pool: null
}

var hostname = process.env.RDS_HOSTNAME
var username = process.env.RDS_USERNAME
var password = process.env.RDS_PASSWORD
var database = process.env.RDS_DATABASE || 'badminton';

exports.connect = function(done) {
  state.pool = mysql.createPool({
    'host'     : hostname,
    'user'     : username,
    'password' : password,
    'database' : database,
    'multipleStatements':true
  })
  done()
}

exports.get = function() {
  return state.pool
}

exports.drop = function(tables, done) {
  var pool = state.pool
  if (!pool) return done(new Error('Missing database connection.'))

  async.each(tables, function(name, cb) {
    pool.query('DELETE * FROM ' + name, cb)
  }, done)
}

exports.isObject = function(obj){
  return obj === Object(obj);
}
