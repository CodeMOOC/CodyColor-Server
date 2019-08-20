/*
 * gameRoomsRoyale.js: file per la gestione dell'array gameRoom ad accoppiamento personalizzato dei giocatori, per
 * partite di tipo Battle Royale.
 */
(function () {
    let rabbit = require("./rabbit");
    let utils = require("./utils");
    let gameRoomsUtils = require("./gameRoomsUtils");
    let royaleGameRooms = [];
    let callbacks = {};

    // ogni secondo si va a controllare se è il momento di avviare una partita
    let startTimer = setInterval(function () {
        for (let i = 0; i < royaleGameRooms.length; i++) {
            if (royaleGameRooms[i].gameData.startDate !== undefined
                && (royaleGameRooms[i].gameData.startDate - (new Date()).getTime()) <= 0) {
                callbacks.onStartTimerExpired(i);
                royaleGameRooms[i].gameData.startDate = undefined;
            }
        }
    }, 1000);

    /* -------------------------------------------------------------------------------------------- *
     * EXPORTED UTILITIES: metodi che forniscono funzioni utili per monitorare lo stato della
     * gameRoom dall'esterno del modulo.
     * -------------------------------------------------------------------------------------------- */

    // stampa a console lo stato attuale delle game room
    module.exports.printGameRooms = function() {
        utils.printLog('New royale game room configuration:');

        if (royaleGameRooms.length <= 0) {
            utils.printLog('empty');

        } else {
            let gameRoomString = '';
            for (let gameRoomIndex = 0; gameRoomIndex < royaleGameRooms.length; gameRoomIndex++) {
                gameRoomString += gameRoomIndex.toString() + '[';
                for (let playerIndex = 0; playerIndex < royaleGameRooms[gameRoomIndex].players.length; playerIndex++) {
                    gameRoomString += (royaleGameRooms[gameRoomIndex].players[playerIndex].occupiedSlot ? 'x' : 'o');
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
        for (let i = 0; i < royaleGameRooms.length; i++) {
            for (let j = 0; j < royaleGameRooms[i].players.length; j++)
                if (royaleGameRooms[i].players[j].occupiedSlot)
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
    module.exports.handleGameRequest = function (message) {
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };
        // success === true: game room trovata/generata

        let organizer = false;

        if (message.code === '0000') {
            result = addOrganizerPlayer();
            organizer = true;
        } else if (message.code !== undefined)
            result = addInvitedPlayer(message.code);

        // codice non valido: invia response con codice 0000
        if (!result.success) {
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameResponse,
                gameType: gameRoomsUtils.gameTypes.royale,
                code: '0000',
                correlationId: message.correlationId,
            });
            return result;
        }

        // inserisci il giocatore nella game room
        royaleGameRooms[result.gameRoomId].players[result.playerId]
            = generateOccupiedSlot(result.gameRoomId, result.playerId, message.userId);

        // valida giocatore, se nickname già impostato
        if (message.nickname !== undefined && message.nickname !== "Anonymous") {
            royaleGameRooms[result.gameRoomId].players[result.playerId].gameData.nickname = message.nickname;
            royaleGameRooms[result.gameRoomId].players[result.playerId].gameData.validated = true;
        }

        // imposta vari gameData
        royaleGameRooms[result.gameRoomId].gameData.gameRoomId = result.gameRoomId;
        royaleGameRooms[result.gameRoomId].players[result.playerId].gameData.playerId = result.playerId;

        if (organizer) {
            royaleGameRooms[result.gameRoomId].players[result.playerId].gameData.organizer = true;
            royaleGameRooms[result.gameRoomId].gameData.timerSetting = message.timerSetting;
            royaleGameRooms[result.gameRoomId].gameData.gameName = message.gameName;
            royaleGameRooms[result.gameRoomId].gameData.maxPlayersSetting = message.maxPlayersSetting;
            royaleGameRooms[result.gameRoomId].gameData.startDate = message.startDate;
        }

        // crea i messaggi di risposta
        result.messages.push({
            msgType: rabbit.messageTypes.s_gameResponse,
            gameType: gameRoomsUtils.gameTypes.royale,
            gameRoomId: result.gameRoomId,
            playerId: result.playerId,
            code: royaleGameRooms[result.gameRoomId].gameData.code,
            correlationId: message.correlationId,
            gameData: getGameRoomData(result.gameRoomId)
        });

        if (royaleGameRooms[result.gameRoomId].players[result.playerId].gameData.validated && !organizer) {
            result.messages.push({
                msgType: rabbit.messageTypes.s_playerAdded,
                gameType: gameRoomsUtils.gameTypes.royale,
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

        if (!slotExists(message.gameRoomId, message.playerId)) {
            clearGameRoom(message.gameRoomId);
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.royale
            });
            return result;
        }

        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.validated = true;
        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.nickname = message.nickname;

        result.success = true;
        result.messages.push({
            msgType: rabbit.messageTypes.s_playerAdded,
            gameType: gameRoomsUtils.gameTypes.royale,
            gameRoomId: message.gameRoomId,
            addedPlayerId: message.playerId,
            gameData: getGameRoomData(message.gameRoomId)
        });

        return result;
    };


    // allo scadere del timer di startMatch, il match in Battle Royale, settato con start in data specifica
    // deve partire automaticamente, senza la necessità di segnali di ready da parte dei client
    module.exports.directStartMatch = function (gameRoomId) {
        let result = {
            success: false,
            messages: []
        };

        if (!gameRoomExists(gameRoomId)) {
            clearGameRoom(gameRoomId);
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
                gameRoomId: gameRoomId,
                gameType: gameRoomsUtils.gameTypes.royale
            });
            return result;
        }

        // invia segnale di startMatch, solo nel caso in cui ci siano almeno due giocatori
        if (countValidPlayers(gameRoomId) > 1) {
            result.success = true;
            for (let i = 0; i < royaleGameRooms[gameRoomId].players.length; i++) {
                royaleGameRooms[gameRoomId].players[i].gameData.match = generateEmptyPlayerMatch();
            }
            royaleGameRooms[gameRoomId].gameData.state = gameRoomsUtils.gameRoomStates.playing;
            royaleGameRooms[gameRoomId].gameData.tiles = gameRoomsUtils.generateTiles();
            result.messages.push({
                msgType: rabbit.messageTypes.s_startMatch,
                gameRoomId: gameRoomId,
                gameType: gameRoomsUtils.gameTypes.royale,
                tiles: royaleGameRooms[gameRoomId].gameData.tiles,
                gameData: getGameRoomData(gameRoomId)
            });

            if (royaleGameRooms[gameRoomId].gameData.matchCount === 0)
                callbacks.createDbGameSession(royaleGameRooms[gameRoomId]);

        } else {
            clearGameRoom(gameRoomId);
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
                gameRoomId: gameRoomId,
                gameType: gameRoomsUtils.gameTypes.royale,
            });
        }
        return result;
    };


    // all'arrivo di un messaggio playerQuit da un client, o della scadenza di un heartbeat,
    // viene rimosso il giocatore dalla gameRoom e notificato l'abbandono agli altri client in ascolto
    module.exports.handlePlayerQuit = function (message) {
        let result = {
            success: false,
            messages: []
        };

        if (!slotExists(message.gameRoomId, message.playerId)) {
            clearGameRoom(message.gameRoomId);
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.royale
            });

            return result;
        }

        // pulisci in maniera 'safe' lo slot giocatore, fermando i vari timer attivi
        result.success = true;
        clearTimeout(royaleGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer);
        royaleGameRooms[message.gameRoomId].players[message.playerId] = generateFreeSlot();

        // libera la game room se necessario dopo la rimozione dell'utente
        // (c'è solo un giocatore durante il gioco, o è uscito l'organizzatore di una partita instant)
        if ((royaleGameRooms[message.gameRoomId].gameData.state !== gameRoomsUtils.gameRoomStates.mmaking
             && countValidPlayers(message.gameRoomId) <= 1)
            || (message.playerId === 0
                && royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.startDate === undefined
                && royaleGameRooms[message.gameRoomId].gameData.state === gameRoomsUtils.gameRoomStates.mmaking)) {
            clearGameRoom(message.gameRoomId);
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.royale,
            });

        } else {
            result.messages.push({
                msgType: rabbit.messageTypes.s_playerRemoved,
                gameRoomId: message.gameRoomId,
                removedPlayerId: message.playerId,
                gameType: gameRoomsUtils.gameTypes.royale,
                gameData: getGameRoomData(message.gameRoomId)
            });

            if (startMatchCheck(message.gameRoomId)) {
                for (let i = 0; i < royaleGameRooms[message.gameRoomId].players.length; i++) {
                    royaleGameRooms[message.gameRoomId].players[i].gameData.match = generateEmptyPlayerMatch();
                }
                royaleGameRooms[message.gameRoomId].gameData.state = gameRoomsUtils.gameRoomStates.playing;
                royaleGameRooms[message.gameRoomId].gameData.tiles = gameRoomsUtils.generateTiles();
                result.messages.push({
                    msgType: rabbit.messageTypes.s_startMatch,
                    gameRoomId: message.gameRoomId,
                    gameType: gameRoomsUtils.gameTypes.royale,
                    tiles: royaleGameRooms[message.gameRoomId].gameData.tiles,
                    gameData: getGameRoomData(message.gameRoomId)
                });

            } else if (startAnimationCheck(message.gameRoomId)) {
                result.messages.push({
                    msgType: rabbit.messageTypes.s_startAnimation,
                    gameRoomId: message.gameRoomId,
                    gameType: gameRoomsUtils.gameTypes.royale,
                    gameData: getGameRoomData(message.gameRoomId)
                });
            } else if (endMatchCheck(message.gameRoomId)) {
                royaleGameRooms[message.gameRoomId].gameData.state = gameRoomsUtils.gameRoomStates.aftermatch;
                royaleGameRooms[message.gameRoomId].gameData.matchCount++;

                result.messages.push({
                    msgType: rabbit.messageTypes.s_endMatch,
                    gameRoomId: message.gameRoomId,
                    gameType: gameRoomsUtils.gameTypes.royale,
                    gameData: getGameRoomData(message.gameRoomId)
                });
            }
        }

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
                gameType: gameRoomsUtils.gameTypes.royale
            });

        } else if (!royaleGameRooms[message.gameRoomId].players[message.playerId].occupiedSlot) {
            callbacks.onHeartbeatExpired(message.gameRoomId, message.playerId, gameRoomsUtils.gameTypes.royale);

        } else {
            // heartbeat valido; resetta timer
            result.success = true;
            clearTimeout(royaleGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer);
            royaleGameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer
                = generateHeartbeatTimer(message.gameRoomId, message.playerId);

        }

        return result;
    };


    // un messaggio di ready indica che un client è pronto ad iniziare una nuova partita. Al realizzarsi
    // di determinati criteri, legati allo stato ready dei client collegati alla game room, viene inviato
    // il segnale di via libera per l'inizio di un nuovo match
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
            royaleGameRooms[message.gameRoomId].gameData.state = gameRoomsUtils.gameRoomStates.playing;
            royaleGameRooms[message.gameRoomId].gameData.tiles = gameRoomsUtils.generateTiles();
            result.messages.push({
                msgType: rabbit.messageTypes.s_startMatch,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.royale,
                tiles: royaleGameRooms[message.gameRoomId].gameData.tiles,
                gameData: getGameRoomData(message.gameRoomId)
            });

            if (royaleGameRooms[message.gameRoomId].gameData.matchCount === 0)
                callbacks.createDbGameSession(royaleGameRooms[message.gameRoomId]);

        } else if (result.success && countValidPlayers(message.gameRoomId) <= 1) {
            // non ci sono abbastanza giocatori, ma è ora di iniziare il match: esci
            clearGameRoom(message.gameRoomId);
            result.messages.push({
                msgType: rabbit.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.royale
            });
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

        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.positioned = true;
        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.time = message.matchTime;
        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.side = message.side;
        royaleGameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.distance = message.distance;
        result.success = startAnimationCheck(message.gameRoomId);

        if (result.success) {
            result.messages.push({
                msgType: rabbit.messageTypes.s_startAnimation,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.royale,
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
            royaleGameRooms[message.gameRoomId].gameData.state = gameRoomsUtils.gameRoomStates.aftermatch;
            royaleGameRooms[message.gameRoomId].gameData.matchCount++;

            result.messages.push({
                msgType: rabbit.messageTypes.s_endMatch,
                gameRoomId: message.gameRoomId,
                gameType: gameRoomsUtils.gameTypes.royale,
                gameData: getGameRoomData(message.gameRoomId)
            });

            callbacks.createDbGameMatch(royaleGameRooms[message.gameRoomId]);
        }

        return result;
    };


    /* -------------------------------------------------------------------------------------------- *
     * UTILITIES: metodi interni di appoggio, utilizzato nei vari Handle Methods.
     * -------------------------------------------------------------------------------------------- */

    let addOrganizerPlayer = function () {
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };

        // cerca il primo slot libero tra le gameRoom
        for (let i = 0; i < royaleGameRooms.length; i++) {
            if (royaleGameRooms[i].gameData.state === gameRoomsUtils.gameRoomStates.free) {
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
                generateGameRoom(result.gameRoomId, gameRoomsUtils.gameRoomStates.mmaking)
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
                && royaleGameRooms[i].gameData.state === gameRoomsUtils.gameRoomStates.mmaking
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


    // libera una game room in maniera safe, pulendo i timer di heartbeat, impostando tutti i parametri
    // free game room, e pulendo le eventuali game room vuote in fondo all'array
    let clearGameRoom = function (gameRoomId) {
        if (gameRoomExists(gameRoomId)) {
            for (let j = 0; j < royaleGameRooms[gameRoomId].players.length; j++) {
                if (royaleGameRooms[gameRoomId].players[j].heartBeatTimer !== undefined)
                    clearTimeout(royaleGameRooms[gameRoomId].players[j].heartBeatTimer);
            }

            royaleGameRooms[gameRoomId] = generateGameRoom(gameRoomId, gameRoomsUtils.gameRoomStates.free);
        }

        // rimuovi se presenti le gameRoom vuote consecutive in fondo all'array
        for (let i = royaleGameRooms.length - 1; i >= 0; i--) {
            if (royaleGameRooms[i].gameData.state === gameRoomsUtils.gameRoomStates.free)
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
            callbacks.onHeartbeatExpired(gameRoomId, playerId, gameRoomsUtils.gameTypes.royale)
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

        if (royaleGameRooms[gameRoomId].gameData.state === gameRoomsUtils.gameRoomStates.mmaking) {
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


    /* -------------------------------------------------------------------------------------------- *
     * INITIALIZERS: metodi interni che restituiscono un oggetto dati di gioco 'pulito', nel
     * momento in cui sia necessario resettarla.
     * -------------------------------------------------------------------------------------------- */

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
            state: (state !== undefined) ? state : gameRoomsUtils.gameRoomStates.free,
            gameType: gameRoomsUtils.gameTypes.royale,
            code: gameRoomsUtils.generateUniqueCode(royaleGameRooms)
        }
    };
}());