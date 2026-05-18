/* required information:
* season start date (should be a sunday in September)
* easter break (fortnight off around easter sunday(sunday to sunday))
* christmas break (fortnight off with christmas day being somewhere in the first week (sunday to sunday))
* lewis shield breaks (3 breaks - first round is 3 weeks, 2nd and 3rd are two weeks - all after xmas - at least 2 or 3 week break between rounds)
** first break is immediately after xmas break
** second break is 3 weeks after the end of the first break
** third break is: the 2 weeks before easter if there is less than 2 weeks remaining in the season after the easter break, otherwise it's after the easter break
* clubs, teams, home nights and divisions

fixture generation rules:
no club should have more than one team playing on the same night, or within one night either side of another team fixture
two teams from the same club should play the matches against each other before the end of november

Rough logic of how this all works

1.  take the list of teams in a division and generate the list of fixtures required. 
2.  shuffle this list to make it randomly ordered (e.g not all Aerospace home fixtures first  and Shell home fixture last)
3. to the above for each division and combine the two lists into a master fixture list
4. pick a date at random between season start date and end date
4.1 ignore weekends
4.2 mark dates for easter break, xmas break and lewisshield breaks to prevent fixtures occurring then
4.3 check if we've assigned fixtures to this date before and make a note so we can check against them
4.5 check for fixtures near this date and make a note so we can check against them
4.6 if a date is available check the list of fixtures generated in 1-4
4.6.1 if the current day doesn't match any fixture days then skip to the next date
4.6.2 if the home and away club are the same, check the date is before end of november
4.6.3 check the home team doesn't already have a match that night
4.6.4 check the away team doesn't already have a match that night
4.6.5 check if the homeclub has another match that night that is isn't their next/previous team (e.g. prevent A & B teams playing the same night, but allow A & C teams where required)
4.6.6 check if the awayclub has another match that night that is isn't their next/previous team (e.g. prevent A & B teams playing the same night, but allow A & C teams where required)
4.6.7 check the home team doesn't already have a match in the fixtures close to this date
4.6.8 check the away team doesn't already have a match in the fixtures close to this date
4.6.9 check the home club doesn't already have a match in the fixtures close to this date that is isn't their next/previous team
4.6.10 check the away club doesn't already have a match in the fixtures close to this date that is isn't their next/previous team
4.6.11 if you passed all the checks, add the fixture to the current date and move on to checking the next fixure + date combination.

Extra notes on the logic
* keep note of the number of dates tried, once we've tried 2 x as many dates as there are dates in the season, and not added a fixture to the calendar, reduce the near-fixtures window & ignore the rules around club matches on previous/next nights.
* similarly as we hit 3x, 4x and 5x of the dates reduce the near-fixtures window further
* after 5x halt the fixture generation and tell me what's left so that i can fit them in manually. 

*/ 

var request = require('request');
 
const xmasDate = new Date(2025,11,25)
const easterDate = new Date(2026,3,5)
const seasonStartDate = new Date(2025,8,1)
const seasonEndDate = new Date(2026,5,1)
const interClubDate = new Date (2025,10,1)
const seasonLength = Math.round((seasonEndDate.getTime() - seasonStartDate.getTime())/(1000*3600*24))
// console.log(seasonLength)

/* console.log("season start date" + seasonStartDate)
console.log("season xmas date" + xmasDate)
console.log("season easter date" + easterDate)
console.log("season end date" + seasonEndDate) */

function shuffle(array) {
    var currentIndex = array.length, temporaryValue, randomIndex;
    while (0 !== currentIndex) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
    }
  
    return array;
}

var nearEaster = function(currentDate){
    var easterBreakStart = new Date(+easterDate)
    var easterBreakEnd = new Date(+easterDate)
    easterBreakStart.setDate(easterDate.getDate() -4)
    easterBreakEnd.setDate(easterDate.getDate() +2)
    if (currentDate > easterBreakStart && currentDate < easterBreakEnd) {
        return true;
    }
    else{
        return false;
    }
}

var nearXmas = function(currentDate){
    
    var xmasBreakStart = new Date(+xmasDate)
    xmasBreakStart.setDate(xmasDate.getDate() - xmasDate.getDay())
    var xmasBreakEnd = new Date(+xmasBreakStart)
    xmasBreakEnd.setDate(xmasBreakStart.getDate() + 14);    
    if (currentDate >= xmasBreakStart && currentDate <= xmasBreakEnd) {
        return true;
    }
    else{
        return false;
    }
}

var islewisShieldWeek = function(currentDate) {

    var xmasBreakStart = new Date(+xmasDate)
    xmasBreakStart.setDate(xmasDate.getDate() - xmasDate.getDay())
    var xmasBreakEnd = new Date(+xmasBreakStart)
    xmasBreakEnd.setDate(xmasBreakStart.getDate() + 14);
    var lewisShieldBreak1Start = new Date(+xmasBreakEnd)
    var lewisShieldBreak1End = new Date(+lewisShieldBreak1Start)
    lewisShieldBreak1End.setDate(lewisShieldBreak1Start.getDate() + 21)
    var lewisShieldBreak2Start = new Date(+lewisShieldBreak1End)
    lewisShieldBreak2Start.setDate(lewisShieldBreak1End.getDate()+21)
    var lewisShieldBreak2End = new Date(+lewisShieldBreak2Start)
    lewisShieldBreak2End.setDate(lewisShieldBreak2Start.getDate()+14)
    var easterBreakStart = new Date(+easterDate)
    var easterBreakEnd = new Date(+easterDate)
    easterBreakStart.setDate(easterDate.getDate() -7)
    easterBreakEnd.setDate(easterDate.getDate() +7)
    if (seasonEndDate - easterBreakEnd < (14 * 86400000)){
        var lewisShieldBreak3Start = new Date(+easterBreakStart)
        lewisShieldBreak3Start.setDate(easterBreakStart.getDate() - 14)
    }
    else{
        var lewisShieldBreak3Start = new Date(+easterBreakEnd)
    }
    var lewisShieldBreak3End = new Date(+lewisShieldBreak3Start)
    lewisShieldBreak3End.setDate(lewisShieldBreak3Start.getDate() +14)
    // console.log(lewisShieldBreak3Start + " to " + lewisShieldBreak3End)

    if ((currentDate > lewisShieldBreak1Start && currentDate < lewisShieldBreak1End) || (currentDate > lewisShieldBreak2Start && currentDate < lewisShieldBreak2End) || (currentDate > lewisShieldBreak3Start && currentDate < lewisShieldBreak3End)){
        return true
    }
    else {
        return false
    }
}

let datesCount = 0
let cycles = 1
let prevcycles = 1

var randomDate = function(start, end) {
    if (cycles <= 3){
        end = end - (30 * (24 * 3600 * 1000))
    }
    var date = new Date(+start + Math.random() * (end - start));
    date.setUTCHours(0,0,0,0)
    datesCount++
    if (cycles != prevcycles && typeof prevcycles !== 'undefined'){
        console.log(prevcycles)
    }
    prevcycles = cycles
    return date;
  }

  var endFixtureLoop = function (fixturesCollection){
    // console.log(datesCount)
    if (datesCount % 273 == 0 && datesCount > 272 ){
        console.log(new Date())
        console.log("cycles: "+ (datesCount/273))
        console.log("fixturesRemaining: "+ fixturesCollection.length)
    }
    if (fixturesCollection.length < 1){
        return false
    }
    else {
        if (datesCount >= (5 * seasonLength)){
            return false
        }
        else {
            return true
        }
    }
}

var nearFixtures = function(fixtures, date){
    if (datesCount % 273 == 0 && datesCount > 272 ){
        cycles = datesCount/273
    }
    else {
        cycles = 1
    }
    let twoDaysBefore = Date.parse(date) - ((3/cycles) * 1000 * 3600 * 24)
    let twoDaysAfter = Date.parse(date) + ((3/cycles) * 1000 * 3600 * 24)
    let filteredFixtures = fixtures.filter(row => ((Date.parse(row.date) > twoDaysBefore)&&(Date.parse(row.date) < twoDaysAfter)))
    let justFixture = filteredFixtures.reduce((row,newArray) => [...row,newArray.fixtures],[]).flat()
    return justFixture
}

exports.genFixtures = function(req,res){
    console.log(new Date())
    var tameside = {
        divisions:[{
            name:"Division 1",
            teams:[
  {
    "club": "Manchester Edgeley",
    "name": "Manchester Edgeley A",
    "homeNight": "Monday",
    "teamindex": 1
  },
  {
    "club": "GHAP",
    "name": "GHAP A",
    "homeNight": "Tuesday",
    "teamindex": 1
  },
  {
    "club": "Manchester Edgeley",
    "name": "Manchester Edgeley B",
    "homeNight": "Monday",
    "teamindex": 2
  },
  {
    "club": "Shell",
    "name": "Shell A",
    "homeNight": "Wednesday",
    "teamindex": 1
  },
  {
    "club": "College Green",
    "name": "College Green A",
    "homeNight": "Thursday",
    "teamindex": 1
  },
  {
    "club": "GHAP",
    "name": "GHAP B",
    "homeNight": "Monday",
    "teamindex": 2
  },
  {
    "club": "Hyde High",
    "name": "Hyde High A",
    "homeNight": "Wednesday",
    "teamindex": 1
  },
  {
    "club": "Medlock",
    "name": "Medlock A",
    "homeNight": "Thursday",
    "teamindex": 1
  },
  {
    "club": "Hyde High",
    "name": "Hyde High B",
    "homeNight": "Wednesday",
    "teamindex": 2
  },
  {
    "club": "Aerospace",
    "name": "Aerospace A",
    "homeNight": "Tuesday",
    "teamindex": 1
  }
]
        },
        {
            name:"Division 2",
            teams:[
  {
    "club": "Manor",
    "name": "Manor A",
    "homeNight": "Tuesday",
    "teamindex": 1
  },
  {
    "club": "Aerospace",
    "name": "Aerospace B",
    "homeNight": "Tuesday",
    "teamindex": 2
  },
  {
    "club": "College Green",
    "name": "College Green B",
    "homeNight": "Thursday",
    "teamindex": 2
  },
  {
    "club": "Mellor",
    "name": "Mellor A",
    "homeNight": "Tuesday",
    "teamindex": 1
  },
  {
    "club": "Hyde High",
    "name": "Hyde High C",
    "homeNight": "Wednesday",
    "teamindex": 3
  },
  {
    "club": "Manor",
    "name": "Manor B",
    "homeNight": "Tuesday",
    "teamindex": 2
  },
  {
    "club": "Mellor",
    "name": "Mellor B",
    "homeNight": "Tuesday",
    "teamindex": 2
  },
  {
    "club": "Disley",
    "name": "Disley A",
    "homeNight": "Wednesday",
    "teamindex": 1
  },
  {
    "club": "Alderley Park",
    "name": "Alderley Park A",
    "homeNight": "Wednesday",
    "teamindex": 1
  },
  {
    "club": "Syddal Park",
    "name": "Syddal Park A",
    "homeNight": "Sunday",
    "teamindex": 1
  }
]
        }]
}
    var stockport = {
        divisions:[
            {
                name:"Premier",
                teams:[
                    {
                        "club": "Racketeer",
                        "name": "Racketeers A",
                        "homeNight": "Monday",
                        "teamindex":1
                    },
                    {
                        "club": "Shell",
                        "name": "Shell A",
                        "homeNight": "Wednesday",
                        "teamindex":1
                    },
                    {
                        "club": "Syddal Park",
                        "name": "Syddal Park A",
                        "homeNight": "Sunday",
                        "teamindex":1
                    },
                    {
                        "club": "Racketeer",
                        "name": "Racketeers B",
                        "homeNight": "Monday",
                        "teamindex":2
                    },
                    {
                        "club": "Macclesfield",
                        "name": "Macclesfield A",
                        "homeNight": "Monday",
                        "teamindex":1
                    },
                    {
                        "club": "Parrs Wood",
                        "name": "Parrswood A",
                        "homeNight": "Tuesday",
                        "teamindex":1
                    },
                    {
                        "club": "Alderley Park",
                        "name": "Alderley Park A",
                        "homeNight": "Tuesday",
                        "teamindex":1
                    },
                    {
                        "club": "Syddal Park",
                        "name": "Syddal Park B",
                        "homeNight": "Sunday",
                        "teamindex":2
                    },
                    {
                        "club": "Shell",
                        "name": "Shell B",
                        "homeNight": "Wednesday",
                        "teamindex":2
                    }
                  ]
            },
            {
                name:"Division 1",
                teams:[
                  {
                    "club": "Canute",
                    "name": "Canute A",
                    "homeNight": "Thursday",
                    "teamindex":1
                },
                {
                    "club": "Disley",
                    "name": "Disley A",
                    "homeNight": "Wednesday",
                    "teamindex":1
                },
                {
                    "club": "G.H.A.P",
                    "name": "GHAP A",
                    "homeNight": "Tuesday",
                    "teamindex":1
                },
                {
                    "club": "College Green",
                    "name": "College Green B",
                    "homeNight": "Wednesday",
                    "teamindex":2
                },
                {
                    "club": "College Green",
                    "name": "College Green A",
                    "homeNight": "Wednesday",
                    "teamindex":1
                },
                {
                    "club": "Parrs Wood",
                    "name": "Parrswood B",
                    "homeNight": "Tuesday",
                    "teamindex":2
                },
                {
                    "club": "Syddal Park",
                    "name": "Syddal Park C",
                    "homeNight": "Sunday",
                    "teamindex":3
                },
                {
                    "club": "David Lloyd",
                    "name": "David Lloyd A",
                    "homeNight": "Friday",
                    "teamindex":1
                },
                {
                    "club": "Dome",
                    "name": "Dome A",
                    "homeNight": "Wednesday",
                    "teamindex":1
                }
                ]
            },
            {
                name:"Division 2",
                teams:[
                    
                    
                  {
                    "club": "Shell",
                    "name": "Shell C",
                    "homeNight": "Wednesday",
                    "teamindex":3
                },
                {
                    "club": "Mellor",
                    "name": "Mellor A",
                    "homeNight": "Thursday",
                    "teamindex":1
                },
                {
                    "club": "Alderley Park",
                    "name": "Alderley Park B",
                    "homeNight": "Tuesday",
                    "teamindex":2
                },
                {
                    "club": "Aerospace",
                    "name": "Aerospace A",
                    "homeNight": "Tuesday",
                    "teamindex":1
                },
                {
                    "club": "Cheadle Hulme",
                    "name": "Cheadle Hulme A",
                    "homeNight": "Wednesday",
                    "teamindex":1
                },
                {
                    "club": "Disley",
                    "name": "Disley B",
                    "homeNight": "Tuesday",
                    "teamindex":2
                },
                {
                    "club": "Manor",
                    "name": "Manor A",
                    "homeNight": "Tuesday",
                    "teamindex":1
                },
                {
                    "club": "College Green",
                    "name": "College Green C",
                    "homeNight": "Wednesday",
                    "teamindex":3
                },
                {
                    "club": "Dome",
                    "name": "Dome B",
                    "homeNight": "Wednesday",
                    "teamindex":2
                }
                  ]
            },
            {
                name:"Division 3",
                teams:[
                  {
                    "club": "Macclesfield",
                    "name": "Macclesfield B",
                    "homeNight": "Monday",
                    "teamindex":2
                },
                {
                    "club": "Alderley Park",
                    "name": "Alderley Park C",
                    "homeNight": "Tuesday",
                    "teamindex":2
                },
                {
                    "club": "Mellor",
                    "name": "Mellor B",
                    "homeNight": "Thursday",
                    "teamindex":2
                },
                {
                    "club": "Parrs Wood",
                    "name": "Parrswood C",
                    "homeNight": "Tuesday",
                    "teamindex":3
                },
                {
                    "club": "Tatton",
                    "name": "Tatton A",
                    "homeNight": "Tuesday",
                    "teamindex":1
                },
                {
                    "club": "College Green",
                    "name": "College Green D",
                    "homeNight": "Wednesday",
                    "teamindex":4
                },
                {
                    "club": "Cheadle Hulme",
                    "name": "Cheadle Hulme B",
                    "homeNight": "Wednesday",
                    "teamindex":2
                },
                {
                    "club": "Mellor",
                    "name": "Mellor C",
                    "homeNight": "Thursday",
                    "teamindex":3
                },
                {
                    "club": "Manor",
                    "name": "Manor B",
                    "homeNight": "Tuesday",
                    "teamindex":2
                }
                  ]
            }
        ]
    }
    var fixturesCollection = []
    tameside.divisions.forEach(function(e){
        e.teams.forEach(function(i){
            e.teams.forEach(function(j){
                if (i.name != j.name){
                    //console.log(i.name + " vs " + j.name)
                    var currentFixture = {}
                    currentFixture.division = e.name
                    currentFixture.homeTeam = i.name
                    currentFixture.hometeamindex = i.teamindex
                    currentFixture.awayTeam = j.name
                    currentFixture.awayteamindex = j.teamindex
                    currentFixture.homeClub = i.club
                    currentFixture.awayClub = j.club
                    currentFixture.division = e.name
                    currentFixture.day = i.homeNight
                    fixturesCollection.push(currentFixture)
                }
            })
        })
        //console.log(fixturesCollection)
    })
    fixturesCollection = shuffle(fixturesCollection);

    var sameClub = fixturesCollection.filter(k => (k.homeClub == k.awayClub))
    // console.log(sameClub);
    var sameClubFixtureCount = sameClub.length
    // console.log(sameClubFixtureCount)
    for (var i=0; i < sameClubFixtureCount; i++){
        fixturesCollection.splice(fixturesCollection.findIndex(k => (k.homeClub == k.awayClub)),1)
        fixturesCollection.push(sameClub[i])
    }

    // console.log(fixturesCollection.length)
    // console.log(fixturesCollection)


    var seasonCalendar = []
    function dotw(dayIndex) {
        return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dayIndex];
    }

    // var seasonStartDate = new Date(2019,08,01)
    // var seasonEndDate = new Date(2020,03,30)
    
    //console.log("season Start Date:" + seasonStartDate)
    //console.log("current Date:" + currentDate)
    // var debugArray = []
    // var debugObject = []
    while (endFixtureLoop(fixturesCollection)) {
        var currentDate = randomDate(seasonStartDate,seasonEndDate)
        // debugObject = {}
        // debugObject.currentDate = currentDate
        // console.log("current Date:" + currentDate)
        // console.log("dates Counted" + datesCount)
        //console.log("\ninside while loop")
        //console.log("season start date" + seasonStartDate)
        //console.log("season xmas date" + xmasDate)
        //console.log("season easter date" + easterDate)
        //console.log("season end date" + seasonEndDate)
        //console.log(currentDate)
        var currentSeasonEntry = {}
        var prevSeasonEntry = {}
        prevSeasonEntry.fixtures = []
        currentSeasonEntry.fixtures = []
        currentSeasonEntry.date = new Date(+currentDate)
        currentSeasonEntry.shortDate = currentDate.getDate() + "/" + (currentDate.getMonth()+1) + "/" + currentDate.getFullYear()
        currentSeasonEntry.day = currentDate.getDay()
        var closeFixtures = nearFixtures(seasonCalendar,currentDate)
        // debugObject.originalcloseFixtures = closeFixtures
        if (nearEaster(currentDate)||nearXmas(currentDate)||islewisShieldWeek(currentDate)){
            if ((currentDate.getDay()==0)||(currentDate.getDay()==6)){
                currentSeasonEntry.weekend = true
                //console.log(currentDate + ": this date is a weekend\n")
            }
            else {
                currentSeasonEntry.weekend = false
            }
            if (nearEaster(currentDate)){
                currentSeasonEntry.easter = true
                //console.log(currentDate + ": this date is near Easter\n")
            }
            else {
                currentSeasonEntry.easter = false
            }
            if (nearXmas(currentDate)){
                currentSeasonEntry.xmas = true
                //console.log(currentDate + ": this date is near Xmas\n")
            }
            else {
                currentSeasonEntry.xmas = false
            }
            if (islewisShieldWeek(currentDate)){
                currentSeasonEntry.lewisshield = true
                //console.log(currentDate + ": this date is a Lewis Shield Week\n")
            }
            else {
                currentSeasonEntry.lewisshield = false
            }
            
            // currentDate.setDate(currentDate.getDate() + 1);
            seasonCalendar.push(currentSeasonEntry)
        }
        else {
            
            //console.log(currentDate + "\n")
            // can i add a fixture
            var index = fixturesCollection.length
            while (index >= 0) {
                if (seasonCalendar.findIndex(k => Date.parse(k.date) == Date.parse(currentDate)) >= 0 && typeof currentSeasonEntry.fixtures !== 'undefined'){
                    
                    var tempArray = seasonCalendar[seasonCalendar.findIndex(k => Date.parse(k.date) == Date.parse(currentDate))].fixtures.concat(currentSeasonEntry.fixtures)
                    prevSeasonEntry = {}
                    prevSeasonEntry.fixtures = tempArray
                    var jsonObject = prevSeasonEntry.fixtures.map(JSON.stringify);
                    var uniqueSet = new Set(jsonObject);
                    var uniqueArray = Array.from(uniqueSet).map(JSON.parse);
                    

                }
                var closeFixtures = nearFixtures(seasonCalendar,currentDate)
                //console.log("close fixtures")
                //console.log(closeFixtures)
                // debugObject.fixtureLoopCloseFixtures = closeFixtures
                if (typeof fixturesCollection[index] !== 'undefined') {
                    //console.log("undefined check:" + fixturesCollection[index]['day'])      
                    if ((fixturesCollection[index].homeClub == fixturesCollection[index].awayClub && Date.parse(currentDate) < Date.parse(interClubDate))||fixturesCollection[index].homeClub != fixturesCollection[index].awayClub) {              
                        if (fixturesCollection[index]['day'] == dotw(currentDate.getDay())) {  // check if the current fixture day matches the currentDate day (so that i can only add fixtures that match days)
                            //console.log("check if the fixture day matches the current day")
                            // console.log(JSON.stringify(currentSeasonEntry.fixtures))
                            if ((typeof currentSeasonEntry.fixtures !== 'undefined') && currentSeasonEntry.fixtures.findIndex(k => (k.homeTeam == fixturesCollection[index].homeTeam)||(k.homeTeam == fixturesCollection[index].awayTeam)) == -1){
                                if ((typeof prevSeasonEntry.fixtures !== 'undefined') && prevSeasonEntry.fixtures.findIndex(k => (k.homeTeam == fixturesCollection[index].homeTeam)||(k.homeTeam == fixturesCollection[index].awayTeam)) == -1){                            
                                    if ((closeFixtures.findIndex(k => (k.homeTeam == fixturesCollection[index].homeTeam)||(k.homeTeam == fixturesCollection[index].awayTeam)) == -1)){
                                    // console.log("check if the current Date home team matches the fixture home team or away team")
                                        if ((currentSeasonEntry.fixtures.findIndex(k => (k.awayTeam == fixturesCollection[index].awayTeam)||(k.awayTeam == fixturesCollection[index].homeTeam)) == -1)&&(prevSeasonEntry.fixtures.findIndex(k => (k.awayTeam == fixturesCollection[index].awayTeam)||(k.awayTeam == fixturesCollection[index].homeTeam)) == -1)){
                                            if ((closeFixtures.findIndex(k => (k.awayTeam == fixturesCollection[index].awayTeam)||(k.awayTeam == fixturesCollection[index].homeTeam)) == -1)){
                                            // console.log("check if the current Date away team matches the fixture home team or away team")
                                                if ((currentSeasonEntry.fixtures.findIndex(k => 
                                                ((k.homeClub == fixturesCollection[index].homeClub)&&(Math.abs(k.hometeamindex - fixturesCollection[index].hometeamindex) < 2 ))||((k.homeClub == fixturesCollection[index].awayClub)&&(Math.abs(k.hometeamindex - fixturesCollection[index].awayteamindex) < 2 ))||((k.awayClub == fixturesCollection[index].awayClub)&&(Math.abs(k.awayteamindex - fixturesCollection[index].awayteamindex) < 2 ))||((k.awayClub == fixturesCollection[index].homeClub)&&(Math.abs(k.awayteamindex - fixturesCollection[index].hometeamindex) < 2 ))) == -1)&&(prevSeasonEntry.fixtures.findIndex(k => 
                                                    ((k.homeClub == fixturesCollection[index].homeClub)&&(Math.abs(k.hometeamindex - fixturesCollection[index].hometeamindex) < 2 ))||((k.homeClub == fixturesCollection[index].awayClub)&&(Math.abs(k.hometeamindex - fixturesCollection[index].awayteamindex) < 2 ))||((k.awayClub == fixturesCollection[index].awayClub)&&(Math.abs(k.awayteamindex - fixturesCollection[index].awayteamindex) < 2 ))||((k.awayClub == fixturesCollection[index].homeClub)&&(Math.abs(k.awayteamindex - fixturesCollection[index].hometeamindex) < 2 ))) == -1)) {
                                                    // console.log("check if the current Date club already has a match for that club for the next team")
                                                    if ((closeFixtures.findIndex(k => 
                                                    ((k.homeClub == fixturesCollection[index].homeClub)&&(Math.abs(k.hometeamindex - fixturesCollection[index].hometeamindex) < 2 ))||((k.homeClub == fixturesCollection[index].awayClub)&&(Math.abs(k.hometeamindex - fixturesCollection[index].awayteamindex) < 2 ))) == -1)||datesCount > (2*seasonLength)) {
                                                    //console.log("check if the current Date home club matches the fixture home club or away club")
                                                        if ((closeFixtures.findIndex(k => ((k.awayClub == fixturesCollection[index].awayClub)&&(Math.abs(k.awayteamindex - fixturesCollection[index].awayteamindex) < 2 ))||(((k.awayClub == fixturesCollection[index].homeClub))&&(Math.abs(k.awayteamindex - fixturesCollection[index].hometeamindex) < 2))) == -1 )||datesCount > (2*seasonLength)) {
                                                        // console.log("check if the current Date away club matches the fixture home club or away club")
                                                        
                                                        // if (currSeasonCalPos > 0){
                                                            // if (seasonCalendar[currSeasonCalPos - 1].fixtures.findIndex(k => (k.homeTeam == fixturesCollection[index].homeTeam)||(k.homeTeam == fixturesCollection[index].awayTeam)) == -1){
                                                                //console.log("yesterdays home team matches fixture home team or away team")
                                                                // if (seasonCalendar[currSeasonCalPos - 1].fixtures.findIndex(k => (k.awayTeam == fixturesCollection[index].awayTeam)||(k.awayTeam == fixturesCollection[index].homeTeam)) == -1){
                                                                    //console.log("yesterdays away team matches fixture home team or away team")
                                                                    //if (seasonCalendar[currSeasonCalPos - 1].fixtures.findIndex(k => ((k.homeClub == fixturesCollection[index].homeClub)&&(Math.abs(k.hometeamindex - fixturesCollection[index].hometeamindex) < 2 ))||((k.homeClub == fixturesCollection[index].awayClub)&&(Math.abs(k.hometeamindex - fixturesCollection[index].awayteamindex) < 2 ))) == -1){
                                                                        //console.log("yesterdays home club matches fixture home club or away club")
                                                                        // if (seasonCalendar[currSeasonCalPos - 1].fixtures.findIndex(k => ((k.awayClub == fixturesCollection[index].awayClub)&&(Math.abs(k.awayteamindex - fixturesCollection[index].awayteamindex) < 2 ))||((k.awayClub == fixturesCollection[index].homeClub)&&(Math.abs(k.awayteamindex - fixturesCollection[index].hometeamindex) < 2 ))) == -1){
                                                                            // if (currSeasonCalPos > 1){
                                                                                //if (seasonCalendar[currSeasonCalPos - 2].fixtures.findIndex(k => (k.homeTeam == fixturesCollection[index].homeTeam)||(k.homeTeam == fixturesCollection[index].awayTeam)) == -1){
                                                                                    //console.log("yesterdays home team matches fixture home team or away team")
                                                                                    //if (seasonCalendar[currSeasonCalPos - 2].fixtures.findIndex(k => (k.awayTeam == fixturesCollection[index].awayTeam)||(k.awayTeam == fixturesCollection[index].homeTeam)) == -1){
                                                                                        //if (currSeasonCalPos > 2){
                                                                                            //if (seasonCalendar[currSeasonCalPos - 3].fixtures.findIndex(k => (k.homeTeam == fixturesCollection[index].homeTeam)||(k.homeTeam == fixturesCollection[index].awayTeam)) == -1){
                                                                                                //console.log("yesterdays home team matches fixture home team or away team")
                                                                                                //if (seasonCalendar[currSeasonCalPos - 3].fixtures.findIndex(k => (k.awayTeam == fixturesCollection[index].awayTeam)||(k.awayTeam == fixturesCollection[index].homeTeam)) == -1){
                                                                                                    if (currentSeasonEntry.fixtures.length < 10){
                                                                                                        //console.log("yesterdays away club matches fixture home club or away club")
                                                                                                        //console.log(dotw(currentDate.getDay()) + " " + currentDate)
                                                                                                        //console.log ("Fixture: " + fixturesCollection[index].homeTeam + " vs " + fixturesCollection[index].awayTeam + "\n")
                                                                                                        currentSeasonEntry.fixtures.push({"homeTeam":fixturesCollection[index].homeTeam,"hometeamindex":fixturesCollection[index].hometeamindex,"homeClub":fixturesCollection[index].homeClub,"awayTeam":fixturesCollection[index].awayTeam,"awayteamindex":fixturesCollection[index].awayteamindex,"awayClub":fixturesCollection[index].awayClub,"division":fixturesCollection[index].division})
                                                                                                        //console.log("-----")
                                                                                                        //console.log("current Season fixtures after adding current Fixture")
                                                                                                        //console.log(currentSeasonEntry.fixtures)
                                                                                                        //console.log(currentSeasonEntry.date + " -  "+ currentDate)
                                                                                                        //console.log(closeFixtures.fixtures)
                                                                                                        //console.log(fixturesCollection[index]['day'] + " -  "+ dotw(currentDate.getDay()))
                                                                                                        //console.log(fixturesCollection[index].homeTeam + " - " + fixturesCollection[index].awayTeam)
                                                                                                        //console.log(fixturesCollection[index].homeClub + " - " + fixturesCollection[index].awayClub)
                                                                                                        fixturesCollection.splice(index,1) // remove the fixture from the collection so that we don't add it to subsequent days
                                                                                                        
                                                                                                        datesCount = 0;
                                                                                                    }
                                                                                                //}
                                                                                            //}

                                                                                        //}
                                                                                    //}
                                                                                //}
                                                                            //}    
                                                                        //}
                                                                    //}
                                                                //}
                                                            // }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                //team has fixture within 3 days either side of currentDate  
                index -= 1
            } 
            currentSeasonEntry.lewisshield = false
            currentSeasonEntry.weekend = false
            currentSeasonEntry.xmas = false
            currentSeasonEntry.easter = false
            
            
            seasonCalendar.push(currentSeasonEntry)
            // debugObject.seasonEntry = currentSeasonEntry
            // currentDate.setDate(currentDate.getDate() + 1);
            //console.log(currentDate)
        }
        // debugArray.push(debugObject)
    }
    // console.log(fixturesCollection)
    console.log(seasonCalendar)

    let justFixtures = seasonCalendar.filter(row => (typeof row.fixtures !== 'undefined' && row.fixtures.length > 0))
    let divOneFixtures = []
    let divTwoFixtures = []
    let divThreeFixtures = []
    for (row of justFixtures) {
        for (fix of row.fixtures){
            let fixRow = {}
            fixRow.date = row.shortDate.replaceAll(/([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})/g,"$2-$1-$3")
            fixRow.homeTeam = fix.homeTeam
            fixRow.awayTeam = fix.awayTeam
            //console.log(fix.Division)
            if (fix.division == 'Division 1'){
                divOneFixtures.push(fixRow)
            }
            else if (fix.division == 'Division 2'){
                divTwoFixtures.push(fixRow)
            }
            else {
                divThreeFixtures.push(fixRow)
            }
            
        }
    }
    // debugArray.sort((a,b) => {return new Date(b.currentDate) - new Date(a.currentDate);})

    res.render('tameside-fixtures', {
        static_path: '/static',
        pageTitle : "Scorecard Info",
        pageDescription : "View scorecard for this match",
        result: "Some Jibber Jabber about processing fixture dates",
        //seasonCalendar: JSON.stringify(seasonCalendar,null,'\t'),
        //fixturesCollection: JSON.stringify(fixturesCollection,null,'\t'),
        fixturesOutput:seasonCalendar,
        divOneFixtures:JSON.stringify(divOneFixtures),
        divOneTeams:JSON.stringify(tameside.divisions[0].teams),
        divTwoFixtures:JSON.stringify(divTwoFixtures),
        divTwoTeams:JSON.stringify(tameside.divisions[1].teams),
        //divThreeFixtures:JSON.stringify(divThreeFixtures),
        //divThreeTeams:JSON.stringify(tameside.divisions[2].teams),
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
        // debugArray:JSON.stringify(debugArray)
    });
}