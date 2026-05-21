#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db_connect');

async function runMigration(migrationFile) {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', migrationFile), 'utf8');
    console.log(`Running migration: ${migrationFile}`);

    // Initialize database connection
    db.connect();
    const conn = await db.otherConnect();

    // Split SQL by semicolons and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      try {
        await conn.query(statement);
        console.log(`✓ Executed: ${statement.substring(0, 50)}...`);
      } catch (err) {
        console.error(`Error executing statement: ${statement.substring(0, 50)}...`);
        console.error(err.message);
        if (err.message.includes('already exists')) {
          console.log('  (Table already exists, skipping)');
        } else {
          throw err;
        }
      }
    }

    console.log(`✓ Migration ${migrationFile} completed successfully`);
  } catch (err) {
    console.error(`✗ Migration failed: ${err.message}`);
    process.exit(1);
  }
}

const migrationFile = process.argv[2] || '002_messer_scorecard.sql';
runMigration(migrationFile).then(() => process.exit(0));
