-- LOCAL ONLY: fictional clubs, teams and players for the scorecard demo video.
BEGIN;
DELETE FROM fixture WHERE "homeTeam" IN (SELECT id FROM team WHERE name IN ('Larkhill A','Brookvale A'));
DELETE FROM player WHERE club IN (SELECT id FROM club WHERE name IN ('Larkhill','Brookvale'));
DELETE FROM team WHERE name IN ('Larkhill A','Brookvale A');
DELETE FROM club WHERE name IN ('Larkhill','Brookvale');
INSERT INTO club (name) VALUES ('Larkhill'), ('Brookvale');
INSERT INTO team (name, venue, club, division, rank, "divRank")
  SELECT 'Larkhill A', 5, id, 9, 1, 9 FROM club WHERE name='Larkhill';
INSERT INTO team (name, venue, club, division, rank, "divRank")
  SELECT 'Brookvale A', 23, id, 9, 1, 10 FROM club WHERE name='Brookvale';
INSERT INTO player (first_name, family_name, gender, team, club, rank, date_of_registration)
SELECT v.f, v.l, v.g, t.id, t.club, v.r, now()
FROM (VALUES
 ('Larkhill A','Tom','Ashworth','Male',1),('Larkhill A','Ravi','Mistry','Male',2),('Larkhill A','Dan','Kowalski','Male',3),('Larkhill A','Gareth','Lloyd','Male',4),
 ('Larkhill A','Emma','Hartley','Female',1),('Larkhill A','Priya','Shah','Female',2),('Larkhill A','Sophie','Breen','Female',3),('Larkhill A','Lucy','Okafor','Female',4),
 ('Brookvale A','Matt','Fielding','Male',1),('Brookvale A','Josh','Turner','Male',2),('Brookvale A','Sam','Whitlow','Male',3),('Brookvale A','Leon','Chadwick','Male',4),
 ('Brookvale A','Hannah','Booth','Female',1),('Brookvale A','Grace','Ellison','Female',2),('Brookvale A','Amy','Nolan','Female',3),('Brookvale A','Kate','Rigby','Female',4)
) AS v(t,f,l,g,r) JOIN team t ON t.name=v.t;
INSERT INTO fixture ("homeTeam","awayTeam",date,status)
  SELECT h.id, a.id, '2026-11-05', 'outstanding' FROM team h, team a WHERE h.name='Larkhill A' AND a.name='Brookvale A';
COMMIT;
SELECT t.id, t.name, count(p.id) FROM team t LEFT JOIN player p ON p.team=t.id WHERE t.name IN ('Larkhill A','Brookvale A') GROUP BY 1,2;
SELECT id, "homeTeam", "awayTeam", date FROM fixture WHERE "homeTeam" IN (SELECT id FROM team WHERE name='Larkhill A');
