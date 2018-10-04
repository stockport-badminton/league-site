# Stockport & District Badminton League Website
This application uses AWS, Express, Bootstrap, MySQL, EJS, Auth0 to literally throw together a website for my local badminton League

## Current Features
* A quasi static website showing fixtures, results, league tables using ejs as a template/layout engine.
* A contact us form that protects the email addresses of the contactees.
* REST API for league, division, club, team, venue & player endpoints - all secured using the auth0 service.
* Fixtures, results and tables drvien out of DB
* POST requests locked down with access tokens using Auth0

## Future Stuff
* UI for CRUD for fixtures & results
** fuzzy matching of players names to allow input directly from excel (interim / alernative method if fully online isn't suitable for all users)
** accept input from excel
*** upload excel via form
*** OR send HTTP from excel scoresheet
* UI for CRUD for club, team and venue details
* UI for CRUD for players
* user registration (or rather player -> administrator conversion)
