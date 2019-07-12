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

*/ 

var request = require('request');

/* var options = { method: 'GET',
  url: 'https://calendarific.com/api/v2/holidays',
  qs: 
   { api_key: 'e40447584a0fc433f2a4b3f2b3a761cf51b24d42',
     country: 'GB',
     year: '2019',
     type: 'Observance' } };

request(options, function (error, response, body) {
  if (error) throw new Error(error);
  console.log(body);

}); */
 
const xmasDate = new Date(2019,11,25)
const easterDate = new Date(2020,03,12)
const seasonStartDate = new Date(2019,08,15)
const seasonEndDate = new Date(2020,04,30)

console.log("season start date" + seasonStartDate)
console.log("season xmas date" + xmasDate)
console.log("season easter date" + easterDate)
console.log("season end date" + seasonEndDate)

function shuffle(array) {
    var currentIndex = array.length, temporaryValue, randomIndex;
  
    // While there remain elements to shuffle...
    while (0 !== currentIndex) {
  
      // Pick a remaining element...
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;
  
      // And swap it with the current element.
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
    }
  
    return array;
}

var nearEaster = function(currentDate){
    // var easterDate = new Date(2020, 03, 12)
    //console.log("Easter: " + easterDate)
    var easterBreakStart = new Date(+easterDate)
    var easterBreakEnd = new Date(+easterDate)
    easterBreakStart.setDate(easterDate.getDate() -7)
    //console.log("Easter Start:" + easterBreakStart)
    easterBreakEnd.setDate(easterDate.getDate() +7)
    //console.log("Easter End:" + easterBreakEnd)
    //console.log("\nNear Easter function")
    //console.log("season start date" + seasonStartDate)
    //console.log("season xmas date" + xmasDate)
    //console.log("season easter date" + easterDate)
    //console.log("season end date" + seasonEndDate)
    if (currentDate > easterBreakStart && currentDate < easterBreakEnd) {
        return true;
    }
    else{
        return false;
    }
}

var nearXmas = function(currentDate){
    
    //console.log("\nNear XMAS function")
    //console.log("season start date" + seasonStartDate)
    //console.log("season xmas date" + xmasDate)
    //console.log("season easter date" + easterDate)
    //console.log("season end date" + seasonEndDate)
    //var xmasDate = new Date(2019, 11, 25)
    //console.log("Xmas: " + xmasDate)
    var xmasBreakStart = new Date(+xmasDate)
    xmasBreakStart.setDate(xmasDate.getDate() - xmasDate.getDay())
    //console.log("Xmas Start: " + xmasBreakStart)
    var xmasBreakEnd = new Date(+xmasBreakStart)
    xmasBreakEnd.setDate(xmasBreakStart.getDate() + 14);
    //console.log("Xmas End: " + xmasBreakEnd)
    
    if (currentDate >= xmasBreakStart && currentDate <= xmasBreakEnd) {
        return true;
    }
    else{
        return false;
    }
}

var islewisShieldWeek =function(currentDate) {

    //console.log("\nNear LewisShield function")
    //console.log("season start date" + seasonStartDate)
    //console.log("season xmas date" + xmasDate)
    //console.log("season easter date" + easterDate)
    //console.log("season end date" + seasonEndDate)
    //var seasonEndDate = new Date(2020,04,30)
    //var xmasDate = new Date(2019, 11, 25)
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

    if ((currentDate > lewisShieldBreak1Start && currentDate < lewisShieldBreak1End) || (currentDate > lewisShieldBreak2Start && currentDate < lewisShieldBreak2End) || (currentDate > lewisShieldBreak3Start && currentDate < lewisShieldBreak3End)){
        return true
    }
    else {
        return false
    }
}

var findTeamName = function(fixture){
    return 
}


exports.genFixtures = function(req,res){
    var tameside = {
        divisions:[{
            name:"Division 1",
            teams:[
                {
                    club: "Hyde High",
                    name: "Hyde High A",
                    homeNight: "Wednesday"
                  },
                  {
                    club: "Shell",
                    name: "Shell",
                    homeNight: "Wednesday"
                  },
                  {
                    club: "GHAP",
                    name: "GHAP",
                    homeNight: "Tuesday"
                  },
                  {
                    club: "Hyde High",
                    name: "Hyde High B",
                    homeNight: "Wednesday"
                  },
                  {
                    club: "Lambs",
                    name: "Lambs",
                    homeNight: "Tuesday"
                  },
                  {
                    club: "Aerospace",
                    name: "Aerospace A",
                    homeNight: "Tuesday"
                  }
            ]
        },
        {
            name:"Division 2",
            teams:[
                {
                    club: "Mellor",
                    name: "Mellor B",
                    homeNight: "Tuesday"
                  },
                  {
                    club: "Manor",
                    name: "Manor A",
                    homeNight: "Tuesday"
                  },
                  {
                    club: "Medlock",
                    name: "Medlock A",
                    homeNight: "Thursday"
                  },
                  {
                    club: "Hyde High",
                    name: "Hyde High C",
                    homeNight: "Wednesday"
                  },
                  {
                    club: "College Green",
                    name: "College Green",
                    homeNight: "Thursday"
                  },
                  {
                    club: "Mellor",
                    name: "Mellor A",
                    homeNight: "Tuesday"
                  }
            ]
        }]
    };
    var stockport = {
        divisions:[
            {
                name:"Premier",
                teams:[
                    {
                      club: "Racketeer",
                      name: "Racketeers A",
                      homeNight: "Monday"
                    },
                    {
                      club: "Macclesfield",
                      name: "Macclesfield A",
                      homeNight: "Monday"
                    },
                    {
                      club: "Racketeer",
                      name: "Racketeers B",
                      homeNight: "Monday"
                    },
                    {
                      club: "Carrington",
                      name: "Carrington A",
                      homeNight: "Monday"
                    },
                    {
                      club: "Syddal Park",
                      name: "Syddal Park A",
                      homeNight: "Sunday"
                    },
                    {
                      club: "Syddal Park",
                      name: "Syddal Park B",
                      homeNight: "Sunday"
                    },
                    {
                      club: "Alderley Park",
                      name: "Alderley Park A",
                      homeNight: "Tuesday"
                    },
                    {
                      club: "Shell",
                      name: "Shell A",
                      homeNight: "Wednesday"
                    },
                    {
                      club: "Canute",
                      name: "Canute A",
                      homeNight: "Wednesday"
                    },
                    {
                      club: "Disley",
                      name: "Disley A",
                      homeNight: "Wednesday"
                    }
                  ]
            },
            {
                name:"Division 1",
                teams:[
                    {
                        club: "David Lloyd",
                        name: "David Lloyd A",
                        homeNight: "Friday"
                      },
                      {
                        club: "College Green",
                        name: "College Green A",
                        homeNight: "Wednesday"
                      },
                      {
                        club: "Shell",
                        name: "Shell B",
                        homeNight: "Wednesday"
                      },
                      {
                        club: "Parrs Wood",
                        name: "Parrswood B",
                        homeNight: "Tuesday"
                      },
                      {
                          club: "Altrincham Central",
                          name: "Altrincham Central",
                          homeNight: "Friday"
                        },
                        {
                          club: "Carrington",
                          name: "Carrington B",
                          homeNight: "Monday"
                        },
                        {
                          club: "Alderley Park",
                          name: "Alderley Park B",
                          homeNight: "Tuesday"
                        },
                        {
                          club: "G.H.A.P",
                          name: "GHAP A",
                          homeNight: "Tuesday"
                        },
                        {
                          club: "Parrs Wood",
                          name: "Parrswood A",
                          homeNight: "Tuesday"
                        }
                ]
            },
            {
                name:"Division 2",
                teams:[
                    
                    {
                      club: "Syddal Park C",
                      name: "Syddal Park C",
                      homeNight: "Sunday"
                    },
                    {
                      club: "Bramhall Village",
                      name: "Bramhall Village A",
                      homeNight: "Monday"
                    },
                    {
                      club: "Mellor",
                      name: "Mellor A",
                      homeNight: "Thursday"
                    },
                    {
                      club: "Manor",
                      name: "Manor A",
                      homeNight: "Tuesday"
                    },
                    {
                      club: "College Green",
                      name: "College Green B",
                      homeNight: "Wednesday"
                    },
                    {
                      club: "Shell C",
                      name: "Shell C",
                      homeNight: "Wednesday"
                    },
                    {
                      club: "G.H.A.P",
                      name: "GHAP B",
                      homeNight: "Tuesday"
                    },
                    {
                      club: "College Green C",
                      name: "College Green C",
                      homeNight: "Wednesday"
                    },
                    {
                      club: "C.A.P.",
                      name: "CAP A",
                      homeNight: "Wednesday"
                    }
                  ]
            },
            {
                name:"Division 3",
                teams:[
                    {
                      club: "Disley",
                      name: "Disley B",
                      homeNight: "Tuesday"
                    },
                    {
                      club: "Aerospace",
                      name: "Aerospace A",
                      homeNight: "Tuesday"
                    },
                    {
                      club: "Dome",
                      name: "Dome A",
                      homeNight: "Wednesday"
                    },
                    {
                      club: "Macclesfield",
                      name: "Macclesfield B",
                      homeNight: "Monday"
                    },
                    {
                      club: "New Mills",
                      name: "New Mills A",
                      homeNight: "Thursday"
                    },
                    {
                      club: "Manor",
                      name: "Manor B",
                      homeNight: "Tuesday"
                    },
                    {
                      club: "Parrs Wood C",
                      name: "Parrswood C",
                      homeNight: "Tuesday"
                    },
                    {
                        club: "Disley",
                        name: "Disley C",
                        homeNight: "Thursday"
                    },
                    {
                      club: "Mellor",
                      name: "Mellor B",
                      homeNight: "Thursday"
                    },
                    {
                        club: "Cheadle Hulme",
                        name: "Cheadle Hulme A",
                        homeNight: "Wednesday"
                    }
                  ]
            },
            {
                name:"Division 4",
                teams:[
                    
                    {
                      club: "Disley",
                      name: "Disley D",
                      homeNight: "Thursday"
                    },
                    {
                      club: "Tatton",
                      name: "Tatton A",
                      homeNight: "Sunday"
                    },
                    {
                      club: "Dome",
                      name: "Dome B",
                      homeNight: "Wednesday"
                    },
                    {
                      club: "Poynton",
                      name: "Poynton A",
                      homeNight: "Monday"
                    },
                    {
                      club: "Bramhall Village",
                      name: "Bramhall Village B",
                      homeNight: "Monday"
                    },
                    {
                      club: "Mellor",
                      name: "Mellor C",
                      homeNight: "Thursday"
                    },
                    {
                      club: "Manor C",
                      name: "Manor C",
                      homeNight: "Tuesday"
                    },
                    {
                      club: "Blue Triangle",
                      name: "Blue Triangle",
                      homeNight: "Wednesday"
                    },
                    {
                      club: "Cheadle Hulme",
                      name: "Cheadle Hulme B",
                      homeNight: "Wednesday"
                    }
                  ]
            }
        ]
    }
    var fixturesCollection = []
    stockport.divisions.forEach(function(e){
        e.teams.forEach(function(i){
            e.teams.forEach(function(j){
                if (i.name != j.name){
                    //console.log(i.name + " vs " + j.name)
                    var currentFixture = {}
                    currentFixture.division = e.name
                    currentFixture.homeTeam = i.name
                    currentFixture.awayTeam = j.name
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
    console.log(sameClub);
    var sameClubFixtureCount = sameClub.length
    console.log(sameClubFixtureCount)
    for (var i=0; i < sameClubFixtureCount; i++){
        fixturesCollection.splice(fixturesCollection.findIndex(k => (k.homeClub == k.awayClub)),1)
        fixturesCollection.push(sameClub[i])
    }

    
    console.log(fixturesCollection)


    var seasonCalendar = []
    function dotw(dayIndex) {
        return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dayIndex];
    }

    // var seasonStartDate = new Date(2019,08,01)
    // var seasonEndDate = new Date(2020,03,30)
    var currentDate = new Date(+seasonStartDate)
    //console.log("season Start Date:" + seasonStartDate)
    //console.log("current Date:" + currentDate)
    while (currentDate < seasonEndDate) {
        //console.log("\ninside while loop")
        //console.log("season start date" + seasonStartDate)
        //console.log("season xmas date" + xmasDate)
        //console.log("season easter date" + easterDate)
        //console.log("season end date" + seasonEndDate)
        //console.log(currentDate)
        var currentSeasonEntry = {}
        currentSeasonEntry.fixtures = []
        currentSeasonEntry.date = new Date(+currentDate)
        currentSeasonEntry.shortDate = currentDate.getDate() + "/" + (currentDate.getMonth()+1) + "/" + currentDate.getFullYear()
        currentSeasonEntry.day = currentDate.getDay()
        if (nearEaster(currentDate)||nearXmas(currentDate)){
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
            
            currentDate.setDate(currentDate.getDate() + 1);
            seasonCalendar.push(currentSeasonEntry)
        }
        else {
            //console.log(currentDate + "\n")
            // can i add a fixture
            var index = fixturesCollection.length
            while (index >= 0){
                if (typeof fixturesCollection[index] !== 'undefined') {
                    //console.log("undefined check:" + fixturesCollection[index]['day'])                    
                    if (fixturesCollection[index]['day'] == dotw(currentDate.getDay())) {  // check if the current fixture day matches the currentDate day (so that i can only add fixtures that match days)
                        //console.log("check if the fixture day matches the current day")
                        if (currentSeasonEntry.fixtures.findIndex(k => (k.homeTeam == fixturesCollection[index].homeTeam)||(k.homeTeam == fixturesCollection[index].awayTeam)) == -1){
                            //console.log("check if the current Date home team matches the fixture home team or away team")
                            if (currentSeasonEntry.fixtures.findIndex(k => (k.awayTeam == fixturesCollection[index].awayTeam)||(k.awayTeam == fixturesCollection[index].homeTeam)) == -1){
                                //console.log("check if the current Date away team matches the fixture home team or away team")
                                if (currentSeasonEntry.fixtures.findIndex(k => (k.homeClub == fixturesCollection[index].homeClub)||(k.homeClub == fixturesCollection[index].awayClub)) == -1){
                                    //console.log("check if the current Date home club matches the fixture home club or away club")
                                    if (currentSeasonEntry.fixtures.findIndex(k => (k.awayClub == fixturesCollection[index].awayClub)||(k.awayClub == fixturesCollection[index].homeClub)) == -1){
                                        //console.log("check if the current Date away club matches the fixture home club or away club")
                                        var currSeasonCalPos = seasonCalendar.length
                                        if (currSeasonCalPos > 0){
                                            if (seasonCalendar[currSeasonCalPos - 1].fixtures.findIndex(k => (k.homeTeam == fixturesCollection[index].homeTeam)||(k.homeTeam == fixturesCollection[index].awayTeam)) == -1){
                                                //console.log("yesterdays home team matches fixture home team or away team")
                                                if (seasonCalendar[currSeasonCalPos - 1].fixtures.findIndex(k => (k.awayTeam == fixturesCollection[index].awayTeam)||(k.awayTeam == fixturesCollection[index].homeTeam)) == -1){
                                                    //console.log("yesterdays away team matches fixture home team or away team")
                                                    //if (seasonCalendar[currSeasonCalPos - 1].fixtures.findIndex(k => (k.homeClub == fixturesCollection[index].homeClub)||(k.homeClub == fixturesCollection[index].awayClub)) == -1){
                                                        //console.log("yesterdays home club matches fixture home club or away club")
                                                        //if (seasonCalendar[currSeasonCalPos - 1].fixtures.findIndex(k => (k.awayClub == fixturesCollection[index].awayClub)||(k.awayClub == fixturesCollection[index].homeClub)) == -1){
                                                            if (currSeasonCalPos > 1){
                                                                if (seasonCalendar[currSeasonCalPos - 2].fixtures.findIndex(k => (k.homeTeam == fixturesCollection[index].homeTeam)||(k.homeTeam == fixturesCollection[index].awayTeam)) == -1){
                                                                    //console.log("yesterdays home team matches fixture home team or away team")
                                                                    if (seasonCalendar[currSeasonCalPos - 2].fixtures.findIndex(k => (k.awayTeam == fixturesCollection[index].awayTeam)||(k.awayTeam == fixturesCollection[index].homeTeam)) == -1){
                                                                        if (currSeasonCalPos > 2){
                                                                            if (seasonCalendar[currSeasonCalPos - 3].fixtures.findIndex(k => (k.homeTeam == fixturesCollection[index].homeTeam)||(k.homeTeam == fixturesCollection[index].awayTeam)) == -1){
                                                                                //console.log("yesterdays home team matches fixture home team or away team")
                                                                                if (seasonCalendar[currSeasonCalPos - 3].fixtures.findIndex(k => (k.awayTeam == fixturesCollection[index].awayTeam)||(k.awayTeam == fixturesCollection[index].homeTeam)) == -1){
                                                                                    if (currentSeasonEntry.fixtures.length < 5){
                                                                                        //console.log("yesterdays away club matches fixture home club or away club")
                                                                                        //console.log(dotw(currentDate.getDay()) + " " + currentDate)
                                                                                        //console.log ("Fixture: " + fixturesCollection[index].homeTeam + " vs " + fixturesCollection[index].awayTeam + "\n")
                                                                                        currentSeasonEntry.fixtures.push({"homeTeam":fixturesCollection[index].homeTeam,"homeClub":fixturesCollection[index].homeClub,"awayTeam":fixturesCollection[index].awayTeam,"awayClub":fixturesCollection[index].awayClub,"division":fixturesCollection[index].division})
                                                                                        fixturesCollection.splice(index,1) // remove the fixture from the collection so that we don't add it to subsequent days
                                                                                    }
                                                                                }
                                                                            }
                                                                        }    
                                                                    }
                                                                }
                                                            }
                                                        //}
                                                    //}
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
            currentDate.setDate(currentDate.getDate() + 1);
            //console.log(currentDate)
        }
    }
    res.render('beta/tameside-fixtures', {
        static_path: '/static',
        pageTitle : "Scorecard Info",
        pageDescription : "View scorecard for this match",
        result: "Some Jibber Jabber about processing fixture dates",
        //seasonCalendar: JSON.stringify(seasonCalendar,null,'\t'),
        //fixturesCollection: JSON.stringify(fixturesCollection,null,'\t'),
        fixturesOutput:seasonCalendar
    });
}