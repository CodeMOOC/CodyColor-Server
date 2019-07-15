/*
 * randomGameRooms.js: file per la gestione dell'array gameRoom ad accoppiamento casuale dei giocatori. Espone metodi
 * per l'aggiunta e la rimozione dei giocatori, oltre a metodi per recuperare informazioni sullo stato delle game room.
 */
(function () {
    let utilities = require("./utilities");
    let randomGameRooms = [];
    let callbacks = {};
    const gameRoomStates = utilities.gameRoomStates;


    // inizializza i callbacks utilizzati dal modulo
    module.exports.setCallbacks = function (onGameRoomsUpdated, onHeartbeatExpired) {
        callbacks.onGameRoomsUpdated = onGameRoomsUpdated;
        callbacks.onHeartbeatExpired = onHeartbeatExpired;
    };


    // fornisce il conteggio complessivo dei giocatori attivi sulle game room ad accoppiamento casuale
    module.exports.getConnectedPlayers = function () {
        let connectedPlayers = 0;
        for (let i = 0; i < randomGameRooms.length; i++) {
            for (let j = 0; j < randomGameRooms[i].players.length; j++)
                if (randomGameRooms[i].players[j].occupiedSlot)
                    connectedPlayers++;
        }
        return connectedPlayers;
    };


    // fornisce il conteggio dei giocatori in attesa di un avversario
    module.exports.getWaitingPlayers = function () {
        let waitingPlayers = 0;
        for (let i = 0; i < randomGameRooms.length; i++) {
            if (randomGameRooms[i].players[0].occupiedSlot && !randomGameRooms[i].players[1].occupiedSlot)
                waitingPlayers++;
        }
        return waitingPlayers;
    };


    // stampa a console le gameRoom attive ad accoppiamento personalizzato
    module.exports.printGameRooms = function () {
        utilities.printLog(false, 'New random game room configuration:');

        if (randomGameRooms.length <= 0) {
            utilities.printLog(false, 'empty');

        } else {
            let gameRoomString = '';
            for (let i = 0; i < randomGameRooms.length; i++) {
                let firstSlot = (randomGameRooms[i].players[0].occupiedSlot ? 'x' : 'o');
                let secondSlot = (randomGameRooms[i].players[1].occupiedSlot ? 'x' : 'o');
                gameRoomString += i.toString() + '[' + firstSlot + '' + secondSlot + '] ';
                if (i % 4 === 0 && i !== 0) {
                    utilities.printLog(false, gameRoomString);
                    gameRoomString = '';
                }
            }
            if (gameRoomString !== '')
                utilities.printLog(false, gameRoomString);
        }
    };


    // aggiunge un riferimento all'utente nel primo slot valido.
    // Ritorna un oggetto contenente gameRoom e playerId assegnati al richiedente.
    // L'eventuale callback passato viene eseguito non appena le gameRoom vengono aggiornate
    module.exports.handleGameRequest = function (message) {
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };

        // dà la precedenza alle gameRoom con giocatori in attesa di avversari
        for (let gRoomIndex = 0; gRoomIndex < randomGameRooms.length; gRoomIndex++) {
            if (randomGameRooms[gRoomIndex].players[0].occupiedSlot &&
                !randomGameRooms[gRoomIndex].players[1].occupiedSlot) {
                result.gameRoomId = gRoomIndex;
                result.playerId = 1
                result.success = true;
            }
        }

        if (result.gameRoomId === undefined && result.playerId === undefined) {
            // cerca il primo slot libero tra le gameRoom
            for (let gRoomIndex = 0; gRoomIndex < randomGameRooms.length; gRoomIndex++) {
                for (let playerIndex = 0; playerIndex < 2; playerIndex++) {
                    // si è trovato uno slot libero: piazza l'utente lì
                    if (!randomGameRooms[gRoomIndex].players[playerIndex].occupiedSlot) {
                        result.gameRoomId = gRoomIndex;
                        result.playerId = playerIndex;
                        result.success = true;
                    }
                }
            }
        }

        // non c'è uno slot libero: crea una nuova game room
        if (!result.success) {
            result.gameRoomId = randomGameRooms.length;
            result.playerId = 0;
            result.success = true;

            randomGameRooms.push(
                generateGameRoom(result.gameRoomId, gameRoomStates.mmaking)
            );
        }

        // inserisci il giocatore nella game room
        randomGameRooms[result.gameRoomId].players[result.playerId]
            = generateOccupiedSlot(result.gameRoomId, result.playerId);

        // valida giocatore, se possibile
        if (message.nickname !== undefined && message.nickname !== "Anonymous") {
            randomGameRooms[result.gameRoomId].players[result.playerId].gameData.nickname = message.nickname;
            randomGameRooms[result.gameRoomId].players[result.playerId].gameData.validated = true;
        }

        if (result.gameRoomId !== undefined) {
            randomGameRooms[result.gameRoomId].gameData.gameRoomId = result.gameRoomId;
        }

        if (result.playerId !== undefined) {
            randomGameRooms[result.gameRoomId].players[result.playerId].gameData.playerId = result.playerId;
        }

        if (result.playerId === 0) {
            randomGameRooms[result.gameRoomId].players[0].gameData.organizer = true;
        }

        // crea i messaggi di risposta
        callbacks.onGameRoomsUpdated();
        result.success = true;
        result.messages.push({
            msgType: utilities.messageTypes.s_gameResponse,
            gameType: utilities.gameTypes.random,
            gameRoomId: result.gameRoomId,
            playerId: result.playerId,
            correlationId: message.correlationId,
            gameData: getGameRoomData(result.gameRoomId)
        });

        if (randomGameRooms[result.gameRoomId].players[result.playerId].gameData.validated) {
            result.messages.push({
                msgType: utilities.messageTypes.s_playerAdded,
                gameType: message.gameType,
                gameRoomId: result.gameRoomId,
                addedPlayerId: result.playerId,
                gameData: getGameRoomData(result.gameRoomId)
            });
        }
        return result;
    };


    module.exports.handleValidation = function (message) {
        let result = {
            success: false,
            messages: []
        };

        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.validated = true;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.nickname = message.nickname;
        result.success = true;

        result.messages.push({
            msgType: utilities.messageTypes.s_playerAdded,
            gameType: message.gameType,
            gameRoomId: message.gameRoomId,
            addedPlayerId: message.playerId,
            gameData: getGameRoomData(message.gameRoomId)
        });

        return result;
    };


    module.exports.handlePlayerQuit = function (message) {
        let result = {
            success: false,
            messages: []
        };

        // pulisci in maniera 'safe' lo slot giocatore, fermando i vari timer attivi
        clearGameRoom(message.gameRoomId);
        result.success = true;
        result.messages.push({
            msgType: utilities.messageTypes.s_gameQuit,
            gameRoomId: message.gameRoomId,
            gameType: message.gameType,
        });

        callbacks.onGameRoomsUpdated();
        return result;
    };


    // aggiorna il timer heartbeat di un giocatore. invocato all'arrivo di un messaggio di heartbeat
    module.exports.handleHeartbeat = function (message) {
        let result = {
            success: false,
            messages: []
        };

        if (!slotExists(message.gameRoomId, message.playerId)) {
            clearGameRoom(message.gameRoomId);
            result.messages.push({
                msgType: utilities.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: message.gameType
            });

        } else {
            clearTimeout(randomGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer);
            randomGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer
                = generateHeartbeatTimer(message.gameRoomId, message.playerId);
            result.success = true;
        }

        return result;
    };


    module.exports.handleReadyMessage = function (message) {
        let result = {
            success: false,
            messages: []
        };

        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.ready = true;
        result.success = startMatchCheck(message.gameRoomId);

        if (result.success) {
            for (let i = 0; i < randomGameRooms[message.gameRoomId].players.length; i++) {
                randomGameRooms[message.gameRoomId].players[i].gameData.match = generateEmptyPlayerMatch();
                randomGameRooms[message.gameRoomId].players[i].gameData.ready = false;
            }
            randomGameRooms[message.gameRoomId].gameData.state = utilities.gameRoomStates.playing;
            randomGameRooms[message.gameRoomId].gameData.tiles = utilities.generateTiles();
            result.messages.push({
                msgType: utilities.messageTypes.s_startMatch,
                gameRoomId: message.gameRoomId,
                gameType: utilities.gameTypes.random,
                tiles: randomGameRooms[message.gameRoomId].gameData.tiles,
                gameData: getGameRoomData(message.gameRoomId)
            });
            // todo avvia cronometro di sincronizzazione?
        }

        return result;
    };


    module.exports.handlePositionedMessage = function (message) {
        let result = {
            success: false,
            messages: []
        };

        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.positioned = true;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.time = message.matchTime;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.side = message.side;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.distance = message.distance;
        result.success = startAnimationCheck(message.gameRoomId);

        if (result.success) {
            result.messages.push({
                msgType: utilities.messageTypes.s_startAnimation,
                gameRoomId: message.gameRoomId,
                gameType: utilities.gameTypes.random,
                gameData: getGameRoomData(message.gameRoomId)
            });
        }

        return result;
    };

    module.exports.handleEndAnimationMessage = function (message) {
        let result = {
            success: false, // success: termina il match
            messages: []
        };

        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.animationEnded = true;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.points = message.matchPoints;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.points
            += randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.points;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.pathLength = message.pathLength;

        if (message.winner) {
            randomGameRooms[message.gameRoomId].players[message.playerId].gameData.wonMatches++;
        }
        result.success = endMatchCheck(message.gameRoomId);

        if (result.success) {
            randomGameRooms[message.gameRoomId].gameData.state = utilities.gameRoomStates.aftermatch;
            randomGameRooms[message.gameRoomId].gameData.matchCount++;

            result.messages.push({
                msgType: utilities.messageTypes.s_endMatch,
                gameRoomId: message.gameRoomId,
                gameType: utilities.gameTypes.random,
                gameData: getGameRoomData(message.gameRoomId)
            });
        }

        return result;
    };


    let clearGameRoom = function(gameRoomId) {
        // pulisci in maniera 'safe' lo slot giocatore, fermando i vari timer attivi
        if (gameRoomExists(gameRoomId)) {
            for (let j = 0; j < randomGameRooms[gameRoomId].players.length; j++) {
                if (randomGameRooms[gameRoomId].players[j].heartBeatTimer !== undefined)
                    clearTimeout(randomGameRooms[gameRoomId].players[j].heartBeatTimer);
            }

            randomGameRooms[gameRoomId] = generateGameRoom(gameRoomId, gameRoomStates.free);
        }

        // rimuovi se presenti le gameRoom vuote consecutive in fondo all'array
        for (let i = randomGameRooms.length - 1; i >= 0; i--) {
            if (randomGameRooms[i].gameData.state === gameRoomStates.free)
                randomGameRooms.splice(i, 1);
            else
                break;
        }
    };

    let slotExists = function (gameRoomId, playerId) {
        return randomGameRooms[gameRoomId] !== undefined
            && randomGameRooms[gameRoomId].players[playerId] !== undefined;
    };


    let gameRoomExists = function (gameRoomId) {
        return randomGameRooms[gameRoomId] !== undefined;
    };


    let generateGameRoom = function (gameRoomId, state) {
        return {
            players: [generateFreeSlot(), generateFreeSlot()],
            gameData: generateGeneralGameData(gameRoomId, state)
        };
    };


    let generateFreeSlot = function () {
        return {
            occupiedSlot: false,
            heartBeatTimer: undefined,
            gameData: generatePlayerGameData()
        };
    };


    let generateOccupiedSlot = function (gameRoomId, playerId) {
        return {
            occupiedSlot: true,
            heartBeatTimer: generateHeartbeatTimer(gameRoomId, playerId),
            gameData: generatePlayerGameData(gameRoomId, playerId)
        };
    };


    let generateHeartbeatTimer = function (gameRoomId, playerId) {
        return setTimeout(function () {
            callbacks.onHeartbeatExpired(gameRoomId, playerId)
        }, 10000);
    };


    let getGameRoomData = function (gameRoomId) {
        if (randomGameRooms[gameRoomId] !== undefined) {
            let gRoomData = {};
            gRoomData.general = randomGameRooms[gameRoomId].gameData;
            gRoomData.players = [];
            for (let i = 0; i < randomGameRooms[gameRoomId].players.length; i++) {
                if (randomGameRooms[gameRoomId].players[i].occupiedSlot &&
                    randomGameRooms[gameRoomId].players[i].gameData.validated)
                    gRoomData.players.push(randomGameRooms[gameRoomId].players[i].gameData)
            }
            return gRoomData;
        }
    };


    let startMatchCheck = function (gameRoomId) {
        if (!gameRoomExists(gameRoomId)) {
            return;
        }

        let allReady = true;
        for (let i = 0; i < randomGameRooms[gameRoomId].players.length; i++) {
            if (randomGameRooms[gameRoomId].players[i].occupiedSlot &&
                !randomGameRooms[gameRoomId].players[i].gameData.ready) {
                allReady = false;
                break;
            }
        }

        return allReady;
    };


    let startAnimationCheck = function (gameRoomId) {
        if (!gameRoomExists(gameRoomId)) {
            return;
        }

        let allPositioned = true;
        for (let i = 0; i < randomGameRooms[gameRoomId].players.length; i++) {
            if (randomGameRooms[gameRoomId].players[i].occupiedSlot &&
                !randomGameRooms[gameRoomId].players[i].gameData.match.positioned) {
                allPositioned = false;
                break;
            }
        }

        return allPositioned;
    };


    let endMatchCheck = function (gameRoomId) {
        if (!gameRoomExists(gameRoomId)) {
            return;
        }

        let allAnimationFinished = true;
        for (let i = 0; i < randomGameRooms[gameRoomId].players.length; i++) {
            if (randomGameRooms[gameRoomId].players[i].occupiedSlot &&
                !randomGameRooms[gameRoomId].players[i].gameData.match.animationEnded) {
                allAnimationFinished = false;
                break;
            }
        }

        return allAnimationFinished;
    };


    /* -------------------------------------------------------------------- *
     * Initializers: metodi per 'pulire' la struttura dati, nel momento
     * in cui vada resettata
     * -------------------------------------------------------------------- */

    let generateEmptyPlayerMatch = function () {
        return {
            time: -1,
            points: 0,
            pathLength: 0,
            animationEnded: false,
            positioned: false,
            startPosition: {
                side: -1,
                distance: -1
            },
        };
    };


    let generatePlayerGameData = function (gameRoomId, playerId) {
        return {
            nickname: 'Anonymous',
            points: 0,
            wonMatches: 0,
            playerId: (playerId !== undefined) ? playerId : -1,
            ready: false,
            validated: false,
            organizer: playerId === 0,
            match: generateEmptyPlayerMatch()
        }
    };


    let generateGeneralGameData = function (gameRoomId, state) {
        return {
            gameRoomId: (gameRoomId !== undefined) ? gameRoomId : -1,
            matchCount: 0,
            tiles: undefined,
            state: (state !== undefined) ? state : gameRoomStates.free,
            gameType: utilities.gameTypes.random
        }
    };
}());