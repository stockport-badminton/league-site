# Club Night game management system

## Requirements
* Specify a number of courts
* allow a user to choose players from a pot of available players
* order the available players by:
  * total games players during the session
  * how many games have gone on since they last played
* once 4 are selected suggest pairings based on team positions, previous session games performance
  
## Bonus / Stretch requirements
* internet based so that:
  *  players can sign in / notify arrival to club
  *  players can be nudged when it's their turn to pick
  *  players can complete games / enter scores
  *  players can see the queue
  *  players can check their session performance
  
``` type=json
let session = {}
session.id = 1 ' unique
session.date = date
session.activeGames = []  ' can't be greater than 3 in size
session.completedGames = []
session.players = []

let player = {
    id:1
    "name": Neil Cooper,
    "gamesPlayed": 0,
    "activeInSession":false,
    "previousSessions":[]
}

let game = {
    id:1,
    picker: {plauyerID},
    pair1:{
        player1: {player1ID},
        player2: {player2ID},
    }
    pair2:{
        player1: {player3ID},
        player1: {player4ID}
    },
    pair1Score:21,
    pair2Score:19
}

```

