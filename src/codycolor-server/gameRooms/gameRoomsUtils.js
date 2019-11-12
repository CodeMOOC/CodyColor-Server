/*
 * gameRooms/gameRoomsUtils.js: metodi comuni utilizzati in più tipologie di game room
 */
(function () {
    // costanti utilizzate per tener traccia della tipologia di game room
    module.exports.gameTypes = {
        custom: 'custom',
        random: 'random',
        royale: 'royale'
    };


    // costanti utilizzate per tener traccia dello stato attuale di ogni game room
    module.exports.states = {
        mmaking:    'mmaking',
        playing:    'playing',
        aftermatch: 'aftermatch',
        free:       'free'
    };


    // algoritmo per la generazione della stringa rappresentante la disposizione dell tiles di un match
    module.exports.generateTiles = function() {
        let tiles = '';
        for (let i = 0; i < 25; i++) {
            switch (Math.floor(Math.random() * 3)) {
                case 0:
                    tiles += 'R';
                    break;
                case 1:
                    tiles += 'Y';
                    break;
                case 2:
                    tiles += 'G';
                    break;
            }
        }
        return tiles;
    };


    // algoritmo per la generazione del codice univoco a 4 cifre utilizzato per iscriversi alla game room
    module.exports.generateUniqueCode = function (gameRooms) {
        let newCode = '0000';
        let unique = true;
        do {
            newCode = (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString();

            unique = true;
            for (let i = 0; i < gameRooms.length; i++) {
                if (newCode === gameRooms[i].code)
                    unique = false;
            }
        } while (!unique);

        return newCode;
    };


    // calcola il risultato totalizzato dal giocatore (punti e lunghezza percorso), in base alla posizione iniziale
    module.exports.calculatePlayerResult = function (startPosition, time, tilesString) {
        let pathInfo = {
            startPosition: startPosition,
            endPosition: { side: -1, distance: -1 },
            tilesCoords: [],
            direction: [],
        };

        let result = {
            points: 0,
            time: time,
            pathLength: 0,
        };

        // crea la matrice di tiles per il calcolo
        let tiles = new Array(5);
        let positionIndex = 0;
        for (let x = 0; x < 5; x++) {
            tiles[x] = new Array(5);
            for (let y = 0; y < 5; y++) {
                tiles[x][y] = tilesString.charAt(positionIndex);
                positionIndex++;
            }
        }
        
        // roby non posizionato entro il tempo limite
        if (pathInfo.startPosition.distance === -1 && pathInfo.startPosition.side === -1) {
            return result;
        }

        // ottieni primo elemento
        switch (pathInfo.startPosition.side) {
            case 0:
                pathInfo.tilesCoords.push({ x: 0, y: pathInfo.startPosition.distance });
                break;
            case 1:
                pathInfo.tilesCoords.push({ x: pathInfo.startPosition.distance, y: 4 });
                break;
            case 2:
                pathInfo.tilesCoords.push({ x: 4, y: pathInfo.startPosition.distance });
                break;
            case 3:
                pathInfo.tilesCoords.push({ x: pathInfo.startPosition.distance, y: 0 });
                break;
        }
        pathInfo.direction.push((pathInfo.startPosition.side + 2).mod(4));
        result.pathLength++;

        // ottieni elementi successivi
        let endOfThePath = false;
        while (!endOfThePath) {
            let lastTileCoords = pathInfo.tilesCoords[result.pathLength - 1];
            let lastTileDirection = pathInfo.direction[result.pathLength - 1];
            let nextTileCoords = { x: -1, y: -1 };
            let nextTileDirection = -1;

            // 1. trova la prossima direction
            switch(tiles[lastTileCoords.x][lastTileCoords.y]) {
                case 'Y':
                    // vai verso sinistra
                    nextTileDirection = (lastTileDirection - 1).mod( 4);
                    break;
                case 'R':
                    // vai verso destra
                    nextTileDirection = (lastTileDirection + 1).mod(4);
                    break;
                case 'G':
                    // vai dritto
                    nextTileDirection = lastTileDirection;
                    break;
            }

            // 2. trova la prossima tile
            switch(nextTileDirection) {
                case 0:
                    // verso l'alto
                    nextTileCoords.x = lastTileCoords.x - 1;
                    nextTileCoords.y = lastTileCoords.y;
                    break;
                case 1:
                    // verso destra
                    nextTileCoords.x = lastTileCoords.x;
                    nextTileCoords.y = lastTileCoords.y + 1;
                    break;
                case 2:
                    // verso il basso
                    nextTileCoords.x = lastTileCoords.x + 1;
                    nextTileCoords.y = lastTileCoords.y;
                    break;
                case 3:
                    // verso sinistra
                    nextTileCoords.x = lastTileCoords.x;
                    nextTileCoords.y = lastTileCoords.y - 1;
                    break;
            }

            // exit checks
            if (nextTileDirection === 0 && nextTileCoords.x < 0) {
                // uscita dal lato in alto
                pathInfo.endPosition.side = 0;
                pathInfo.endPosition.distance = nextTileCoords.y;
                endOfThePath = true;

            } else if (nextTileDirection === 1 && nextTileCoords.y > 4) {
                // uscita dal lato destro
                pathInfo.endPosition.side = 1;
                pathInfo.endPosition.distance = nextTileCoords.x;
                endOfThePath = true;

            } else if (nextTileDirection === 2 && nextTileCoords.x > 4) {
                // uscita dal lato in basso
                pathInfo.endPosition.side = 2;
                pathInfo.endPosition.distance = nextTileCoords.y;
                endOfThePath = true;

            } else if (nextTileDirection === 3 && nextTileCoords.y < 0) {
                // uscita dal lato sinistro
                pathInfo.endPosition.side = 3;
                pathInfo.endPosition.distance = nextTileCoords.x;
                endOfThePath = true;
            }

            // la prossima tile è valida: aggiungila alla struttura dati
            if (endOfThePath === false) {
                result.pathLength++;
                pathInfo.direction.push(nextTileDirection);
                pathInfo.tilesCoords.push(nextTileCoords);
            }
        }
        
        // calcola punti
        // ogni passo vale 2 punti
        result.points += result.pathLength * 2;

        return result;
    };

    module.exports.calculateWinnerBonusPoints = function(time, timerSetting) {
        // il tempo viene scalato su un massimo di 15 punti
        return Math.floor(15 * time / timerSetting);
    };

    // restituisce per una data game room il numero di giocatori validati
    module.exports.countValidPlayers = function (gameRooms, gameRoomId) {
        let playersCount = 0;
        if(gameRooms[gameRoomId] !== undefined) {
            for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
                if (gameRooms[gameRoomId].players[i].occupiedSlot
                    && gameRooms[gameRoomId].players[i].gameData.validated)
                    playersCount++;
            }
        }
        return playersCount;
    };


    // restituisce per una data game room il numero di giocatori ready
    module.exports.countReadyPlayers = function (gameRooms, gameRoomId) {
        let playersCount = 0;
        if(gameRooms[gameRoomId] !== undefined) {
            for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
                if (gameRooms[gameRoomId].players[i].occupiedSlot
                    && gameRooms[gameRoomId].players[i].gameData.validated
                    && gameRooms[gameRoomId].players[i].gameData.ready)
                    playersCount++;
            }
        }
        return playersCount;
    };

    // restituisce per una data game room il numero di giocatori posizionati
    module.exports.countPositionedPlayers = function (gameRooms, gameRoomId) {
        let playersCount = 0;
        if(gameRooms[gameRoomId] !== undefined) {
            for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
                if (gameRooms[gameRoomId].players[i].occupiedSlot
                    && gameRooms[gameRoomId].players[i].gameData.validated
                    && gameRooms[gameRoomId].players[i].gameData.match.positioned)
                    playersCount++;
            }
        }
        return playersCount;
    };


    module.exports.getGeneralData = function (gameRooms, gameRoomId) {
        if (gameRooms[gameRoomId] !== undefined) {
            let generalData = {};

            generalData.gameName = gameRooms[gameRoomId].gameData.gameName;
            generalData.startDate = gameRooms[gameRoomId].gameData.startDate;
            generalData.scheduledStart = gameRooms[gameRoomId].gameData.scheduledStart;
            generalData.gameRoomId = gameRooms[gameRoomId].gameData.gameRoomId;
            generalData.timerSetting = gameRooms[gameRoomId].gameData.timerSetting;
            generalData.maxPlayersSetting = gameRooms[gameRoomId].gameData.maxPlayersSetting;
            generalData.code = gameRooms[gameRoomId].gameData.code;
            generalData.gameType = gameRooms[gameRoomId].gameData.gameType;

            return generalData;
        }
    };

    module.exports.getPlayerData = function (gameRooms, gameRoomId, playerId) {
        if (gameRooms[gameRoomId] !== undefined) {
            let userData = {};

            userData.nickname = gameRooms[gameRoomId].players[playerId].gameData.nickname;
            userData.validated = gameRooms[gameRoomId].players[playerId].gameData.validated;
            userData.organizer = gameRooms[gameRoomId].players[playerId].gameData.organizer;
            userData.playerId = playerId;

            return userData;
        }
    };

    module.exports.getAggregatedData = function (gameRooms, gameRoomId) {
        if (gameRooms[gameRoomId] !== undefined) {
            let aggregatedData = {};

            aggregatedData.connectedPlayers = module.exports.countValidPlayers(gameRooms, gameRoomId);
            aggregatedData.positionedPlayers = module.exports.countPositionedPlayers(gameRooms, gameRoomId);
            aggregatedData.readyPlayers = module.exports.countReadyPlayers(gameRooms,gameRoomId);
            aggregatedData.matchCount = gameRooms[gameRoomId].gameData.matchCount;

            return aggregatedData;
        }
    };


    // restituisce il ranking del match
    module.exports.getMatchRanking = function(gameRooms, gameRoomId) {
        let matchRanking = [];
        let players = [];

        for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
            if (gameRooms[gameRoomId].players[i].occupiedSlot
                && gameRooms[gameRoomId].players[i].gameData.validated)
                players.push(JSON.parse(JSON.stringify(gameRooms[gameRoomId].players[i].gameData)));
        }

        players.sort(function (a, b) {
            if (b.match.pathLength - a.match.pathLength !== 0) {
                return b.match.pathLength - a.match.pathLength;
            } else {
                return b.match.time - a.match.time;
            }
        });

        for (let i = 0; i < players.length && i < 3; i++) {
            let playerResult = {};
            playerResult.nickname = players[i].nickname;
            playerResult.playerId = players[i].playerId;
            playerResult.time = players[i].match.time;
            playerResult.points = players[i].match.points;
            playerResult.pathLength = players[i].match.pathLength;
            playerResult.startPosition = players[i].match.startPosition;

            matchRanking.push(playerResult);
        }

        return matchRanking;
    };


    // restituisce il ranking globale del match
    module.exports.getGlobalRanking = function(gameRooms, gameRoomId) {
        let globalRanking = [];
        let players = [];

        for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
            if (gameRooms[gameRoomId].players[i].occupiedSlot
                && gameRooms[gameRoomId].players[i].gameData.validated)
                players.push(JSON.parse(JSON.stringify(gameRooms[gameRoomId].players[i].gameData)));
        }

        players.sort(function (a, b) {
            if (b.points - a.points !== 0) {
                return b.points - a.points;

            } else {
                return b.wonMatches - a.wonMatches;
            }
        });

        for (let i = 0; i < players.length && i < 3; i++) {
            let playerResult = {};
            playerResult.nickname = players[i].nickname;
            playerResult.playerId = players[i].playerId;
            playerResult.points = players[i].points;
            playerResult.wonMatches = players[i].wonMatches;

            globalRanking.push(playerResult);
        }

        return globalRanking;
    };


    // restituisce l'array delle posizioni occupate prima del match, e il numero di giocatori in ogni posizione
    module.exports.getStartPositions = function(gameRooms, gameRoomId) {
        let startPositions = [];

        for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
            let startPositionPresent = false;
            for (let j = 0; j < startPositions.length; j++) {
                if(gameRooms[gameRoomId].players[i].gameData.match.startPosition.side === startPositions[j].position.side
                    && gameRooms[gameRoomId].players[i].gameData.match.startPosition.distance === startPositions[j].position.distance) {
                    startPositionPresent = true;
                    startPositions[j].playerCount++;
                }
            }
            if (!startPositionPresent)
                startPositions.push({position: gameRooms[gameRoomId].players[i].gameData.match.startPosition, playerCount: 1});
        }

        return startPositions;
    };


    // identifica l'evenienza di un pareggio totale. Assumiamo che ciò si può verificare solo quando nessuno degli
    // avversari piazza il proprio roby, ovvero nel caso in cui tutti i pathLength siano a 0
    module.exports.isDraw = function(gameRooms, gameRoomId) {
        for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
            if (gameRooms[gameRoomId].players[i].gameData.match.pathLength !== 0) {
                return false;
            }
        }

        return true;
    };


    // identifica il vincitore del match (se presente) e ne restituisce l'id
    module.exports.getWinnerId = function(gameRooms, gameRoomId) {
        if (!module.exports.isDraw(gameRooms, gameRoomId)) {
            for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
                if (gameRooms[gameRoomId].players[i].gameData.match.winner) {
                    return gameRooms[gameRoomId].players[i].gameData.playerId;
                }
            }
        } else {
            return -1;
        }
    };


    // risolve il bug della funzione modulo di JavaScript
    // (https://stackoverflow.com/questions/4467539/javascript-modulo-gives-a-negative-result-for-negative-numbers)
    Number.prototype.mod = function(n) {
        return ((this % n) + n) % n;
    };
}());