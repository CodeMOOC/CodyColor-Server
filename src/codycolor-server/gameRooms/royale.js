/*
 * royale.js: file per la gestione dell'array gameRoom ad accoppiamento personalizzato dei giocatori, per
 * partite di tipo Battle Royale.
 */
(function () {
    let broker = require("../communication/broker");
    let logs = require("../communication/logs");
    let utils = require("./gameRoomsUtils");
    let versions = require('../versions');

    let gameRooms = [];
    let callbacks = {};

    // ogni secondo si va a controllare se è il momento di avviare una partita
    setInterval(function () {
        for (let i = 0; i < gameRooms.length; i++) {
            if (gameRooms[i].gameData.scheduledStart
                && (gameRooms[i].startDate - (new Date()).getTime()) <= 0
                && gameRooms[i].gameData.state === utils.states.mmaking) {
                callbacks.onStartTimerExpired(i);
            }
        }
    }, 1000);

    /* -------------------------------------------------------------------------------------------- *
     * EXPORTED UTILITIES: metodi che forniscono funzioni utili per monitorare lo stato della
     * gameRoom dall'esterno del modulo.
     * -------------------------------------------------------------------------------------------- */

    // stampa a console lo stato attuale delle game room
    module.exports.printGameRooms = function() {
        logs.printLog('New royale game room configuration:');

        if (gameRooms.length <= 0) {
            logs.printLog('empty');

        } else {
            let gameRoomString = '';
            for (let gameRoomIndex = 0; gameRoomIndex < gameRooms.length; gameRoomIndex++) {
                gameRoomString += gameRoomIndex.toString() + '[';
                for (let playerIndex = 0; playerIndex < gameRooms[gameRoomIndex].players.length; playerIndex++) {
                    gameRoomString += (gameRooms[gameRoomIndex].players[playerIndex].occupiedSlot ? 'x' : 'o');
                }
                gameRoomString += '] ';
                if ((gameRoomIndex + 1) % 4 === 0) {
                    logs.printLog(gameRoomString);
                    gameRoomString = '';
                }
            }
            if (gameRoomString !== '')
                logs.printLog(gameRoomString);
        }
    };


    // restituisce il numero di giocatori validati presenti
    module.exports.getConnectedPlayers = function () {
        let connectedPlayers = 0;
        for (let i = 0; i < gameRooms.length; i++) {
            for (let j = 0; j < gameRooms[i].players.length; j++)
                if (gameRooms[i].players[j].occupiedSlot)
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

        if (message.clientVersion !== versions.requiredClient && message.wallVersion !== versions.requiredWall) {
            // accetta la richiesta solo nel caso in cui il client sia aggiornato
           result.success = false;

        } else if (message.general.code === '0000') {
            // code 0000 nella richiesta: il client vuole creare una nuova partita
            result = addOrganizerPlayer(message.wallUser);
            organizer = true;

        } else if (message.general.code !== undefined) {
            // il client è stato invitato: controlla validità codice; nel caso aggiungilo
            result = addInvitedPlayer(message.general.code);
        }

        // codice non valido: invia response con codice 0000
        if (!result.success) {
            result.messages.push({
                msgType: broker.messageTypes.s_gameResponse,
                gameType: utils.gameTypes.royale,
                code: '0000',
                correlationId: message.correlationId,
            });
            return result;
        }

        // se si arriva a questo punto, il giocatore ha il permesso di occupare lo slot, e configurare la game room.
        // Aggiungi quindi il giocatore e genera il messaggio di risposta
        gameRooms[result.gameRoomId].players[result.playerId]
            = generateOccupiedSlot(result.gameRoomId, result.playerId, message.userId, message.general.startDate);

        // valida giocatore, se nickname già impostato
        if (message.user.nickname !== undefined && message.user.nickname !== "Anonymous") {
            gameRooms[result.gameRoomId].players[result.playerId].gameData.nickname = message.user.nickname;
            gameRooms[result.gameRoomId].players[result.playerId].gameData.validated = true;
        }

        // imposta vari gameData
        gameRooms[result.gameRoomId].gameData.gameRoomId = result.gameRoomId;
        gameRooms[result.gameRoomId].players[result.playerId].gameData.playerId = result.playerId;

        if (organizer) {
            gameRooms[result.gameRoomId].gameData.timerSetting = message.general.timerSetting;
            gameRooms[result.gameRoomId].gameData.gameName = message.general.gameName;
            gameRooms[result.gameRoomId].gameData.maxPlayersSetting = message.general.maxPlayersSetting;
            gameRooms[result.gameRoomId].startDate = message.general.startDate;
            gameRooms[result.gameRoomId].gameData.scheduledStart = message.general.startDate !== undefined;
        }

        // poni come organizzatore regolarmente nel caso di un match normale,
        // o se si è il primo umano in un wallMatch, nel caso di un un match Wall
        if ((organizer && message.wallUser !== true) || isFirstHumanInWallMatch(result.gameRoomId, result.playerId)) {
            gameRooms[result.gameRoomId].players[result.playerId].gameData.organizer = true;
        }

        // poni in ready il giocatore wall, e togli questo il flag organizer
        if (!!message.wallUser && result.playerId === 0) {
            gameRooms[result.gameRoomId].players[result.playerId].gameData.ready = true;
            gameRooms[result.gameRoomId].players[result.playerId].gameData.organizer = false;
        }

        // nel caso in cui la partita sia ad avvio programmato, calcola i millisecondi mancanti all'avvio
        // ciò è necessario per impostare un countdown di avvio univoco per tutti i client, potendo ogni client
        // disporre di un clock interno differente
        let msToStart = undefined;
        if (gameRooms[result.gameRoomId].gameData.scheduledStart) {
            msToStart = gameRooms[result.gameRoomId].startDate - (new Date()).getTime();
        }

        // crea i messaggi di risposta
        result.messages.push({
            msgType: broker.messageTypes.s_gameResponse,
            gameRoomId: result.gameRoomId,
            playerId: result.playerId,
            gameType: utils.gameTypes.royale,
            msToStart: msToStart,
            correlationId: message.correlationId,
            code: gameRooms[result.gameRoomId].gameData.code,
            general: utils.getGeneralData(gameRooms,result.gameRoomId),
            user: utils.getPlayerData(gameRooms,result.gameRoomId, result.playerId),
            aggregated: utils.getAggregatedData(gameRooms,result.gameRoomId),
        });

        if (gameRooms[result.gameRoomId].players[result.playerId].gameData.validated && !organizer) {
            result.messages.push({
                msgType: broker.messageTypes.s_playerAdded,
                gameType: utils.gameTypes.royale,
                gameRoomId: result.gameRoomId,
                addedPlayerId: result.playerId,
                addedPlayer: utils.getPlayerData(gameRooms,result.gameRoomId, result.playerId),
                aggregated: utils.getAggregatedData(gameRooms,result.gameRoomId),
            });
        }

        callbacks.onGameRoomsUpdated();
        return result;
    };


    let isFirstHumanInWallMatch = function(gameRoomId, playerId) {
        return gameRooms[gameRoomId].isWall && playerId === 1;
    };


    // valida un giocatore, cioe' setta il nickname di questo a seguito della ricezione di un messaggio
    // di validazione. Viene quindi notificato che un nuovo giocatore è ora ufficialmente entrato
    // a far parte della partita.
    module.exports.handleValidation = function (message) {
        let result = {
            success: false,
            messages: []
        };

        // controllo preliminare messaggio: se lo slot non è occupied, non esiste, è validato, o non si è in mmaking,
        // fai uscire il giocatore dalla game room, notificandolo eventualmente all'avversario
        if (!slotExists(message.gameRoomId, message.playerId) ||
            !gameRooms[message.gameRoomId].players[message.playerId].occupiedSlot ||
            gameRooms[message.gameRoomId].players[message.playerId].gameData.validated ||
            gameRooms[message.gameRoomId].gameData.state !== utils.states.mmaking)  {
            result = module.exports.handlePlayerQuit(message);
            result.success = false;
            return result;
        }

        gameRooms[message.gameRoomId].players[message.playerId].gameData.validated = true;
        gameRooms[message.gameRoomId].players[message.playerId].gameData.nickname = message.nickname;

        result.success = true;
        result.messages.push({
            msgType: broker.messageTypes.s_playerAdded,
            gameType: utils.gameTypes.royale,
            gameRoomId: message.gameRoomId,
            addedPlayerId: message.playerId,
            addedPlayer: utils.getPlayerData(gameRooms,message.gameRoomId, message.playerId),
            aggregated: utils.getAggregatedData(gameRooms,message.gameRoomId),
        });

        return result;
    };


    // allo scadere del timer di startMatch, il match in Battle Royale, settato con start in data specifica
    // deve partire automaticamente, senza la necessita' di segnali di ready da parte dei client
    module.exports.directStartMatch = function (gameRoomId) {
        let result = {
            success: false,
            messages: []
        };

        // controllo preliminare: cancella la game room, nel caso in cui non esista
        if (!gameRoomExists(gameRoomId)) {
            clearGameRoom(gameRoomId);
            result.messages.push({
                msgType: broker.messageTypes.s_gameQuit,
                gameRoomId: gameRoomId,
                gameType: utils.gameTypes.royale
            });
            return result;
        }

        // invia segnale di startMatch, e configura la struttura, solo nel caso in cui ci
        // siano almeno due giocatori validi
        if (utils.countValidPlayers(gameRooms, gameRoomId) > 1) {
            result.success = true;

            // configura i giocatori validi, rimuovi quelli non validati
            for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
                if (gameRooms[gameRoomId].players[i].gameData.validated) {
                    gameRooms[gameRoomId].players[i].gameData.match = generateEmptyPlayerMatch();

                } else {
                    // giocatore non validato; non può accedere alla partita, rimuovilo
                    let quitResult = module.exports.handlePlayerQuit({
                        gameRoomId: gameRoomId,
                        playerId: i
                    });
                    for (let i = 0; i < quitResult.messages.length; i++) {
                        result.messages.push(quitResult.messages[i]);
                    }
                }
            }

            gameRooms[gameRoomId].gameData.state = utils.states.playing;
            gameRooms[gameRoomId].gameData.tiles = utils.generateTiles();
            result.messages.push({
                msgType: broker.messageTypes.s_startMatch,
                gameRoomId: gameRoomId,
                gameType: utils.gameTypes.royale,
                tiles: gameRooms[gameRoomId].gameData.tiles,
                aggregated: utils.getAggregatedData(gameRooms,gameRoomId)
            });

            if (gameRooms[gameRoomId].gameData.matchCount === 0)
                callbacks.createDbGameSession(gameRooms[gameRoomId]);

        } else {
            // non ci sono abbastanza giocatori validati. Esci
            clearGameRoom(gameRoomId);
            result.messages.push({
                msgType: broker.messageTypes.s_gameQuit,
                gameRoomId: gameRoomId,
                gameType: utils.gameTypes.royale,
            });
        }
        return result;
    };


    // all'arrivo di un messaggio playerQuit da un client, o della scadenza di un heartbeat,
    // viene rimosso il giocatore dalla gameRoom e notificato l'abbandono agli altri client in ascolto
    module.exports.handlePlayerQuit = function (message) {
        let result = {
            success: true,
            messages: []
        };
        // success === true: fai uscire il giocatore

        let wasPlayerOrganizer = gameRooms[message.gameRoomId].players[message.playerId].gameData.organizer === true;

        // pulisci in maniera 'safe' lo slot giocatore, fermando i vari timer attivi
        if (slotExists(message.gameRoomId, message.playerId)) {
            clearTimeout(gameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer);
            gameRooms[message.gameRoomId].players[message.playerId] = generateFreeSlot();
        }

        // libera la game room, se necessario, dopo la rimozione dell'utente. Alternative per la rimozione:
        // 1. la game room non esiste
        // 2. c'è rimasto un solo giocatore, durante il gioco;
        // 3. è uscito l'organizzatore di una partita instant durante mmaking
        // 4. si è scollegato il wall, durante una partita wall
        if ((!gameRoomExists(message.gameRoomId)) ||
            (gameRooms[message.gameRoomId].gameData.state !== utils.states.mmaking
                && utils.countValidPlayers(gameRooms, message.gameRoomId) <= 1) ||
            (wasPlayerOrganizer
                && !gameRooms[message.gameRoomId].gameData.scheduledStart
                &&  gameRooms[message.gameRoomId].gameData.state === utils.states.mmaking) ||
            (message.playerId === 0
                && gameRooms[message.gameRoomId].isWall)) {

            clearGameRoom(message.gameRoomId);
            result.messages.push({
                msgType: broker.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: utils.gameTypes.royale,
            });

            callbacks.onGameRoomsUpdated();
            return result;
        }

        // arrivati a questo punto, il giocatore è stato rimosso dalla struttura dati, e la game room è ancora attiva;
        // controlla se l'assenza del giocatore fa scattare altri eventi e messaggi, quindi invia i messaggi
        result.messages.push({
            msgType: broker.messageTypes.s_playerRemoved,
            gameRoomId: message.gameRoomId,
            removedPlayerId: message.playerId,
            removedPlayer: utils.getPlayerData(gameRooms,message.gameRoomId, message.playerId),
            gameType: utils.gameTypes.royale,
            aggregated: utils.getAggregatedData(gameRooms,message.gameRoomId)
        });

        if (startMatchCheck(message.gameRoomId)) {
            // se un giocatore abbandona in aftermatch, la sua assenza potrebbe avviare il match
            for (let i = 0; i < gameRooms[message.gameRoomId].players.length; i++) {
                gameRooms[message.gameRoomId].players[i].gameData.match = generateEmptyPlayerMatch();
                gameRooms[message.gameRoomId].players[i].gameData.ready = false;
            }
            gameRooms[message.gameRoomId].gameData.state = utils.states.playing;
            gameRooms[message.gameRoomId].gameData.tiles = utils.generateTiles();
            result.messages.push({
                    msgType: broker.messageTypes.s_startMatch,
                    gameRoomId: message.gameRoomId,
                    gameType: utils.gameTypes.royale,
                    tiles: gameRooms[message.gameRoomId].gameData.tiles,
                    aggregated: utils.getAggregatedData(gameRooms,message.gameRoomId)
                });

        } else if (startAnimationCheck(message.gameRoomId) && !gameRooms[message.gameRoomId].gameData.animationStarted) {
            // se un giocatore abbandona durante il match, la sua assenza potrebbe far partire l'animazione
            gameRooms[message.gameRoomId].gameData.animationStarted = true;

            if (!utils.isDraw(gameRooms, message.gameRoomId)) {
                let winnerId = utils.getMatchRanking(gameRooms, message.gameRoomId)[0].playerId;

                // il vincitore riceve dei punti bonus calcolati sul tempo di esecuzione
                gameRooms[message.gameRoomId].players[winnerId].gameData.match.points
                    += utils.calculateWinnerBonusPoints(
                    gameRooms[message.gameRoomId].players[winnerId].gameData.match.time,
                    gameRooms[message.gameRoomId].gameData.timerSetting
                );
                gameRooms[message.gameRoomId].players[winnerId].gameData.match.winner = true;
                gameRooms[message.gameRoomId].players[winnerId].gameData.wonMatches++;
            }

            for (let i = 0; i < gameRooms[message.gameRoomId].players.length; i++) {
                gameRooms[message.gameRoomId].players[i].gameData.points
                    += gameRooms[message.gameRoomId].players[i].gameData.match.points;
            }

            for (let i = 0; i < gameRooms[message.gameRoomId].players.length; i++) {
                gameRooms[message.gameRoomId].players[i].gameData.points
                    += gameRooms[message.gameRoomId].players[i].gameData.match.points;
            }

            result.messages.push({
                msgType: broker.messageTypes.s_startAnimation,
                gameRoomId: message.gameRoomId,
                gameType: utils.gameTypes.royale,
                startPositions: utils.getStartPositions(gameRooms, message.gameRoomId),
                aggregated: utils.getAggregatedData(gameRooms,message.gameRoomId)
            });

        } else if (endMatchCheck(message.gameRoomId)) {
            // se un giocatore abbandona durante l'animazione, la sua assenza potrebbe portare all'aftermatch
            gameRooms[message.gameRoomId].gameData.animationStarted = true;
            gameRooms[message.gameRoomId].gameData.state = utils.states.aftermatch;
            gameRooms[message.gameRoomId].gameData.matchCount++;

            result.messages.push({
                msgType: broker.messageTypes.s_endMatch,
                gameRoomId: message.gameRoomId,
                gameType: utils.gameTypes.royale,
                winnerId: utils.getWinnerId(gameRooms, message.gameRoomId),
                aggregated: utils.getAggregatedData(gameRooms,message.gameRoomId),
            });
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

        // controllo preliminare messaggio: se lo slot non è occupied, o non esiste,
        // fai uscire il giocatore dalla game room, notificandolo eventualmente all'avversario
        if (!slotExists(message.gameRoomId, message.playerId) ||
            !gameRooms[message.gameRoomId].players[message.playerId].occupiedSlot)  {
            result = module.exports.handlePlayerQuit(message);
            result.success = false;
            return result;
        }

        // heartbeat valido; resetta timer
        result.success = true;
        clearTimeout(gameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer);
        gameRooms[message.gameRoomId].players[message.playerId].heartBeatTimer
            = generateHeartbeatTimer(message.gameRoomId, message.playerId);

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

        // controllo preliminare messaggio: se lo slot non è occupied, non esiste, non è validato,
        // si è in playing, fai uscire il giocatore dalla game room, notificandolo eventualmente all'avversario
        if (!slotExists(message.gameRoomId, message.playerId) ||
            !gameRooms[message.gameRoomId].players[message.playerId].occupiedSlot ||
            !gameRooms[message.gameRoomId].players[message.playerId].gameData.validated ||
            gameRooms[message.gameRoomId].gameData.state === utils.states.playing)  {
            result = module.exports.handlePlayerQuit(message);
            result.success = false;
            return result;
        }

        gameRooms[message.gameRoomId].players[message.playerId].gameData.ready = true;

        // controlla se, in caso di mmaking, l'organizzatore ha dato ready, o se in aftermatch tutti i
        // giocatori hanno dato ready
        result.success = startMatchCheck(message.gameRoomId);

        if (result.success && utils.countValidPlayers(gameRooms, message.gameRoomId) > 1) {
            // vanno quindi rimossi i giocatori che non hanno completato la validazione, configurati quelli validi,
            // quindi avviata la partita
            for (let i = 0; i < gameRooms[message.gameRoomId].players.length; i++) {
                if (gameRooms[message.gameRoomId].players[i].gameData.validated) {
                    gameRooms[message.gameRoomId].players[i].gameData.ready = false;
                    gameRooms[message.gameRoomId].players[i].gameData.match = generateEmptyPlayerMatch();

                } else if (gameRooms[message.gameRoomId].players[i].occupiedSlot) {
                    // giocatore che ha occupato lo slot, ma non è validato; non può accedere alla partita
                    let quitResult = module.exports.handlePlayerQuit({
                        gameRoomId: message.gameRoomId,
                        playerId: i
                    });
                    for (let i = 0; i < quitResult.messages.length; i++) {
                        result.messages.push(quitResult.messages[i]);
                    }
                }
            }
            gameRooms[message.gameRoomId].gameData.state = utils.states.playing;
            gameRooms[message.gameRoomId].gameData.tiles = utils.generateTiles();
            result.messages.push({
                msgType: broker.messageTypes.s_startMatch,
                gameRoomId: message.gameRoomId,
                gameType: utils.gameTypes.royale,
                tiles: gameRooms[message.gameRoomId].gameData.tiles,
                aggregated: utils.getAggregatedData(gameRooms,message.gameRoomId)
            });

            if (gameRooms[message.gameRoomId].gameData.matchCount === 0)
                callbacks.createDbGameSession(gameRooms[message.gameRoomId]);

        } else if (result.success && utils.countValidPlayers(gameRooms, message.gameRoomId) <= 1) {
            // non ci sono abbastanza giocatori, ma è ora di iniziare il match: esci
            clearGameRoom(message.gameRoomId);
            result.messages.push({
                msgType: broker.messageTypes.s_gameQuit,
                gameRoomId: message.gameRoomId,
                gameType: utils.gameTypes.royale
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

        // controllo preliminare messaggio: se lo slot non è occupied, non esiste, non è validato,
        // si è in playing, fai uscire il giocatore dalla game room, notificandolo eventualmente all'avversario
        if (!slotExists(message.gameRoomId, message.playerId) ||
            !gameRooms[message.gameRoomId].players[message.playerId].occupiedSlot ||
            !gameRooms[message.gameRoomId].players[message.playerId].gameData.validated ||
            gameRooms[message.gameRoomId].gameData.state !== utils.states.playing)  {
            result = module.exports.handlePlayerQuit(message);
            result.success = false;
            return result;
        }

        gameRooms[message.gameRoomId].players[message.playerId].gameData.match.positioned = true;
        gameRooms[message.gameRoomId].players[message.playerId].gameData.match.time = message.matchTime;
        gameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.side = message.side;
        gameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition.distance = message.distance;

        let playerResult = utils.calculatePlayerResult(
            gameRooms[message.gameRoomId].players[message.playerId].gameData.match.startPosition,
            gameRooms[message.gameRoomId].players[message.playerId].gameData.match.time,
            gameRooms[message.gameRoomId].gameData.tiles
        );

        gameRooms[message.gameRoomId].players[message.playerId].gameData.match.points = playerResult.points;
        gameRooms[message.gameRoomId].players[message.playerId].gameData.match.pathLength = playerResult.pathLength;

        result.success = startAnimationCheck(message.gameRoomId);

        if (result.success) {
            gameRooms[message.gameRoomId].gameData.animationStarted = true;

            if (!utils.isDraw(gameRooms, message.gameRoomId)) {
                let winnerId = utils.getMatchRanking(gameRooms, message.gameRoomId)[0].playerId;

                // il vincitore riceve dei punti bonus calcolati sul tempo di esecuzione
                gameRooms[message.gameRoomId].players[winnerId].gameData.match.points
                    += utils.calculateWinnerBonusPoints(
                        gameRooms[message.gameRoomId].players[winnerId].gameData.match.time,
                        gameRooms[message.gameRoomId].gameData.timerSetting
                );
                gameRooms[message.gameRoomId].players[winnerId].gameData.match.winner = true;
                gameRooms[message.gameRoomId].players[winnerId].gameData.wonMatches++;
            }

            for (let i = 0; i < gameRooms[message.gameRoomId].players.length; i++) {
                gameRooms[message.gameRoomId].players[i].gameData.points
                    += gameRooms[message.gameRoomId].players[i].gameData.match.points;
            }

            result.messages.push({
                msgType: broker.messageTypes.s_startAnimation,
                gameRoomId: message.gameRoomId,
                gameType: utils.gameTypes.royale,
                startPositions: utils.getStartPositions(gameRooms, message.gameRoomId),
                aggregated: utils.getAggregatedData(gameRooms,message.gameRoomId)
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

        // controllo preliminare messaggio: se lo slot non è occupied, non esiste, non è validato,
        // non si è in playing, fai uscire il giocatore dalla game room, notificandolo eventualmente all'avversario
        if (!slotExists(message.gameRoomId, message.playerId) ||
            !gameRooms[message.gameRoomId].players[message.playerId].occupiedSlot ||
            !gameRooms[message.gameRoomId].players[message.playerId].gameData.validated ||
            gameRooms[message.gameRoomId].gameData.state !== utils.states.playing)  {
            result = module.exports.handlePlayerQuit(message);
            result.success = false;
            return result;
        }

        gameRooms[message.gameRoomId].players[message.playerId].gameData.match.animationEnded = true;
        result.success = endMatchCheck(message.gameRoomId);

        if (result.success) {
            gameRooms[message.gameRoomId].gameData.state = utils.states.aftermatch;
            gameRooms[message.gameRoomId].gameData.matchCount++;

            result.messages.push({
                msgType: broker.messageTypes.s_endMatch,
                gameRoomId: message.gameRoomId,
                gameType: utils.gameTypes.royale,
                matchRanking: utils.getMatchRanking(gameRooms, message.gameRoomId),
                globalRanking: utils.getGlobalRanking(gameRooms, message.gameRoomId),
                winnerId: utils.getWinnerId(gameRooms, message.gameRoomId),
                aggregated: utils.getAggregatedData(gameRooms,message.gameRoomId)
            });

            callbacks.createDbGameMatch(gameRooms[message.gameRoomId]);
        }

        return result;
    };


    /* -------------------------------------------------------------------------------------------- *
     * UTILITIES: metodi interni di appoggio, utilizzato nei vari Handle Methods.
     * -------------------------------------------------------------------------------------------- */

    let addOrganizerPlayer = function (isWall) {
        let result = {
            success: false,
            gameRoomId: undefined,
            playerId: undefined,
            messages: []
        };

        // cerca il primo slot libero tra le gameRoom
        for (let i = 0; i < gameRooms.length; i++) {
            if (gameRooms[i].gameData.state === utils.states.free && !result.success) {
                result.gameRoomId = i;
                result.playerId = 0;
                result.success = true;
                gameRooms[i] = generateGameRoom(i, utils.states.mmaking, isWall);
            }
        }

        // non c'è uno slot libero: crea una nuova game room
        if (!result.success) {
            result.gameRoomId = gameRooms.length;
            result.playerId = 0;
            result.success = true;
            gameRooms.push(
                generateGameRoom(result.gameRoomId, utils.states.mmaking, isWall)
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

        for (let i = 0; i < gameRooms.length; i++) {
            if (gameRooms[i].gameData.code.toString() === invitationCode.toString()
                && gameRooms[i].gameData.state === utils.states.mmaking
                && countOccupiedSlots(i) < gameRooms[i].gameData.maxPlayersSetting
                && !result.success) {

                for (let j = 0; j < gameRooms[i].players.length; j++) {
                    // game room trovata: se ci sono slot liberi, occupane uno
                    if (!gameRooms[i].players[j].occupiedSlot) {
                        result.success = true;
                        result.gameRoomId = i;
                        result.playerId = j;
                    }
                }

                // la game room non ha player slot liberi: creane uno nuovo
                if (!result.success) {
                    result.success = true;
                    result.gameRoomId = i;
                    result.playerId = gameRooms[i].players.length;
                    gameRooms[result.gameRoomId].players.push(generateFreeSlot());
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
            for (let j = 0; j < gameRooms[gameRoomId].players.length; j++) {
                if (gameRooms[gameRoomId].players[j].heartBeatTimer !== undefined)
                    clearTimeout(gameRooms[gameRoomId].players[j].heartBeatTimer);
            }

            gameRooms[gameRoomId] = generateGameRoom(gameRoomId, utils.states.free);
        }

        // rimuovi se presenti le gameRoom vuote consecutive in fondo all'array
        for (let i = gameRooms.length - 1; i >= 0; i--) {
            if (gameRooms[i].gameData.state === utils.states.free)
                gameRooms.splice(i, 1);
            else
                break;
        }
    };


    let countOccupiedSlots = function (gameRoomId) {
        let occupiedSlot = 0;
        if(gameRooms[gameRoomId] !== undefined) {
            for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
                if (gameRooms[gameRoomId].players[i].occupiedSlot)
                    occupiedSlot++;
            }
        }
        return occupiedSlot;
    };


    let slotExists = function (gameRoomId, playerId) {
        return gameRooms[gameRoomId] !== undefined
            && gameRooms[gameRoomId].players[playerId] !== undefined;
    };


    let gameRoomExists = function (gameRoomId) {
        return gameRooms[gameRoomId] !== undefined;
    };

    let generateGameRoom = function (gameRoomId, state, isWall) {
        return {
            players: [generateFreeSlot()],
            sessionId: undefined,
            isWall: !!isWall,
            gameData: generateGeneralGameData(gameRoomId, state)
        };
    };


    let generateFreeSlot = function () {
        return {
            occupiedSlot: false,
            startDate: undefined,
            heartBeatTimer: undefined,
            gameData: generatePlayerGameData()
        };
    };


    let generateOccupiedSlot = function (gameRoomId, playerId, userId, startDate) {
        return {
            occupiedSlot: true,
            userId: userId,
            startDate: startDate,
            heartBeatTimer: generateHeartbeatTimer(gameRoomId, playerId),
            gameData: generatePlayerGameData(gameRoomId, playerId)
        };
    };


    let generateHeartbeatTimer = function (gameRoomId, playerId) {
        return setTimeout(function () {
            callbacks.onHeartbeatExpired(gameRoomId, playerId, utils.gameTypes.royale)
        }, 15000);
    };


    let organizerReady = function (gameRoomId) {
        if (!gameRoomExists(gameRoomId)) {
            return false;
        }

        for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
            if (gameRooms[gameRoomId].players[i].gameData.organizer
                && gameRooms[gameRoomId].players[i].gameData.ready)
                return true;
        }

        return false;
    };


    let allPlayersReady = function(gameRoomId) {
        let allReady = true;
        for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
            if (gameRooms[gameRoomId].players[i].occupiedSlot &&
                !gameRooms[gameRoomId].players[i].gameData.ready) {
                allReady = false;
                break;
            }
        }

        return allReady;
    }


    // controllo per stabilire se il match vada avviato, senza considerare il numero di giocatori
    let startMatchCheck = function (gameRoomId) {
        if (!gameRoomExists(gameRoomId)) {
            return;
        }

        if (gameRooms[gameRoomId].gameData.state === utils.states.mmaking &&
            !gameRooms[gameRoomId].gameData.scheduledStart) {
            // primo match: le partite INSTANT devono avere l'organizzatore ready
            return organizerReady(gameRoomId);

        } else if (gameRooms[gameRoomId].gameData.state === utils.states.mmaking &&
            gameRooms[gameRoomId].gameData.scheduledStart) {
            // primo match: le partite SCHEDULED non vanno mai avviate in seguito a questo check
            return false;

        } else if (gameRooms[gameRoomId].gameData.state === utils.states.aftermatch) {
            // match seguenti: tutti i giocatori devono essere ready
            return allPlayersReady(gameRoomId);
        }
    };


    let startAnimationCheck = function (gameRoomId) {
        if (!gameRoomExists(gameRoomId)
            || gameRooms[gameRoomId].gameData.state !== utils.states.playing) {
            return;
        }

        let allPositioned = true;
        for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
            if (gameRooms[gameRoomId].players[i].occupiedSlot &&
                !gameRooms[gameRoomId].players[i].gameData.match.positioned) {
                allPositioned = false;
                break;
            }
        }

        return allPositioned;
    };


    let endMatchCheck = function (gameRoomId) {
        if (!gameRoomExists(gameRoomId)
            || gameRooms[gameRoomId].gameData.state !== utils.states.playing) {
            return;
        }

        let allAnimationFinished = true;
        for (let i = 0; i < gameRooms[gameRoomId].players.length; i++) {
            if (gameRooms[gameRoomId].players[i].occupiedSlot &&
                !gameRooms[gameRoomId].players[i].gameData.match.animationEnded) {
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
            animationStarted: false,
            scheduledStart: false,
            maxPlayersSetting: 20,
            state: (state !== undefined) ? state : utils.states.free,
            gameType: utils.gameTypes.royale,
            code: utils.generateUniqueCode(gameRooms)
        }
    };
}());