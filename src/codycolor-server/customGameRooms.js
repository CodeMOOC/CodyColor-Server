/*
 * customGameRooms.js: file per la gestione dell'array gameRoom ad accoppiamento personalizzato dei giocatori. Espone metodi
 * per l'aggiunta e la rimozione dei giocatori, oltre a metodi per recuperare informazioni sullo stato delle game room.
 */
(function () {
    let utilities = require("./utilities");
    let customGameRooms = [];
    let callbacks = {};
    const gameRoomStates = utilities.gameRoomStates;


    // inizializza i callbacks utilizzati dal modulo
    module.exports.setCallbacks = function(onGameRoomsUpdated, onHeartbeatExpired, createDbGameSession, createDbGameMatch) {
        callbacks.onGameRoomsUpdated = onGameRoomsUpdated;
        callbacks.onHeartbeatExpired = onHeartbeatExpired;
        callbacks.createDbGameSession = createDbGameSession;
        callbacks.createDbGameMatch = createDbGameMatch;
    };


    // fornisce il conteggio complessivo dei giocatori attivi sulle game room ad accoppiamento casuale
    module.exports.getConnectedPlayers = function() {
        let connectedPlayers = 0;
        for (let i = 0; i < customGameRooms.length; i++) {
            for (let j = 0; j < customGameRooms[i].players.length; j++)
                if (customGameRooms[i].players[j].occupiedSlot)
                    connectedPlayers++;
        }
        return connectedPlayers;
    };


    // stampa a console le gameRoom attive ad accoppiamento personalizzato
    module.exports.printGameRooms = function() {
        utilities.printLog(false, 'New custom game room configuration:');

        if (customGameRooms.length <= 0) {
            utilities.printLog(false, 'empty');

        } else {
            let gameRoomString = '';
            for (let i = 0; i < customGameRooms.length; i++) {
                let firstSlot = (customGameRooms[i].players[0].occupiedSlot ? 'x' : 'o');
                let secondSlot = (customGameRooms[i].players[1].occupiedSlot ? 'x' : 'o');
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
    module.exports.handleGameRequest = function(message) {
        // SUCCESS: game room trovata/generata
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };

        let organizer = false;

        if (message.code === '0000') {
            organizer = true;
            result = addOrganizerPlayer();
        } else if (message.code !== undefined)
            result = addInvitedPlayer(message.code);


        if (!result.success) {
            result.messages.push({
                msgType: utilities.messageTypes.s_gameResponse,
                gameType: utilities.gameTypes.custom,
                code: '0000',
                correlationId: message.correlationId,
            });
            return result;
        }

        // inserisci il giocatore nella game room
        customGameRooms[result.gameRoomId].players[result.playerId]
            = generateOccupiedSlot(result.gameRoomId, result.playerId, message.userId);

        // valida giocatore, se possibile
        if (message.nickname !== undefined && message.nickname !== "Anonymous") {
            customGameRooms[result.gameRoomId].players[result.playerId].gameData.nickname = message.nickname;
            customGameRooms[result.gameRoomId].players[result.playerId].gameData.validated = true;
        }

        customGameRooms[result.gameRoomId].gameData.gameRoomId = result.gameRoomId;
        customGameRooms[result.gameRoomId].players[result.playerId].gameData.playerId = result.playerId;

        if (organizer) {
            customGameRooms[result.gameRoomId].players[0].gameData.organizer = true;
            customGameRooms[result.gameRoomId].gameData.timerSetting = message.timerSetting;
        }

        // crea i messaggi di risposta
        callbacks.onGameRoomsUpdated();
        result.messages.push({
            msgType: utilities.messageTypes.s_gameResponse,
            gameType: utilities.gameTypes.custom,
            gameRoomId: result.gameRoomId,
            playerId: result.playerId,
            code: customGameRooms[result.gameRoomId].gameData.code,
            correlationId: message.correlationId,
            gameData: getGameRoomData(result.gameRoomId)
        });

        if (customGameRooms[result.gameRoomId].players[result.playerId].gameData.validated && !organizer) {
            result.messages.push({
                msgType: utilities.messageTypes.s_playerAdded,
                gameType: utilities.gameTypes.custom,
                gameRoomId: result.gameRoomId,
                addedPlayerId: result.playerId,
                gameData: getGameRoomData(result.gameRoomId)
            });
        }

        return result;
    };


    let addOrganizerPlayer = function() {
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };

        // cerca il primo slot libero tra le gameRoom
        for (let gRoomIndex = 0; gRoomIndex < customGameRooms.length; gRoomIndex++) {
            if (customGameRooms[gRoomIndex].state === gameRoomStates.free) {
                result.gameRoomId = gRoomIndex;
                result.playerId = 0;
                result.success = true;
            }
        }

        // non c'è uno slot libero: crea una nuova game room
        if (result.gameRoomId === undefined && result.playerId === undefined) {
            result.gameRoomId = customGameRooms.length;
            result.playerId = 0;
            result.success = true;
            customGameRooms.push(
                generateGameRoom(result.gameRoomId, gameRoomStates.mmaking)
            );
        }

        return result;
    };


    let addInvitedPlayer = function(invitationCode) {
        // si è stati invitati: cerca la gameRoom che ha proposto la partita
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };

        for (let gRoomIndex = 0; gRoomIndex < customGameRooms.length; gRoomIndex++) {
            if (customGameRooms[gRoomIndex].gameData.code.toString() === invitationCode.toString()
                && customGameRooms[gRoomIndex].gameData.state === gameRoomStates.mmaking
                && !customGameRooms[gRoomIndex].players[1].occupiedSlot) {
                result.gameRoomId = gRoomIndex;
                result.playerId = 1;
                result.success = true;
            }
        }

        return result;
    };


    module.exports.handleValidation = function (message) {
        let result = {
            success: false,
            messages: []
        };

        customGameRooms[message.gameRoomId].players[message.playerId].gameData.validated = true;
        customGameRooms[message.gameRoomId].players[message.playerId].gameData.nickname = message.nickname;

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
            clearTimeout(customGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer);
            customGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer
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

        customGameRooms[message.gameRoomId].players[message.playerId].gameData.ready = true;
        result.success = startMatchCheck(message.gameRoomId);

        if (result.success) {
            for (let i = 0; i < customGameRooms[message.gameRoomId].players.length; i++) {
                customGameRooms[message.gameRoomId].players[i].gameData.match = generateEmptyPlayerMatch();
                customGameRooms[message.gameRoomId].players[i].gameData.ready = false;
            }
            customGameRooms[message.gameRoomId].gameData.state = utilities.gameRoomStates.playing;
            customGameRooms[message.gameRoomId].gameData.tiles = utilities.generateTiles();
            result.messages.push({
                msgType: utilities.messageTypes.s_startMatch,
                gameRoomId: message.gameRoomId,
                gameType: utilities.gameTypes.custom,
                tiles: customGameRooms[message.gameRoomId].gameData.tiles,
                gameData: getGameRoomData(message.gameRoomId)
            });

            if (customGameRooms[message.gameRoomId].gameData.matchCount === 0)
                callbacks.createDbGameSession(customGameRooms[message.gameRoomId]);
        }

        return result;
    };


    module.exports.handlePositionedMessage = function (message) {
        let result = {
            success: false,
            messages: []
        };

        customGameRooms[message.gameRoomId].players[message.playerId].gameData.match.positioned = true;
        customGameRooms[message.gameRoomId].players[message.playerId].gameData.match.time = message.matchTime;
        customGameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.side = message.side;
        customGameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.distance = message.distance;
        result.success = startAnimationCheck(message.gameRoomId);

        if (result.success) {
            result.messages.push({
                msgType: utilities.messageTypes.s_startAnimation,
                gameRoomId: message.gameRoomId,
                gameType: utilities.gameTypes.custom,
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

        customGameRooms[message.gameRoomId].players[message.playerId].gameData.match.animationEnded = true;
        customGameRooms[message.gameRoomId].players[message.playerId].gameData.match.points = message.matchPoints;
        customGameRooms[message.gameRoomId].players[message.playerId].gameData.points
            += customGameRooms[message.gameRoomId].players[message.playerId].gameData.match.points;
        customGameRooms[message.gameRoomId].players[message.playerId].gameData.match.pathLength = message.pathLength;

        if (message.winner) {
            customGameRooms[message.gameRoomId].players[message.playerId].gameData.wonMatches++;
            customGameRooms[message.gameRoomId].players[message.playerId].gameData.match.winner = true;
        }
        result.success = endMatchCheck(message.gameRoomId);

        if (result.success) {
            customGameRooms[message.gameRoomId].gameData.state = utilities.gameRoomStates.aftermatch;
            customGameRooms[message.gameRoomId].gameData.matchCount++;

            result.messages.push({
                msgType: utilities.messageTypes.s_endMatch,
                gameRoomId: message.gameRoomId,
                gameType: utilities.gameTypes.custom,
                gameData: getGameRoomData(message.gameRoomId)
            });

            callbacks.createDbGameMatch(customGameRooms[message.gameRoomId]);
        }

        return result;
    };


    let clearGameRoom = function(gameRoomId) {
        // pulisci in maniera 'safe' lo slot giocatore, fermando i vari timer attivi
        if (gameRoomExists(gameRoomId)) {
            for (let j = 0; j < customGameRooms[gameRoomId].players.length; j++) {
                if (customGameRooms[gameRoomId].players[j].heartBeatTimer !== undefined)
                    clearTimeout(customGameRooms[gameRoomId].players[j].heartBeatTimer);
            }

            customGameRooms[gameRoomId] = generateGameRoom(gameRoomId, gameRoomStates.free);
        }

        // rimuovi se presenti le gameRoom vuote consecutive in fondo all'array
        for (let i = customGameRooms.length - 1; i >= 0; i--) {
            if (customGameRooms[i].gameData.state === gameRoomStates.free)
                customGameRooms.splice(i, 1);
            else
                break;
        }
    };


    let slotExists = function (gameRoomId, playerId) {
        return customGameRooms[gameRoomId] !== undefined
            && customGameRooms[gameRoomId].players[playerId] !== undefined;
    };


    let gameRoomExists = function (gameRoomId) {
        return customGameRooms[gameRoomId] !== undefined;
    };


    let generateGameRoom = function (gameRoomId, state) {
        return {
            players: [generateFreeSlot(), generateFreeSlot()],
            sessionId: undefined,
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


    let generateOccupiedSlot = function (gameRoomId, playerId, userId) {
        return {
            occupiedSlot: true,
            userId: userId,
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
        if (gameRoomExists(gameRoomId)) {
            let gRoomData = {};
            gRoomData.general = customGameRooms[gameRoomId].gameData;
            gRoomData.players = [];
            for (let i = 0; i < customGameRooms[gameRoomId].players.length; i++) {
                if (customGameRooms[gameRoomId].players[i].occupiedSlot  &&
                    customGameRooms[gameRoomId].players[i].gameData.validated)
                    gRoomData.players.push(customGameRooms[gameRoomId].players[i].gameData)
            }
            return gRoomData;
        }
    };


    let startMatchCheck = function (gameRoomId) {
        if (!gameRoomExists(gameRoomId)) {
            return;
        }

        let allReady = true;
        for (let i = 0; i < customGameRooms[gameRoomId].players.length; i++) {
            if (customGameRooms[gameRoomId].players[i].occupiedSlot &&
                !customGameRooms[gameRoomId].players[i].gameData.ready) {
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
        for (let i = 0; i < customGameRooms[gameRoomId].players.length; i++) {
            if (customGameRooms[gameRoomId].players[i].occupiedSlot &&
                !customGameRooms[gameRoomId].players[i].gameData.match.positioned) {
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
        for (let i = 0; i < customGameRooms[gameRoomId].players.length; i++) {
            if (customGameRooms[gameRoomId].players[i].occupiedSlot &&
                !customGameRooms[gameRoomId].players[i].gameData.match.animationEnded) {
                allAnimationFinished = false;
                break;
            }
        }

        return allAnimationFinished;
    };


    let generateUniqueCode = function() {
        let newCode = '0000';
        let unique = true;
        do {
            newCode = (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString();

            unique = true;
            for (let i = 0; i < customGameRooms.length; i++) {
                if (newCode === customGameRooms[i].code)
                    unique = false;
            }
        } while (!unique);

        return newCode;
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
            winner: true,
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
            timerSetting: 30000,
            gameType: utilities.gameTypes.custom,
            code: generateUniqueCode()
        }
    };
}());