/*
 * gameRoomsCustom.js: file per la gestione dell'array gameRoom ad accoppiamento personalizzato dei giocatori.
 */
(function () {
    let rabbit = require("./rabbit");
    let utils = require("./utils");
    let gameRoomsUtils = require("./gameRoomsUtils");
    let customGameRooms = [];
    let callbacks = {};


    /* -------------------------------------------------------------------------------------------- *
    * EXPORTED UTILITIES: metodi che forniscono funzioni utili per monitorare lo stato della
    * gameRoom dall'esterno del modulo.
    * -------------------------------------------------------------------------------------------- */

    // stampa a console lo stato attuale delle game room
    module.exports.printGameRooms = function() {
        utils.printLog('New custom game room configuration:');

        if (customGameRooms.length <= 0) {
            utils.printLog('empty');

        } else {
            let gameRoomString = '';
            for (let gameRoomIndex = 0; gameRoomIndex < customGameRooms.length; gameRoomIndex++) {
                gameRoomString += gameRoomIndex.toString() + '[';
                for (let playerIndex = 0; playerIndex < customGameRooms[gameRoomIndex].players.length; playerIndex++) {
                    gameRoomString += (customGameRooms[gameRoomIndex].players[playerIndex].occupiedSlot ? 'x' : 'o');
                }
                gameRoomString += '] ';
                if ((gameRoomIndex + 1) % 4 === 0) {
                    utils.printLog(gameRoomString);
                    gameRoomString = '';
                }
            }
            if (gameRoomString !== '')
                utils.printLog(gameRoomString);
        }
    };


    // restituisce il numero di giocatori validati presenti
    module.exports.getConnectedPlayers = function () {
        let connectedPlayers = 0;
        for (let i = 0; i < customGameRooms.length; i++) {
            for (let j = 0; j < customGameRooms[i].players.length; j++)
                if (customGameRooms[i].players[j].occupiedSlot)
                    connectedPlayers++;
        }
        return connectedPlayers;
    };


    // inizializza callback utilizzati dal modulo
    module.exports.setCallbacks = function (newCallbacks) {
        callbacks = newCallbacks;
    };



    /* -------------------------------------------------------------------------------------------- *
     * HANDLE METHODS: metodi che permettono di reagire all'arrivo di determinati messaggi. Si
     * compongono di una struttura comune:
     *  - Un oggetto 'result' di appoggio viene creato all'inizio della funzione. Questo raccoglie
     *    dati che verranno utilizzati per la generazione dell'output finale della stessa;
     *  - Viene modificato il contenuto dell'array gameRooms, a seconda dello scopo della funzione;
     *  - Ogni funzione di handle restituisce infine l'oggetto result, comprensivo di un array di
     *    messaggi, poi inviati tramite Rabbit ai rispettivi destinatari.
     * -------------------------------------------------------------------------------------------- */

    // aggiunge un riferimento all'utente nel primo slot valido dell'array game room.
    module.exports.handleGameRequest = function(message) {
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };
        // success === true: game room trovata/generata

        let organizer = false;

        if (message.code === '0000') {
            organizer = true;
            result = addOrganizerPlayer();
        } else if (message.code !== undefined)
            result = addInvitedPlayer(message.code);

        // codice non valido: invia response con codice 0000
        if (!result.success) {
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameResponse,
                gameType: message.gameType,
                code: '0000',
                correlationId: message.correlationId,
            });
            return result;
        }

        // inserisci il giocatore nella game room
        customGameRooms[result.gameRoomId].players[result.playerId]
            = generateOccupiedSlot(result.gameRoomId, result.playerId, message.userId);

        // valida giocatore, se nickname già impostato
        if (message.nickname !== undefined && message.nickname !== "Anonymous") {
            customGameRooms[result.gameRoomId].players[result.playerId].gameData.nickname = message.nickname;
            customGameRooms[result.gameRoomId].players[result.playerId].gameData.validated = true;
        }

        // imposta vari gameData
        customGameRooms[result.gameRoomId].gameData.gameRoomId = result.gameRoomId;
        customGameRooms[result.gameRoomId].players[result.playerId].gameData.playerId = result.playerId;

        if (organizer) {
            customGameRooms[result.gameRoomId].players[0].gameData.organizer = true;
            customGameRooms[result.gameRoomId].gameData.timerSetting = message.timerSetting;
        }

        // crea i messaggi di risposta
        result.messages.push({
            msgType: rabbit.messageTypes.s_gameResponse,
            gameType: message.gameType,
            gameRoomId: result.gameRoomId,
            playerId: result.playerId,
            code: customGameRooms[result.gameRoomId].gameData.code,
            correlationId: message.correlationId,
            gameData: getGameRoomData(result.gameRoomId)
        });

        if (customGameRooms[result.gameRoomId].players[result.playerId].gameData.validated && !organizer) {
            result.messages.push({
                msgType: rabbit.messageTypes.s_playerAdded,
                gameType: message.gameType,
                gameRoomId: result.gameRoomId,
                addedPlayerId: result.playerId,
                gameData: getGameRoomData(result.gameRoomId)
            });
        }

        callbacks.onGameRoomsUpdated();
        return result;
    };


    // valida un giocatore, cioe' setta il nickname di questo a seguito della ricezione di un messaggio
    // di validazione. Viene quindi notificato che un nuovo giocatore è ora ufficialmente entrato
    // a far parte della partita.
    module.exports.handleValidation = function (message) {
        let result = {
            success: false,
            messages: []
        };

        customGameRooms[message.gameRoomId].players[message.playerId].gameData.validated = true;
        customGameRooms[message.gameRoomId].players[message.playerId].gameData.nickname = message.nickname;

        result.success = true;
        result.messages.push({
            msgType: rabbit.messageTypes.s_playerAdded,
            gameType: message.gameType,
            gameRoomId: message.gameRoomId,
            addedPlayerId: message.playerId,
            gameData: getGameRoomData(message.gameRoomId)
        });

        return result;
    };


    // all'arrivo di un messaggio playerQuit da un client, o della scadenza di un heartbeat,
    // viene rimosso il giocatore dalla gameRoom e notificato l'abbandono agli altri client in ascolto
    module.exports.handlePlayerQuit = function (message) {
        let result = {
            success: false,
            messages: []
        };

        // pulisci in maniera 'safe' lo slot giocatore, fermando i vari timer attivi
        clearGameRoom(message.gameRoomId);
        result.success = true;
        result.messages.push({
            msgType: rabbit.messageTypes.s_gameQuit,
            gameRoomId: message.gameRoomId,
            gameType: message.gameType,
        });

        callbacks.onGameRoomsUpdated();
        return result;
    };


    // All'arrivo di un messaggio di heartbeat da un client, viene resettato il timer corrispondente
    // nello slot della gameRoom. Se tale timer non viene aggiornato, il giocatore viene rimosso
    // automaticamente
    module.exports.handleHeartbeat = function (message) {
        let result = {
            success: false,
            messages: []
        };

        if (!slotExists(message.gameRoomId, message.playerId)) {
            clearGameRoom(message.gameRoomId);
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
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


    // un messaggio di ready indica che un client è pronto ad iniziare una nuova partita. Al realizzarsi
    // di determinati criteri, legati allo stato ready dei client collegati alla game room, viene inviato
    // il segnale di via libera per l'inizio di un nuovo match
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
            customGameRooms[message.gameRoomId].gameData.state = gameRoomsUtils.gameRoomStates.playing;
            customGameRooms[message.gameRoomId].gameData.tiles = gameRoomsUtils.generateTiles();
            result.messages.push({
                msgType: rabbit.messageTypes.s_startMatch,
                gameRoomId: message.gameRoomId,
                gameType: message.gameType,
                tiles: customGameRooms[message.gameRoomId].gameData.tiles,
                gameData: getGameRoomData(message.gameRoomId)
            });

            if (customGameRooms[message.gameRoomId].gameData.matchCount === 0)
                callbacks.createDbGameSession(customGameRooms[message.gameRoomId]);
        }

        return result;
    };


    // un messaggio positioned indica che, nel corso di un match, il giocatore ha appena posizionato
    // il proprio Roby. Aggiorna quindi l'oggetto di gioco e notifica il fatto agli avversari. In caso
    // tutti i Roby siano stati posizionati, avvia l'animazione dei robottini
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
                msgType: rabbit.messageTypes.s_startAnimation,
                gameRoomId: message.gameRoomId,
                gameType: message.gameType,
                gameData: getGameRoomData(message.gameRoomId)
            });
        }

        return result;
    };


    // il messaggio indica che un client ha concluso di mostrare l'animazione dei robottini. Quando tutti
    // hanno concluso, invia un segnale per concludere il match
    module.exports.handleEndAnimationMessage = function (message) {
        let result = {
            success: false,
            messages: []
        };
        // success === true: termina il match

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
            customGameRooms[message.gameRoomId].gameData.state = gameRoomsUtils.gameRoomStates.aftermatch;
            customGameRooms[message.gameRoomId].gameData.matchCount++;

            result.messages.push({
                msgType: rabbit.messageTypes.s_endMatch,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.custom,
                gameData: getGameRoomData(message.gameRoomId)
            });

            callbacks.createDbGameMatch(customGameRooms[message.gameRoomId]);
        }

        return result;
    };


    /* -------------------------------------------------------------------------------------------- *
     * UTILITIES: metodi interni di appoggio, utilizzato nei vari Handle Methods.
     * -------------------------------------------------------------------------------------------- */

    let addOrganizerPlayer = function() {
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };

        // cerca il primo slot libero tra le gameRoom
        for (let gRoomIndex = 0; gRoomIndex < customGameRooms.length; gRoomIndex++) {
            if (customGameRooms[gRoomIndex].state === gameRoomsUtils.gameRoomStates.free) {
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
                generateGameRoom(result.gameRoomId, gameRoomsUtils.gameRoomStates.mmaking)
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
                && customGameRooms[gRoomIndex].gameData.state === gameRoomsUtils.gameRoomStates.mmaking
                && !customGameRooms[gRoomIndex].players[1].occupiedSlot) {
                result.gameRoomId = gRoomIndex;
                result.playerId = 1;
                result.success = true;
            }
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

            customGameRooms[gameRoomId] = generateGameRoom(gameRoomId, gameRoomsUtils.gameRoomStates.free);
        }

        // rimuovi se presenti le gameRoom vuote consecutive in fondo all'array
        for (let i = customGameRooms.length - 1; i >= 0; i--) {
            if (customGameRooms[i].gameData.state === gameRoomsUtils.gameRoomStates.free)
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
            callbacks.onHeartbeatExpired(gameRoomId, playerId, gameRoomsUtils.gameTypes.custom)
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


    /* -------------------------------------------------------------------------------------------- *
     * INITIALIZERS: metodi interni che restituiscono un oggetto dati di gioco 'pulito', nel
     * momento in cui sia necessario resettarla.
     * -------------------------------------------------------------------------------------------- */

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
            state: (state !== undefined) ? state : gameRoomsUtils.gameRoomStates.free,
            timerSetting: 30000,
            gameType: gameRoomsUtils.gameTypes.custom,
            code: gameRoomsUtils.generateUniqueCode(customGameRooms)
        }
    };
}());