/*
 * gameRoomsRandom.js: file per la gestione dell'array gameRoom ad accoppiamento random
 */
(function () {
    let rabbit = require("./rabbit");
    let utils = require("./utils");
    let gameRoomsUtils = require("./gameRoomsUtils");
    let randomGameRooms = [];
    let callbacks = {};


    /* -------------------------------------------------------------------------------------------- *
    * EXPORTED UTILITIES: metodi che forniscono funzioni utili per monitorare lo stato della
    * gameRoom dall'esterno del modulo.
    * -------------------------------------------------------------------------------------------- */

    // stampa a console lo stato attuale delle game room
    module.exports.printGameRooms = function() {
        utils.printLog('New random game room configuration:');

        if (randomGameRooms.length <= 0) {
            utils.printLog('empty');

        } else {
            let gameRoomString = '';
            for (let gameRoomIndex = 0; gameRoomIndex < randomGameRooms.length; gameRoomIndex++) {
                gameRoomString += gameRoomIndex.toString() + '[';
                for (let playerIndex = 0; playerIndex < randomGameRooms[gameRoomIndex].players.length; playerIndex++) {
                    gameRoomString += (randomGameRooms[gameRoomIndex].players[playerIndex].occupiedSlot ? 'x' : 'o');
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
    module.exports.handleGameRequest = function (message) {
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };
        // success === true: game room trovata/generata

        // dà la precedenza alle gameRoom con giocatori in attesa di avversari
        for (let gRoomIndex = 0; gRoomIndex < randomGameRooms.length; gRoomIndex++) {
            if (randomGameRooms[gRoomIndex].players[0].occupiedSlot &&
                !randomGameRooms[gRoomIndex].players[1].occupiedSlot) {
                result.gameRoomId = gRoomIndex;
                result.playerId = 1;
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
                generateGameRoom(result.gameRoomId, gameRoomsUtils.gameRoomStates.mmaking)
            );
        }

        // inserisci il giocatore nella game room
        randomGameRooms[result.gameRoomId].players[result.playerId]
            = generateOccupiedSlot(result.gameRoomId, result.playerId, message.userId);

        // valida giocatore, se possibile
        if (message.nickname !== undefined && message.nickname !== "Anonymous") {
            randomGameRooms[result.gameRoomId].players[result.playerId].gameData.nickname = message.nickname;
            randomGameRooms[result.gameRoomId].players[result.playerId].gameData.validated = true;
        }

        // aggiorna gameData
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
        result.success = true;
        result.messages.push({
            msgType: rabbit.messageTypes.s_gameResponse,
            gameType: gameRoomsUtils.gameTypes.random,
            gameRoomId: result.gameRoomId,
            playerId: result.playerId,
            correlationId: message.correlationId,
            gameData: getGameRoomData(result.gameRoomId)
        });

        if (randomGameRooms[result.gameRoomId].players[result.playerId].gameData.validated) {
            result.messages.push({
                msgType: rabbit.messageTypes.s_playerAdded,
                gameType: gameRoomsUtils.gameTypes.random,
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
        // success === true: il giocatore valida il proprio nickname

        // controllo di consistenza
        if (!slotExists(message.gameRoomId, message.playerId)) {
            clearGameRoom(message.gameRoomId);
            result.success = false;
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.random
            });

            return result;
        }

        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.validated = true;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.nickname = message.nickname;
        result.success = true;

        result.messages.push({
            msgType: rabbit.messageTypes.s_playerAdded,
            gameType: gameRoomsUtils.gameTypes.random,
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
        // success === true: il giocatore esce e chiude la partita

        // pulisci in maniera 'safe' lo slot giocatore, fermando i vari timer attivi
        clearGameRoom(message.gameRoomId);
        result.success = true;
        result.messages.push({
            msgType: rabbit.messageTypes.s_gameQuit,
            gameRoomId: message.gameRoomId,
            gameType: gameRoomsUtils.gameTypes.random,
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
        // success === true: il giocatore rinnova l'heartbeat

        if (!slotExists(message.gameRoomId, message.playerId)) {
            clearGameRoom(message.gameRoomId);
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.random
            });

        } else {
            clearTimeout(randomGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer);
            randomGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer
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
        // success === true: avvia un nuovo match

        // controllo di consistenza
        if (!slotExists(message.gameRoomId, message.playerId)) {
            clearGameRoom(message.gameRoomId);
            result.success = false;
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.random
            });

            return result;
        }

        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.ready = true;
        result.success = startMatchCheck(message.gameRoomId);

        // va avviato un nuovo match
        if (result.success) {
            for (let i = 0; i < randomGameRooms[message.gameRoomId].players.length; i++) {
                randomGameRooms[message.gameRoomId].players[i].gameData.match = generateEmptyPlayerMatch();
                randomGameRooms[message.gameRoomId].players[i].gameData.ready = false;
            }
            randomGameRooms[message.gameRoomId].gameData.state = gameRoomsUtils.gameRoomStates.playing;
            randomGameRooms[message.gameRoomId].gameData.tiles = gameRoomsUtils.generateTiles();
            result.messages.push({
                msgType: rabbit.messageTypes.s_startMatch,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.random,
                tiles: randomGameRooms[message.gameRoomId].gameData.tiles,
                gameData: getGameRoomData(message.gameRoomId)
            });

            if (randomGameRooms[message.gameRoomId].gameData.matchCount === 0) {
                // si è al primo match della sessione: salva i dati sessione nel db
                callbacks.createDbGameSession(randomGameRooms[message.gameRoomId]);
            }
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
        // success === true: avvia l'animazione

        // controllo di consistenza
        if (!slotExists(message.gameRoomId, message.playerId)) {
            clearGameRoom(message.gameRoomId);
            result.success = false;
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.random
            });

            return result;
        }

        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.positioned = true;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.time = message.matchTime;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.side = message.side;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.distance = message.distance;
        result.success = startAnimationCheck(message.gameRoomId);

        if (result.success) {
            result.messages.push({
                msgType: rabbit.messageTypes.s_startAnimation,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.random,
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

        // controllo di consistenza
        if (!slotExists(message.gameRoomId, message.playerId)) {
            clearGameRoom(message.gameRoomId);
            result.success = false;
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.random
            });

            return result;
        }

        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.animationEnded = true;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.points = message.matchPoints;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.points
            += randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.points;
        randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.pathLength = message.pathLength;

        if (message.winner) {
            randomGameRooms[message.gameRoomId].players[message.playerId].gameData.wonMatches++;
            randomGameRooms[message.gameRoomId].players[message.playerId].gameData.match.winner = true;
        }
        result.success = endMatchCheck(message.gameRoomId);

        if (result.success) {
            randomGameRooms[message.gameRoomId].gameData.state = gameRoomsUtils.gameRoomStates.aftermatch;
            randomGameRooms[message.gameRoomId].gameData.matchCount++;

            result.messages.push({
                msgType: rabbit.messageTypes.s_endMatch,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.random,
                gameData: getGameRoomData(message.gameRoomId)
            });

            callbacks.createDbGameMatch(randomGameRooms[message.gameRoomId]);
        }

        return result;
    };


    /* -------------------------------------------------------------------------------------------- *
     * UTILITIES: metodi interni di appoggio, utilizzato nei vari Handle Methods.
     * -------------------------------------------------------------------------------------------- */

    let clearGameRoom = function(gameRoomId) {
        // pulisci in maniera 'safe' lo slot giocatore, fermando i vari timer attivi
        if (gameRoomExists(gameRoomId)) {
            for (let j = 0; j < randomGameRooms[gameRoomId].players.length; j++) {
                if (randomGameRooms[gameRoomId].players[j].heartBeatTimer !== undefined)
                    clearTimeout(randomGameRooms[gameRoomId].players[j].heartBeatTimer);
            }

            randomGameRooms[gameRoomId] = generateGameRoom(gameRoomId, gameRoomsUtils.gameRoomStates.free);
        }

        // rimuovi se presenti le gameRoom vuote consecutive in fondo all'array
        for (let i = randomGameRooms.length - 1; i >= 0; i--) {
            if (randomGameRooms[i].gameData.state === gameRoomsUtils.gameRoomStates.free)
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
            sessionId: undefined,
            gameData: generateGeneralGameData(gameRoomId, state)
        };
    };


    let generateFreeSlot = function () {
        return {
            occupiedSlot: false,
            id: undefined,
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
            callbacks.onHeartbeatExpired(gameRoomId, playerId, gameRoomsUtils.gameTypes.random)
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
            gameType: gameRoomsUtils.gameTypes.random
        }
    };
}());