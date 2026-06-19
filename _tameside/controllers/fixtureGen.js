const seasonStartDate = new Date(2026, 8, 1); // Sept 1
const seasonEndDate = new Date(2027, 4, 1);   // May 1
const interClubDate = new Date(2026, 10, 30); // Nov 30
const xmasDate = new Date(2026, 11, 25);
const easterDate = new Date(2027, 2, 28); // Easter Mar 28 2027

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

var tameside = {
  divisions: [{
    name: "Division 1",
    teams: [
      { "club": "Hyde High", "name": "Hyde High A", "homeNight": "Wednesday", "teamindex": 1 },
      { "club": "Hyde High", "name": "Hyde High B", "homeNight": "Wednesday", "teamindex": 2 },
      { "club": "Manchester Edgeley", "name": "Manchester Edgeley A", "homeNight": "Monday", "teamindex": 1 },
      { "club": "Manchester Edgeley", "name": "Manchester Edgeley B", "homeNight": "Monday", "teamindex": 2 },
      { "club": "GHAP", "name": "GHAP A", "homeNight": "Tuesday", "teamindex": 1 },
      { "club": "GHAP", "name": "GHAP B", "homeNight": "Monday", "teamindex": 2 },
      { "club": "Shell", "name": "Shell A", "homeNight": "Wednesday", "teamindex": 1 },
      { "club": "College Green", "name": "College Green A", "homeNight": "Thursday", "teamindex": 1 },
      { "club": "Syddal Park", "name": "Syddal Park A", "homeNight": "Sunday", "teamindex": 1 }
    ]
  }, {
    name: "Division 2",
    teams: [
      { "club": "Medlock", "name": "Medlock A", "homeNight": "Thursday", "teamindex": 1 },
      { "club": "Manor", "name": "Manor A", "homeNight": "Tuesday", "teamindex": 1 },
      { "club": "Aerospace", "name": "Aerospace A", "homeNight": "Tuesday", "teamindex": 1 },
      { "club": "College Green", "name": "College Green B", "homeNight": "Thursday", "teamindex": 2 },
      { "club": "Mellor", "name": "Mellor A", "homeNight": "Tuesday", "teamindex": 1 },
      { "club": "Hyde High", "name": "Hyde High C", "homeNight": "Wednesday", "teamindex": 3 },
      { "club": "Mellor", "name": "Mellor B", "homeNight": "Tuesday", "teamindex": 2 },
      { "club": "Disley", "name": "Disley A", "homeNight": "Wednesday", "teamindex": 1 },
      { "club": "Alderley Park", "name": "Alderley Park A", "homeNight": "Wednesday", "teamindex": 1 }
    ]
  }]
};

function formatDate(date) {
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

function formatDateDDMMYYYY(dateObj) {
  const d = new Date(dateObj);
  return [
    ('0' + d.getDate()).slice(-2),
    ('0' + (d.getMonth() + 1)).slice(-2),
    d.getFullYear()
  ].join('/');
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function isDateInRange(date, start, end) {
  return date >= start && date <= end;
}

function generateValidDates(seasonEnd = null) {
  const valid = {};
  const seasonStart = new Date(2026, 8, 1);
  const actualSeasonEnd = seasonEnd || new Date(2027, 4, 1);

  // Define break ranges more precisely
  const xmas = new Date(2026, 11, 25);
  const xmasStart = new Date(xmas);
  xmasStart.setDate(xmas.getDate() - xmas.getDay());
  const xmasEnd = new Date(xmasStart);
  xmasEnd.setDate(xmasStart.getDate() + 13);

  const easter = new Date(2027, 2, 28);
  const easterStart = new Date(easter);
  easterStart.setDate(easter.getDate() - 4);
  const easterEnd = new Date(easter);
  easterEnd.setDate(easter.getDate() + 2);

  const lewis1Start = new Date(xmasEnd);
  lewis1Start.setDate(lewis1Start.getDate() + 1);
  const lewis1End = new Date(lewis1Start);
  lewis1End.setDate(lewis1Start.getDate() + 20);

  const lewis2Start = new Date(lewis1End);
  lewis2Start.setDate(lewis2Start.getDate() + 21);
  const lewis2End = new Date(lewis2Start);
  lewis2End.setDate(lewis2Start.getDate() + 13);

  const lewis3Start = new Date(easterEnd);
  const lewis3End = new Date(lewis3Start);
  lewis3End.setDate(lewis3Start.getDate() + 13);

  function inBreak(date) {
    return (
      (date >= xmasStart && date <= xmasEnd) ||
      (date >= easterStart && date <= easterEnd) ||
      (date >= lewis1Start && date <= lewis1End) ||
      (date >= lewis2Start && date <= lewis2End) ||
      (date >= lewis3Start && date <= lewis3End)
    );
  }

  for (let d = new Date(seasonStart); d <= actualSeasonEnd; d.setDate(d.getDate() + 1)) {
    const date = new Date(d);
    const day = date.getDay();
    if (day === 6) continue; // Skip Saturday
    if (inBreak(date)) continue;
    const key = DAY_NAMES[day];
    valid[key] = valid[key] || [];
    valid[key].push(date);
  }
  return valid;
}

function formatDateKey(d) {
  return `${d.getFullYear()}-${('0' + (d.getMonth() + 1)).slice(-2)}-${('0' + d.getDate()).slice(-2)}`;
}

function getDaysBetween(date1, date2) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.abs((date2 - date1) / msPerDay);
}

function generateFixtureCalendar(divisions, options = {}) {
  let validDatesByDay = generateValidDates();
  const calendar = new Map();
  const teamLastPlayed = new Map();
  const clubLastPlayed = new Map();
  const clubConsecutiveNights = new Map(); // Track consecutive nights per club

  // Initialize club consecutive nights counter
  const allClubs = new Set();
  for (const division of divisions) {
    for (const team of division.teams) {
      allClubs.add(team.club);
    }
  }
  for (const club of allClubs) {
    clubConsecutiveNights.set(club, 0);
  }

  // Generate all fixtures
  let allFixtures = [];
  for (const division of divisions) {
    const teams = division.teams;
    for (let i = 0; i < teams.length; i++) {
      for (let j = 0; j < teams.length; j++) {
        if (i === j) continue;
        allFixtures.push({
          homeTeam: teams[i],
          awayTeam: teams[j],
          day: teams[i].homeNight,
          division: division.name
        });
      }
    }
  }

  // Shuffle fixtures to avoid systematic bias toward certain teams/clubs
  for (let i = allFixtures.length - 1; i > 0; i-- ) {
    const j = Math.floor(Math.random() * (i + 1));
    [allFixtures[i], allFixtures[j]] = [allFixtures[j], allFixtures[i]];
  }

  const unscheduled = [...allFixtures];
  let maxPasses = 50; // Increased from 30
  let pass = 0;
  let seasonExtensions = 0;

  while (unscheduled.length && pass < maxPasses) {
    const remaining = [];
    
    for (const fixture of unscheduled) {
      const validDates = validDatesByDay[fixture.day] || [];
      let placed = false;

      // Sort dates by preference - prioritize dates that give better spacing
      const sortedDates = [...validDates].sort((a, b) => {
        const aScore = calculateDateScore(fixture, a, calendar, teamLastPlayed, clubLastPlayed, allFixtures, allFixtures.length, clubConsecutiveNights, pass);
        const bScore = calculateDateScore(fixture, b, calendar, teamLastPlayed, clubLastPlayed, allFixtures, allFixtures.length, clubConsecutiveNights, pass);
        return bScore - aScore; // Higher score is better
      });

      for (const date of sortedDates) {
        if (canPlaceFixture(fixture, date, calendar, teamLastPlayed, clubLastPlayed, pass, clubConsecutiveNights, seasonExtensions)) {
          placeFixture(fixture, date, calendar, teamLastPlayed, clubLastPlayed, clubConsecutiveNights);
          placed = true;
          break;
        }
      }

      if (!placed) {
        remaining.push(fixture);
      }
    }

    if (remaining.length === unscheduled.length) {
      // No progress made, try extending season or relax constraints
      if (pass > 20 && seasonExtensions < 10) {
        // Extend season by a week
        const currentEnd = new Date(seasonEndDate);
        currentEnd.setDate(currentEnd.getDate() + (7 * (seasonExtensions + 1)));
        validDatesByDay = generateValidDates(currentEnd);
        seasonExtensions++;
        console.log(`🔄 Extended season by ${seasonExtensions} week(s) to ${formatDate(currentEnd)}`);
      } else {
        pass++;
      }
    } else {
      unscheduled.length = 0;
      unscheduled.push(...remaining);
    }
  }

  if (unscheduled.length > 0) {
    console.warn(`⚠️ ${unscheduled.length} fixtures could not be scheduled after ${maxPasses} passes and ${seasonExtensions} season extensions`);
    console.warn('Unscheduled fixtures:');
    unscheduled.forEach(f => {
      console.warn(`  ${f.homeTeam.name} vs ${f.awayTeam.name} (${f.day})`);
    });
  } else {
    console.log(`✅ All fixtures scheduled successfully! (${seasonExtensions} season extensions used)`);
  }

  // Log consecutive nights statistics
  console.log('\n📊 Consecutive nights statistics:');
  for (const [club, count] of clubConsecutiveNights.entries()) {
    console.log(`  ${club}: ${count} consecutive night fixtures`);
  }

  return calendar;
}

function calculateDateScore(fixture, date, calendar, teamLastPlayed, clubLastPlayed, allFixtures, totalFixtures, clubConsecutiveNights, pass) {
  let score = 0;
  const key = formatDateKey(date);
  
  // Prefer dates with fewer fixtures already scheduled
  const fixturesOnDate = calendar.get(key) || [];
  score += (10 - fixturesOnDate.length);

  // SEASON DISTRIBUTION - heavily weight against early season cramming
  const seasonStart = new Date(2026, 8, 1);
  const xmasStart = new Date(2026, 11, 25);
  xmasStart.setDate(xmasStart.getDate() - xmasStart.getDay());
  const seasonEnd = new Date(2027, 4, 1);
  
  const totalDays = getDaysBetween(seasonStart, seasonEnd);
  const daysFromStart = getDaysBetween(seasonStart, date);
  const expectedProgress = daysFromStart / totalDays;
  
  // Count how many fixtures this team already has scheduled
  const homeTeamFixtures = countTeamFixtures(fixture.homeTeam.name, calendar);
  const awayTeamFixtures = countTeamFixtures(fixture.awayTeam.name, calendar);
  const teamFixturesCount = Math.max(homeTeamFixtures, awayTeamFixtures);
  
  // Expected fixtures by this point in season
  const teamTotalFixtures = (fixture.homeTeam.name === fixture.awayTeam.name) ? 
    0 : countTotalFixturesForTeam(fixture.homeTeam.name, allFixtures);
  const expectedFixtures = expectedProgress * teamTotalFixtures;
  
  // Penalize heavily if team is ahead of schedule (especially before Christmas)
  const isBeforeXmas = date < xmasStart;
  if (isBeforeXmas && teamFixturesCount > expectedFixtures) {
    score -= (teamFixturesCount - expectedFixtures) * 20; // Heavy penalty
  }
  
  // Reward balanced distribution
  const distributionBonus = Math.abs(expectedFixtures - teamFixturesCount) < 2 ? 10 : 0;
  score += distributionBonus;

  // Prefer dates that give better spacing for teams
  // Bell curve peaking at 14 days — penalises both too-short and too-long gaps
  const idealGap = 14;
  const homeTeamLast = teamLastPlayed.get(fixture.homeTeam.name);
  const awayTeamLast = teamLastPlayed.get(fixture.awayTeam.name);

  if (homeTeamLast) {
    const gap = getDaysBetween(homeTeamLast, date);
    score += Math.max(0, 5 - Math.abs(gap - idealGap) / 7);
  } else {
    score += 3; // First game for team
  }

  if (awayTeamLast) {
    const gap = getDaysBetween(awayTeamLast, date);
    score += Math.max(0, 5 - Math.abs(gap - idealGap) / 7);
  } else {
    score += 3;
  }

  // Prefer dates that give better spacing for clubs
  const homeClubLast = clubLastPlayed.get(fixture.homeTeam.club);
  const awayClubLast = clubLastPlayed.get(fixture.awayTeam.club);
  
  if (homeClubLast) {
    const gap = getDaysBetween(homeClubLast, date);
    score += Math.min(gap / 3, 3); // Prefer gaps of 3+ days for clubs
  }
  
  if (awayClubLast) {
    const gap = getDaysBetween(awayClubLast, date);
    score += Math.min(gap / 3, 3);
  }

  // Penalize clubs that already have too many consecutive nights relative to others
  if (pass > 10) { // Only consider after some passes
    const avgConsecutiveNights = Array.from(clubConsecutiveNights.values()).reduce((a, b) => a + b, 0) / clubConsecutiveNights.size;
    const homeClubConsecutive = clubConsecutiveNights.get(fixture.homeTeam.club) || 0;
    const awayClubConsecutive = clubConsecutiveNights.get(fixture.awayTeam.club) || 0;
    
    if (homeClubConsecutive > avgConsecutiveNights + 1) {
      score -= 5;
    }
    if (awayClubConsecutive > avgConsecutiveNights + 1) {
      score -= 5;
    }
  }

  return score;
}

function countTeamFixtures(teamName, calendar) {
  let count = 0;
  for (const fixtures of calendar.values()) {
    count += fixtures.filter(f => 
      f.homeTeam.name === teamName || f.awayTeam.name === teamName
    ).length;
  }
  return count;
}

function countTotalFixturesForTeam(teamName, allFixtures) {
  return allFixtures.filter(f => 
    f.homeTeam.name === teamName || f.awayTeam.name === teamName
  ).length;
}

function canPlaceFixture(fixture, date, calendar, teamLastPlayed, clubLastPlayed, pass, clubConsecutiveNights, seasonExtensions) {
  const key = formatDateKey(date);
  const fixturesOnDate = calendar.get(key) || [];
  
  // Check if teams are already playing on this date
  const busyTeams = new Set();
  fixturesOnDate.forEach(f => {
    busyTeams.add(f.homeTeam.name);
    busyTeams.add(f.awayTeam.name);
  });
  
  if (busyTeams.has(fixture.homeTeam.name) || busyTeams.has(fixture.awayTeam.name)) {
    return false;
  }

  // Check club conflicts on same day - allow 1st and 3rd teams to play on same night
  const busyClubs = new Set();
  const clubTeamsOnDate = new Map();
  
  fixturesOnDate.forEach(f => {
    if (!clubTeamsOnDate.has(f.homeTeam.club)) {
      clubTeamsOnDate.set(f.homeTeam.club, []);
    }
    if (!clubTeamsOnDate.has(f.awayTeam.club)) {
      clubTeamsOnDate.set(f.awayTeam.club, []);
    }
    clubTeamsOnDate.get(f.homeTeam.club).push(f.homeTeam.teamindex);
    clubTeamsOnDate.get(f.awayTeam.club).push(f.awayTeam.teamindex);
  });
  
  // Check if home team's club has a conflict
  if (clubTeamsOnDate.has(fixture.homeTeam.club)) {
    const existingTeamIndices = clubTeamsOnDate.get(fixture.homeTeam.club);
    // Allow if this is team 1 and there's only team 3, or if this is team 3 and there's only team 1
    const canPlay = (fixture.homeTeam.teamindex === 1 && existingTeamIndices.length === 1 && existingTeamIndices[0] === 3) ||
                   (fixture.homeTeam.teamindex === 3 && existingTeamIndices.length === 1 && existingTeamIndices[0] === 1);
    if (!canPlay) {
      return false;
    }
  }
  
  // Check if away team's club has a conflict
  if (clubTeamsOnDate.has(fixture.awayTeam.club)) {
    const existingTeamIndices = clubTeamsOnDate.get(fixture.awayTeam.club);
    // Allow if this is team 1 and there's only team 3, or if this is team 3 and there's only team 1
    const canPlay = (fixture.awayTeam.teamindex === 1 && existingTeamIndices.length === 1 && existingTeamIndices[0] === 3) ||
                   (fixture.awayTeam.teamindex === 3 && existingTeamIndices.length === 1 && existingTeamIndices[0] === 1);
    if (!canPlay) {
      return false;
    }
  }

  // CONSECUTIVE NIGHTS CHECK (per team) - no individual team plays on back-to-back nights.
  // Waived only after 3+ season extensions when we're really struggling to place fixtures.
  if (seasonExtensions < 3) {
    const teamPlaysOn = (checkDate) => {
      const checkFixtures = calendar.get(formatDateKey(checkDate)) || [];
      return checkFixtures.some(f =>
        f.homeTeam.name === fixture.homeTeam.name ||
        f.awayTeam.name === fixture.homeTeam.name ||
        f.homeTeam.name === fixture.awayTeam.name ||
        f.awayTeam.name === fixture.awayTeam.name
      );
    };

    if (teamPlaysOn(addDays(date, -1)) || teamPlaysOn(addDays(date, 1))) {
      return false;
    }
  }

  // CONSECUTIVE NIGHTS CHECK (per club) - no club has any team playing on adjacent nights.
  // Waived after 5+ season extensions as a last resort.
  if (seasonExtensions < 5) {
    const clubPlaysOn = (checkDate) => {
      const checkFixtures = calendar.get(formatDateKey(checkDate)) || [];
      return checkFixtures.some(f =>
        f.homeTeam.club === fixture.homeTeam.club ||
        f.awayTeam.club === fixture.homeTeam.club ||
        f.homeTeam.club === fixture.awayTeam.club ||
        f.awayTeam.club === fixture.awayTeam.club
      );
    };

    if (clubPlaysOn(addDays(date, -1)) || clubPlaysOn(addDays(date, 1))) {
      return false;
    }
  }

  // Check minimum spacing requirements (relaxed in later passes)
  const minDays = Math.max(1, 7 - Math.floor(pass / 5)); // Start at 7 days, reduce to 1
  
  const homeTeamLast = teamLastPlayed.get(fixture.homeTeam.name);
  const awayTeamLast = teamLastPlayed.get(fixture.awayTeam.name);
  
  if (homeTeamLast && getDaysBetween(homeTeamLast, date) < minDays) {
    return false;
  }
  
  if (awayTeamLast && getDaysBetween(awayTeamLast, date) < minDays) {
    return false;
  }

  // Check inter-club restrictions
  if (fixture.homeTeam.club === fixture.awayTeam.club && date > interClubDate) {
    return false;
  }

  return true;
}

function placeFixture(fixture, date, calendar, teamLastPlayed, clubLastPlayed, clubConsecutiveNights) {
  const key = formatDateKey(date);
  if (!calendar.has(key)) {
    calendar.set(key, []);
  }
  
  calendar.get(key).push(fixture);
  teamLastPlayed.set(fixture.homeTeam.name, date);
  teamLastPlayed.set(fixture.awayTeam.name, date);
  clubLastPlayed.set(fixture.homeTeam.club, date);
  clubLastPlayed.set(fixture.awayTeam.club, date);
  
  // Check if this creates consecutive nights and track it
  const dayBefore = addDays(date, -1);
  const dayAfter = addDays(date, 1);
  
  const beforeKey = formatDateKey(dayBefore);
  const afterKey = formatDateKey(dayAfter);
  
  const beforeFixtures = calendar.get(beforeKey) || [];
  const afterFixtures = calendar.get(afterKey) || [];
  
  // Check if home team's club has consecutive nights
  const homeClubConsecutive = beforeFixtures.some(f => 
    f.homeTeam.club === fixture.homeTeam.club || f.awayTeam.club === fixture.homeTeam.club
  ) || afterFixtures.some(f => 
    f.homeTeam.club === fixture.homeTeam.club || f.awayTeam.club === fixture.homeTeam.club
  );
  
  // Check if away team's club has consecutive nights
  const awayClubConsecutive = beforeFixtures.some(f => 
    f.homeTeam.club === fixture.awayTeam.club || f.awayTeam.club === fixture.awayTeam.club
  ) || afterFixtures.some(f => 
    f.homeTeam.club === fixture.awayTeam.club || f.awayTeam.club === fixture.awayTeam.club
  );
  
  if (homeClubConsecutive) {
    clubConsecutiveNights.set(fixture.homeTeam.club, (clubConsecutiveNights.get(fixture.homeTeam.club) || 0) + 1);
  }
  
  if (awayClubConsecutive && fixture.awayTeam.club !== fixture.homeTeam.club) {
    clubConsecutiveNights.set(fixture.awayTeam.club, (clubConsecutiveNights.get(fixture.awayTeam.club) || 0) + 1);
  }
}

function formatDateForOutput(dateObj) {
  const d = new Date(dateObj);
  if (isNaN(d.getTime())) return 'Invalid';
  return [
    ('0' + d.getDate()).slice(-2),
    ('0' + (d.getMonth() + 1)).slice(-2),
    d.getFullYear()
  ].join('/');
}

function formatShortDate(d) {
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function formatOtherDate(d) {
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
}

function isWeekend(d) {
  return d.getDay() === 0 || d.getDay() === 6;
}

function isInRange(d, start, end) {
  return d >= start && d <= end;
}

function getBreakFlags(date) {
  const d = new Date(date);

  const xmas = (() => {
    const xmas = new Date(d.getFullYear(), 11, 25);
    const start = new Date(xmas);
    start.setDate(xmas.getDate() - xmas.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 13);
    return isInRange(d, start, end);
  })();

  const easter = (() => {
    const start = new Date(easterDate);
    start.setDate(easterDate.getDate() - 4);
    const end = new Date(easterDate);
    end.setDate(easterDate.getDate() + 2);
    return isInRange(d, start, end);
  })();

  const lewisShield = (() => {
    const xmas = new Date(d.getFullYear(), 11, 25);
    const start1 = new Date(xmas);
    start1.setDate(xmas.getDate() - xmas.getDay() + 14);
    const end1 = new Date(start1);
    end1.setDate(start1.getDate() + 20);

    const start2 = new Date(end1);
    start2.setDate(end1.getDate() + 21);
    const end2 = new Date(start2);
    end2.setDate(start2.getDate() + 13);

    const start3 = new Date(d.getFullYear(), 3, 7);
    const end3 = new Date(start3);
    end3.setDate(start3.getDate() + 13);

    return isInRange(d, start1, end1) || isInRange(d, start2, end2) || isInRange(d, start3, end3);
  })();

  return { xmas, easter, lewisshield: lewisShield, weekend: isWeekend(d) };
}

function prepareFixtureRenderContext(divisions) {
  const seasonCalendarMap = generateFixtureCalendar(divisions, { sortDatesForSpacing: true });

  const seasonCalendar = Array.from(seasonCalendarMap.entries()).map(([dateStr, fixtures]) => {
    const dateObj = new Date(dateStr.split('-')[0], dateStr.split('-')[1] - 1, dateStr.split('-')[2]);
    const flags = getBreakFlags(dateObj);

    return {
      fixtures: fixtures.map(fix => ({
        homeTeam: fix.homeTeam.name,
        awayTeam: fix.awayTeam.name,
        division: fix.division
      })),
      shortDate: formatOtherDate(dateObj),
      date: formatDateDDMMYYYY(dateObj),
      dateObj: dateObj,
      day: dateObj.getDay(),
      ...flags
    };
  });
  
  seasonCalendar.sort((a, b) => new Date(a.dateObj) - new Date(b.dateObj));

  function flattenFixtures(fixtures, targetDivision) {
    return fixtures.flatMap(fixtureRow =>
      fixtureRow.fixtures.filter(f => f.division === targetDivision).map(f => ({
        date: fixtureRow.shortDate,
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam
      }))
    );
  }

  return {
    fixturesOutput: seasonCalendar,
    divOneFixtures: JSON.stringify(flattenFixtures(seasonCalendar, 'Division 1')),
    divOneTeams: JSON.stringify(divisions[0].teams),
    divTwoFixtures: JSON.stringify(flattenFixtures(seasonCalendar, 'Division 2')),
    divTwoTeams: JSON.stringify(divisions[1].teams)
  };
}

function renderFixtures(req, res) {
  const context = prepareFixtureRenderContext(tameside.divisions);
  res.render('tameside/fixtures', {
    static_path: '/static',
    pageTitle: "Scorecard Info",
    pageDescription: "View scorecard for this match",
    result: "Some Jibber Jabber about processing fixture dates",
    canonical: ("https://" + req.get("host") + req.originalUrl)
      .replace("www.'", "")
      .replace(".com", ".co.uk")
      .replace("-badders.herokuapp", "-badminton"),
    ...context
  });
}

module.exports = {
  renderFixtures
};