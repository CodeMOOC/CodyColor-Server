/*
 * royaleGameRooms.js: file per la gestione dell'array gameRoom ad accoppiamento personalizzato dei giocatori. Espone metodi
 * per l'aggiunta e la rimozione dei giocatori, oltre a metodi per recuperare informazioni sullo stato delle game room.
 */
(function () {
    let utilities = require("./utilities");
    let royaleGameRooms = [];
    let callbacks = {};
    const gameRoomStates = utilities.gameRoomStates;


    module.exports.setCallbacks = function (onGameRoomsUpdated, onHeartbeatExpired, onStartTimerExpired, createDbGameSession, createDbGameMatch) {
        callbacks.onGameRoomsUpdated = onGameRoomsUpdated;
        callbacks.onHeartbeatExpired = onHeartbeatExpired;
        callbacks.onStartTimerExpired = onStartTimerExpired;
        callbacks.createDbGameSession = createDbGameSession;
        callbacks.createDbGameMatch = createDbGameMatch;

    };


    module.exports.getConnectedPlayers = function () {
        let connectedPlayers = 0;
        for (let i = 0; i < royaleGameRooms.length; i++) {
            for (let j = 0; j < royaleGameRooms[i].players.length; j++)
                if (royaleGameRooms[i].players[j].occupiedSlot)
                    connectedPlayers++;
        }
        return connectedPlayers;
    };


    module.exports.printGameRooms = function () {
        utilities.printLog(false, 'New royale game room configuration:');

        if (royaleGameRooms.length <= 0) {
            utilities.printLog(false, 'empty');

        } else {
            let gameRoomString = '';
            for (let gameRoomIndex = 0; gameRoomIndex < royaleGameRooms.length; gameRoomIndex++) {
                gameRoomString += gameRoomIndex.toString() + '[';
                for (let playerIndex = 0; playerIndex < royaleGameRooms[gameRoomIndex].players.length; playerIndex++) {
                    gameRoomString += (royaleGameRooms[gameRoomIndex].players[playerIndex].occupiedSlot ? 'x' : 'o');
                }
                gameRoomString += '] ';
                if (gameRoomIndex % 4 === 0 && gameRoomIndex !== 0) {
                    utilities.printLog(false, gameRoomString);
                    gameRoomString = '';
                }
            }
            if (gameRoomString !== '')
                utilities.printLog(false, gameRoomString);
        }
    };


    // inserisce l'utente nel primo slot game room valido, nel caso in cui il codice sia valido
    module.exports.handleGameRequest = function (message) {
        let result = {
            success: false,  // SUCCESS: game room trovata/generata
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };

        let organizer = false;

        if (message.code === '0000') {
            result = addOrganizerPlayer();
            organizer = true;
        } else if (message.code !== undefined)
            result = addInvitedPlayer(message.code);

        // codice non valido: invia response con codice 0000
        if (!result.success) {
            result.messages.push({
                msgType: utilities.messageTypes.s_gameResponse,
                gameType: utilities.gameTypes.royale,
                code: '0000',
                correlationId: message.correlationId,
            });
            return result;
        }

        // inserisci il giocatore nella game room
        royaleGameRooms[result.gameRoomId].players[result.playerId]
            = generateOccupiedSlot(result.gameRoomId, result.playerId, message.userId);


        // imposta vari game data
        if (message.nickname !== undefined && message.nickname !== "Anonymous") {
            royaleGameRooms[result.gameRoomId].players[result.playerId].gameData.nickname = message.nickname;
            royaleGameRooms[result.gameRoomId].players[result.playerId].gameData.validated = true;
        }

        royaleGameRooms[result.gameRoomId].gameData.gameRoomId = result.gameRoomId;
        royaleGameRooms[result.gameRoomId].players[result.playerId].gameData.playerId = result.playerId;

        if (organizer) {
            royaleGameRooms[result.gameRoomId].players[result.playerId].gameData.organizer = true;
            royaleGameRooms[result.gameRoomId].gameData.timerSetting = message.timerSetting;
            royaleGameRooms[result.gameRoomId].gameData.gameName = message.gameName;
            royaleGameRooms[result.gameRoomId].gameData.maxPlayersSetting = message.maxPlayersSetting;

            if (message.startDate !== undefined) {
                royaleGameRooms[result.gameRoomId].gameData.startDate = message.startDate;
                setTimeout(function () {
                        callbacks.onStartTimerExpired(result.gameRoomId);
                    },
                    message.startDate - (new Date()).getTime());
            }
        }

        // crea i messaggi di risposta
        callbacks.onGameRoomsUpdated();
        result.messages.push({
            msgType: utilities.messageTypes.s_gameResponse,
            gameType: utilities.gameTypes.royale,
            gameRoomId: result.gameRoomId,
            playerId: result.playerId,
            code: royaleGameRooms[result.gameRoomId].gameData.code,
            correlationId: message.correlationId,
            gameData: getGameRoomData(result.gameRoomId)
        });

        if (royaleGameRooms[result.gameRoomId].players[result.playerId].gameData.validated && !organizer) {
            result.messages.push({
                msgType: utilities.messageTypes.s_playerAdded,
                gameType: utilities.gameTypes.royale,
                gameRoomId: result.gameRoomId,
                addedPlayerId: result.playerId,
                gameData: getGameRoomData(result.gameRoomId)
            });
        }

        return result;
    };


    let addOrganizerPlayer = function () {
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };

        // cerca il primo slot libero tra le gameRoom
        for (let i = 0; i < royaleGameRooms.length; i++) {
            if (royaleGameRooms[i].gameData.state === gameRoomStates.free) {
                result.gameRoomId = i;
                result.playerId = 0;
                result.success = true;
            }
        }

        // non c'è uno slot libero: crea una nuova game room
        if (result.gameRoomId === undefined && result.playerId === undefined) {
            result.gameRoomId = royaleGameRooms.length;
            result.playerId = 0;
            result.success = true;
            royaleGameRooms.push(
                generateGameRoom(result.gameRoomId, gameRoomStates.mmaking)
            );
        }

        return result;
    };


    let addInvitedPlayer = function (invitationCode) {
        // si è stati invitati: cerca la gameRoom che ha proposto la partita
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };

        for (let i = 0; i < royaleGameRooms.length; i++) {
            if (royaleGameRooms[i].gameData.code.toString() === invitationCode.toString()
                && royaleGameRooms[i].gameData.state === gameRoomStates.mmaking
                && royaleGameRooms[i].players.length < royaleGameRooms[i].gameData.maxPlayersSetting) {

                for (let j = 0; j < royaleGameRooms[i].players.length; j++) {
                    // game room trovata: se ci sono slot liberi, occupane uno
                    if (!royaleGameRooms[i].players[j].occupiedSlot) {
                        result.success = true;
                        result.gameRoomId = i;
                        result.playerId = j;
                    }
                }

                // la game room non ha player slot liberi: creane uno nuovo
                if (!result.success) {
                    result.success = true;
                    result.gameRoomId = i;
                    result.playerId = royaleGameRooms[i].players.length;
                    royaleGameRooms[result.gameRoomId].players.push(generateFreeSlot());
                }
                break;
            }
        }

        return result;
    };


    module.exports.handleValidation = function (message) {
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
            return result;
        }

        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.validated = true;
        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.nickname = message.nickname;

        result.success = true;
        result.messages.push({
            msgType: utilities.messageTypes.s_playerAdded,
            gameType: utilities.gameTypes.royale,
            gameRoomId: message.gameRoomId,
            addedPlayerId: message.playerId,
            gameData: getGameRoomData(message.gameRoomId)
        });

        return result;
    };


    module.exports.directStartMatch = function (gameRoomId) {
        let result = {
            success: false,
            messages: []
        };

        if (!gameRoomExists(gameRoomId)) {
            clearGameRoom(gameRoomId);
            result.messages.push({
                msgType: utilities.messageTypes.s_gameQuit,
                gameRoomId: gameRoomId,
                gameType: utilities.gameTypes.royale
            });
            return result;
        }

        // invia segnale di startMatch, solo nel caso in cui ci siano almeno due giocatori
        if (countValidPlayers(gameRoomId) > 1) {
            result.success = true;
            for (let i = 0; i < royaleGameRooms[gameRoomId].players.length; i++) {
                royaleGameRooms[gameRoomId].players[i].gameData.match = generateEmptyPlayerMatch();
            }
            royaleGameRooms[gameRoomId].gameData.state = utilities.gameRoomStates.playing;
            royaleGameRooms[gameRoomId].gameData.tiles = utilities.generateTiles();
            result.messages.push({
                msgType: utilities.messageTypes.s_startMatch,
                gameRoomId: gameRoomId,
                gameType: utilities.gameTypes.royale,
                tiles: royaleGameRooms[gameRoomId].gameData.tiles,
                gameData: getGameRoomData(gameRoomId)
            });

            if (royaleGameRooms[message.gameRoomId].gameData.matchCount === 0)
                callbacks.createDbGameSession(royaleGameRooms[message.gameRoomId]);

        } else {
            clearGameRoom(gameRoomId);
            result.messages.push({
                msgType: utilities.messageTypes.s_gameQuit,
                gameRoomId: gameRoomId,
                gameType: utilities.gameTypes.royale,
            });
        }
        return result;
    };


    module.exports.handlePlayerQuit = function (message) {
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

            return result;
        }

        // pulisci in maniera 'safe' lo slot giocatore, fermando i vari timer attivi
        result.success = true;
        clearTimeout(royaleGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer);
        royaleGameRooms[message.gameRoomId].players[message.playerId] = generateFreeSlot();

        // libera la game room se necessario dopo la rimozione dell'utente
        // (c'è solo un giocatore durante il gioco, o è uscito l'organizzatore di una partita instant)
        if ((royaleGameRooms[message.gameRoomId].gameData.state !== utilities.gameRoomStates.mmaking
             && countValidPlayers(message.gameRoomId) <= 1)
            || (message.playerId === 0
                && royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.startDate === undefined)) {
            clearGameRoom(message.gameRoomId);
            result.messages.push({
                msgType: utilities.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: message.gameType,
            });

        } else {
            result.messages.push({
                msgType: utilities.messageTypes.s_playerRemoved,
                gameRoomId: message.gameRoomId,
                removedPlayerId: message.playerId,
                gameType: message.gameType,
                gameData: getGameRoomData(message.gameRoomId)
            });

            if (startMatchCheck(message.gameRoomId)) {
                for (let i = 0; i < royaleGameRooms[message.gameRoomId].players.length; i++) {
                    royaleGameRooms[message.gameRoomId].players[i].gameData.match = generateEmptyPlayerMatch();
                }
                royaleGameRooms[message.gameRoomId].gameData.state = utilities.gameRoomStates.playing;
                royaleGameRooms[message.gameRoomId].gameData.tiles = utilities.generateTiles();
                result.messages.push({
                    msgType: utilities.messageTypes.s_startMatch,
                    gameRoomId: message.gameRoomId,
                    gameType: utilities.gameTypes.royale,
                    tiles: royaleGameRooms[message.gameRoomId].gameData.tiles,
                    gameData: getGameRoomData(message.gameRoomId)
                });

            } else if (startAnimationCheck(message.gameRoomId)) {
                result.messages.push({
                    msgType: utilities.messageTypes.s_startAnimation,
                    gameRoomId: message.gameRoomId,
                    gameType: utilities.gameTypes.royale,
                    gameData: getGameRoomData(message.gameRoomId)
                });
            } else if (endMatchCheck(message.gameRoomId)) {
                royaleGameRooms[message.gameRoomId].gameData.state = utilities.gameRoomStates.aftermatch;
                royaleGameRooms[message.gameRoomId].gameData.matchCount++;

                result.messages.push({
                    msgType: utilities.messageTypes.s_endMatch,
                    gameRoomId: message.gameRoomId,
                    gameType: utilities.gameTypes.royale,
                    gameData: getGameRoomData(message.gameRoomId)
                });
            }
        }

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

            return result;
        }

        result.success = true;
        clearTimeout(royaleGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer);
        royaleGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer
            = generateHeartbeatTimer(message.gameRoomId, message.playerId);

        return result;
    };


    module.exports.handleReadyMessage = function (message) {
        let result = {
            success: false, // success: startmatch
            messages: []
        };

        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.ready = true;
        result.success = startMatchCheck(message.gameRoomId);

        if (result.success && countValidPlayers(message.gameRoomId) > 1) {
            for (let i = 0; i < royaleGameRooms[message.gameRoomId].players.length; i++) {
                royaleGameRooms[message.gameRoomId].players[i].gameData.ready = false;
                royaleGameRooms[message.gameRoomId].players[i].gameData.match = generateEmptyPlayerMatch();
            }
            royaleGameRooms[message.gameRoomId].gameData.state = utilities.gameRoomStates.playing;
            royaleGameRooms[message.gameRoomId].gameData.tiles = utilities.generateTiles();
            result.messages.push({
                msgType: utilities.messageTypes.s_startMatch,
                gameRoomId: message.gameRoomId,
                gameType: utilities.gameTypes.royale,
                tiles: royaleGameRooms[message.gameRoomId].gameData.tiles,
                gameData: getGameRoomData(message.gameRoomId)
            });

            if (royaleGameRooms[message.gameRoomId].gameData.matchCount === 0)
                callbacks.createDbGameSession(royaleGameRooms[message.gameRoomId]);

        } else if (result.success && countValidPlayers(message.gameRoomId) <= 1) {
            // non ci sono abbastanza giocatori, ma è ora di iniziare il match: esci
            clearGameRoom(message.gameRoomId);
            result.messages.push({
                msgType: utilities.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: utilities.gameTypes.royale
            });
        }

        return result;
    };


    module.exports.handlePositionedMessage = function (message) {
        let result = {
            success: false,
            messages: []
        };

        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.positioned = true;
        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.time = message.matchTime;
        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.side = message.side;
        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.distance = message.distance;
        result.success = startAnimationCheck(message.gameRoomId);

        if (result.success) {
            result.messages.push({
                msgType: utilities.messageTypes.s_startAnimation,
                gameRoomId: message.gameRoomId,
                gameType: utilities.gameTypes.royale,
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

        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.animationEnded = true;
        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.points = message.matchPoints;
        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.points += message.matchPoints;
        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.pathLength = message.pathLength;

        if (message.winner) {
            royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.wonMatches++;
            royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.winner = true;
        }
        result.success = endMatchCheck(message.gameRoomId);

        if (result.success) {
            royaleGameRooms[message.gameRoomId].gameData.state = utilities.gameRoomStates.aftermatch;
            royaleGameRooms[message.gameRoomId].gameData.matchCount++;

            result.messages.push({
                msgType: utilities.messageTypes.s_endMatch,
                gameRoomId: message.gameRoomId,
                gameType: utilities.gameTypes.royale,
                gameData: getGameRoomData(message.gameRoomId)
            });

            callbacks.createDbGameMatch(royaleGameRooms[message.gameRoomId]);
        }

        return result;
    };


    // libera una game room in maniera safe, pulendo i timer di heartbeat, impostando tutti i parametri
    // free game room, e pulendo le eventuali game room vuote in fondo all'array
    let clearGameRoom = function (gameRoomId) {
        if (gameRoomExists(gameRoomId)) {
            for (let j = 0; j < royaleGameRooms[gameRoomId].players.length; j++) {
                if (royaleGameRooms[gameRoomId].players[j].heartBeatTimer !== undefined)
                    clearTimeout(royaleGameRooms[gameRoomId].players[j].heartBeatTimer);
            }

            royaleGameRooms[gameRoomId] = generateGameRoom(gameRoomId, gameRoomStates.free);
        }

        // rimuovi se presenti le gameRoom vuote consecutive in fondo all'array
        for (let i = royaleGameRooms.length - 1; i >= 0; i--) {
            if (royaleGameRooms[i].gameData.state === gameRoomStates.free)
                royaleGameRooms.splice(i, 1);
            else
                break;
        }
    };


    let countValidPlayers = function (gameRoomId) {
        let playersCount = 0;
        for (let i = 0; i < royaleGameRooms[gameRoomId].players.length; i++) {
            if (royaleGameRooms[gameRoomId].players[i].occupiedSlot
                && royaleGameRooms[gameRoomId].players[i].gameData.validated)
                playersCount++;
        }
        return playersCount;
    };


    let slotExists = function (gameRoomId, playerId) {
        return royaleGameRooms[gameRoomId] !== undefined
            && royaleGameRooms[gameRoomId].players[playerId] !== undefined;
    };


    let gameRoomExists = function (gameRoomId) {
        return royaleGameRooms[gameRoomId] !== undefined;
    };


    let generateGameRoom = function (gameRoomId, state) {
        return {
            players: [generateFreeSlot()],
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


    // ritorna l'oggetto gameData formattato per la sincronizzazione con il client
    let getGameRoomData = function (gameRoomId) {
        if (gameRoomExists(gameRoomId)) {
            let gRoomData = {};
            gRoomData.general = royaleGameRooms[gameRoomId].gameData;
            gRoomData.players = [];
            for (let i = 0; i < royaleGameRooms[gameRoomId].players.length; i++) {
                if (royaleGameRooms[gameRoomId].players[i].occupiedSlot &&
                    royaleGameRooms[gameRoomId].players[i].gameData.validated)
                    gRoomData.players.push(royaleGameRooms[gameRoomId].players[i].gameData)
            }
            return gRoomData;
        }
    };


    let startMatchCheck = function (gameRoomId) {
        if (!gameRoomExists(gameRoomId)) {
            return;
        }

        if (royaleGameRooms[gameRoomId].gameData.state === utilities.gameRoomStates.mmaking) {
            // primo match
            return slotExists(gameRoomId, 0) && royaleGameRooms[gameRoomId].players[0].gameData.ready;

        } else {
            // match seguenti
            let allReady = true;
            for (let i = 0; i < royaleGameRooms[gameRoomId].players.length; i++) {
                if (royaleGameRooms[gameRoomId].players[i].occupiedSlot &&
                    !royaleGameRooms[gameRoomId].players[i].gameData.ready) {
                    allReady = false;
                    break;
                }
            }

            return allReady;
        }
    };


    let startAnimationCheck = function (gameRoomId) {
        if (!gameRoomExists(gameRoomId)) {
            return;
        }

        let allPositioned = true;
        for (let i = 0; i < royaleGameRooms[gameRoomId].players.length; i++) {
            if (royaleGameRooms[gameRoomId].players[i].occupiedSlot &&
                !royaleGameRooms[gameRoomId].players[i].gameData.match.positioned) {
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
        for (let i = 0; i < royaleGameRooms[gameRoomId].players.length; i++) {
            if (royaleGameRooms[gameRoomId].players[i].occupiedSlot &&
                !royaleGameRooms[gameRoomId].players[i].gameData.match.animationEnded) {
                allAnimationFinished = false;
                break;
            }
        }

        return allAnimationFinished;
    };


    let generateUniqueCode = function () {
        let newCode = '0000';
        let unique = true;
        do {
            newCode = (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString();

            unique = true;
            for (let i = 0; i < royaleGameRooms.length; i++) {
                if (newCode === royaleGameRooms[i].code)
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
            winner: false,
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
            gameName: "RoyaleMatch",
            tiles: undefined,
            timerSetting: 30000,
            startDate: undefined,
            maxPlayersSetting: 20,
            state: (state !== undefined) ? state : gameRoomStates.free,
            gameType: utilities.gameTypes.royale,
            code: generateUniqueCode()
        }
    };
}());