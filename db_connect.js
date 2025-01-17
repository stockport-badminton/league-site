var mysql = require('mysql2/promise')
  , async = require('async')


var state = {
  pool: null
}

var pool = {}

var hostname = process.env.RDS_HOSTNAME
var username = process.env.RDS_USERNAME
var password = process.env.RDS_PASSWORD
var database = process.env.RDS_DATABASE || 'badminton';

exports.connect = async function() {
  state.pool =  mysql.createPool({
    'host'     : hostname,
    'user'     : username,
    'password' : password,
    'database' : database,
    'multipleStatements':true,
    'connectionLimit':12
  });
}

exports.otherConnect = async function() {
  /* const conn = await mysql.createConnection({
    'host'     : hostname,
    'user'     : username,
    'password' : password,
    'database' : database,
    'multipleStatements':true
  })
  return conn */
  return state.pool;
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
