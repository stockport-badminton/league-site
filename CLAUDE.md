# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

**Stockport Badminton League Website** — A full-stack Node.js app using:
- **Backend**: Express.js server (Node 18.x)
- **Database**: PostgreSQL (Supabase) — uses `DATABASE_URL` connection string
- **Authentication**: Auth0 (OAuth 2.0 with Auth0 hosted login)
- **Session Store**: PostgreSQL (via `connect-pg-simple`)
- **Rendering**: EJS templates
- **Storage**: AWS S3 for scorecard images and generated assets
- **Email**: AWS SES for transactional emails

**Key URL Routing**: `/routes/index.js` — imports all controllers and establishes routes

## Critical Database Details

### PostgreSQL with MySQL-Compatible Wrapper

The app uses **PostgreSQL** (Supabase) but with a compatibility wrapper in `db_connect.js` that makes queries look like MySQL:

- **Placeholder syntax**: Use `?` in queries; wrapper converts to `$1, $2, ...` automatically
- **Column names**: camelCase columns MUST be quoted in SQL: `f."homeTeam"`, `f."awayScore"`, etc.
  - Unquoted identifiers are folded to lowercase by PostgreSQL, breaking JavaScript destructuring
- **Query API**: Always returns `[rows]` for mysql2-like destructuring: `const [results] = await conn.query(...)`
- **Connection**: Via `db.otherConnect()` — async, returns `{ query: pgQuery }`

**Example:**
```javascript
const [results] = await (await db.otherConnect()).query(`
  SELECT f.id, f."homeTeam" as "homeTeam", f."awayScore" as "awayScore"
  FROM fixture f
  WHERE f.id = ?
`, [fixtureId]);
```

### Common Table Patterns

- **fixture**: `id, date, homeTeam (int), awayTeam (int), homeScore, awayScore, status ('complete'/'conceded'/etc)`
- **team**: `id, name, division (int)`
- **division**: `id, name, league (int)`
- **scorecardstore**: Draft submissions — `(id, date, homeTeam, awayTeam, Game1homeScore, ..., Game18awayScore, homeMan1, homeMan2, ...)`
- **messer_scorecard**: Messer knockout draft submissions — similar schema but Game1-Game15 (15 games, not 18)
- **player**: `id, name, gender ('Male'/'Female'), team (int)`

**JOIN Pattern**: Always quote both column names:
```sql
LEFT JOIN team ht ON f."homeTeam" = ht.id
LEFT JOIN division d ON ht."division" = d.id
```

## Authentication & Authorization

### Session & User Model

- **Session name**: Must be `__session` (Firebase Cloud Run requirement)
- **Session store**: PostgreSQL (auto-creates table on startup)
- **User object** (`req.user`):
  - `id, displayName, email`
  - `_json['https://my-app.example.com/role']` — user role (e.g., 'superadmin', 'captain')
  - `_json['https://my-app.example.com/messeradmin']` — boolean flag for messer admin

### Secured Routes

Use `/middleware/secured.js` middleware for auth-gated pages:
```javascript
router.get('/scorecard-beta', secured, scorecard_controller.scorecard_beta);
```

**Behavior**:
- If authenticated, proceeds
- If **DEV_MODE=true** and **NODE_ENV ≠ production**, injects mock user (any role/permissions)
- Otherwise redirects to `/login`

### Dev Mode (Local Development Only)

Set in `.env`:
```
DEV_MODE=true
NODE_ENV=development
```

Injects a mock `req.user` with superadmin + messeradmin roles. **SAFE** — only works outside production.

## Model/Controller/Route Structure

### Models (`/models/*.js`)
- Pure data layer; export async functions
- Handle SQL queries via `db.otherConnect()`
- Example: `fixture.js` exports `create()`, `getScorecardById()`, `createScorecard()`, etc.
- Pattern: `const [result] = await (await db.otherConnect()).query(sql, params)`

### Controllers (`/controllers/*.js`)
- Handle HTTP request/response logic
- Validate input (express-validator rules)
- Call models for data operations
- Render EJS views or return JSON

### Routes (`/routes/index.js`)
- Declare all endpoints
- Mount controllers
- Apply middleware (secured, JWT checks, etc.)

## Testing

### Setup
- **Framework**: Jest
- **Setup file**: `__tests__/setup.js` — sets required env vars before modules load
- **Test files**: Match `__tests__/**/*.test.js`

### Commands
```bash
npm test           # Run all tests once
npm run test:watch # Watch mode
```

### Test Patterns
- Unit tests: Mock dependencies, test middleware/pure functions in isolation
- Integration tests: Test full request/response flow (e.g., scoring endpoints)
- Mock `req`, `res`, `next` for middleware tests
- Use `supertest` for HTTP integration tests (see `__tests__/integration/`)

## Common Commands

### Development
```bash
npm run dev          # Development server (nodemon, dev.env)
npm start            # Production server (app.js with .env)
npm run prodlocal    # Prod-like server locally (prod build, .env)
```

### Testing
```bash
npm test             # Run once
npm run test:watch   # Watch mode
```

### Other
```bash
npm run gallery      # Run beta gallery tool
```

## Project-Specific Patterns

### Form Validation (express-validator)

Scorecard form validation is complex — validates 18 games + player uniqueness:
```javascript
// In controller, define validation rules:
const { validationResult } = require('express-validator');
const errors = validationResult(req);
if (!errors.isEmpty()) {
  // Re-render form with errors AND repopulated data (see below)
}
```

**Critical**: On validation error, must repopulate form with:
1. `data: req.body` — submitted form values
2. `scorecard: { divisionRows, homeTeamRows, ... }` — team/player dropdowns with selected flags set

Without this, form appears empty after error (user loses all entered data). See `controllers/scorecardController.js` lines 155-169 for the working error handler pattern.

### Image Generation (sharp + SVG overlays)

Result images are created via sharp with SVG text overlays:
```javascript
const sharp = require('sharp');
const postBuffer = await sharp(bgPath)
  .resize(1080, 1350, { fit: 'cover' })
  .composite([{ input: svgOverlay(1080, 1350, elements) }])
  .jpeg({ quality: 90 })
  .toBuffer();
```

SVG elements use XML escaping to avoid injection (see `utils/` for helpers).

### Video Generation (FFmpeg)

Phase 8a: Weekly video generation from fixture results
- Endpoint: `GET /api/social/generate-weekly-video?duration=2&aspect=both`
- Queries real fixture results from database
- Generates slideshow video using FFmpeg
- Supports 16-9 (1920×1080) and 1-1 (1080×1080) aspect ratios
- Creates temporary image sequences, outputs to `static/beta/videos/generated/`

### Messer Knockout Tournament

Messer is a 15-game knockout (vs. 18-game regular fixtures):
- **Validation**: Allows negative scores (handicapped competition), no difference-of-2 requirement
- **Form**: `views/messer-scorecard.ejs` — 15 games (not 18)
- **Controller**: `controllers/messer-scorecard-controller.js`
- **Draft table**: `messer_scorecard` (mirrors `scorecardstore` but for 15 games)

## Docker & Deployment

- **Dockerfile**: Alpine Node 18 + ffmpeg + fontconfig + ttf-liberation
- **Target**: Google Cloud Run (requires `__session` cookie name, `PORT` env var)
- **Build**: `npm ci --omit=dev` (clean install, no dev dependencies)
- **Entry**: `node app.js`

## Environment Variables

Key vars (see `.env` for examples):
- `AUTH0_DOMAIN`, `AUTH0_CLIENTID`, `AUTH0_CLIENT_SECRET`, `AUTH0_AUDIENCE` — Auth0 config
- `DATABASE_URL` — PostgreSQL connection string (Supabase)
- `SENDGRID_API_KEY` — Email sending
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — S3 access
- `NODE_ENV` — `'production'` or `'development'`
- `DEV_MODE` — `'true'` for local auth bypass (dev/test only)
- `PORT` — Server port (default 8080)
- `SESSION_SECRET` — Session encryption key

## Gotchas & Lessons Learned

1. **PostgreSQL column quoting**: Unquoted camelCase columns become lowercase. Always quote column names in SQL.
2. **Query placeholders**: Use `?`, not `$1`. The wrapper converts automatically.
3. **Form repopulation on errors**: Must pass both submitted data AND team/player dropdowns with selected flags, or form appears empty to user.
4. **Session cookie name**: Must be `__session` for Cloud Run (Firebase requirement).
5. **DEV_MODE is safe**: Only works outside production; injects mock user for local testing without Auth0.
6. **Model exports are async**: Always await model calls — they return promises.
7. **Test setup**: `__tests__/setup.js` runs before any test, sets env vars (don't rely on .env in tests).

## File Organization

```
league-site/
├── app.js              # Main entry point
├── db_connect.js       # PostgreSQL wrapper (MySQL-like API)
├── package.json        # Dependencies & scripts
├── controllers/        # HTTP handlers
├── middleware/         # Express middleware (auth, dev mode)
├── models/             # Data layer
├── routes/             # Route definitions
├── views/              # EJS templates
├── __tests__/          # Jest tests
│   ├── setup.js
│   ├── unit/
│   └── integration/
├── static/             # Static assets (CSS, images, generated videos)
├── migrations/         # Database schema (SQL)
└── Dockerfile          # Container config
```
