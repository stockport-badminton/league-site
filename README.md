# Stockport & District Badminton League Website
This application uses GCP, Google Vision, Supabase,  EJS, Auth0 to literally throw together a free hosted website for my local badminton League (only costs are some minimal cloudfront and domain name costs)

## Current Features
* A quasi static website showing fixtures, results, league tables using ejs as a template/layout engine.
* A contact us form that protects the email addresses of the contactees.
* REST API for league, division, club, team, venue & player endpoints - all secured using the auth0 service.
* Fixtures, results and tables drvien out of DB
* POST requests locked down with access tokens using Auth0
* rudimentary stats, including ELO-like rating system for players based on results entry
* user registration for results entry
* fuzzy matching clientside
* containerised build
* UI for CRUD for players & team management
* OCR for scorecards to pre-populate scorecard entry
* hidden contact information behind user-login


## Future Stuff
* UI for CRUD for fixtures & results
* UI for CRUD for club, team and venue details