/*
 * rabbit.js: file utilizzato per gestire la comunicazione con il broker, tramite il modulo stompJs.
 * Espone dei metodi che rappresentano le operazioni base di interazione server-broker dell'applicazione.
 */
(function () {

    let utils = require('./utils');
    let gameRoomsUtils = require('./gameRoomsUtils');
    let stomp = require('stompjs');
    let LZUTF8 = require('lzutf8');

    let client;
    let connected = false;
    let onMessageCallbacks = {};
    let lastMsgId;

    const endpoints = {
        serverControlQueue:   "/queue/serverControl",
        clientControlTopic:   "/topic/clientsControl",
        generalTopic:         "/topic/general",
        randomGameRoomsTopic: "/topic/gameRooms",
        customGameRoomsTopic: "/topic/custGameRooms",
        royaleGameRoomsTopic: "/topic/agaGameRooms"
    };

    const credentials = {
        username:   "guest",
        password:   "guest",
        vHost:      "/",
    };

    const host = process.env.HOST || 'rabbit';
    const port = process.env.PORT || 15674;
    const stompUrl =  `ws://${host}:${port}/ws`;

    const messageTypes = {
        c_connectedSignal: "c_connectedSignal",
        s_generalInfo:     "s_generalInfo",

        c_gameRequest:  "c_gameRequest",    // client richiede di giocare
        s_gameResponse: "s_gameResponse",   // server fornisce credenziali di gioco

        c_playerQuit:    "c_playerQuit",     // richiesta di fine gioco di un client
        s_gameQuit:      "s_gameQuit",       // forza il fine gioco per tutti
        s_playerAdded:   "s_playerAdded",    // notifica un giocatore si collega
        s_playerRemoved: "s_playerRemoved",  // notifica un giocatore si scollega
        c_validation:     "c_validation",    // rende l'iscrizione del giocatore 'valida' fornendo credenz. come il nick
        c_ready:          "c_ready",         // segnale pronto a giocare; viene intercettato anche dai client

        s_startMatch:     "s_startMatch",     // segnale avvia partita
        c_positioned:     "c_positioned",     // segnale giocatore posizionato
        s_startAnimation: "s_startAnimation", // inviato quando tutti sono posizionati
        c_endAnimation:   "c_endAnimation",   // notifica la fine dell'animazione, o lo skip
        s_endMatch:       "s_endMatch",       // segnale aftermatch

        c_heartbeat: "c_heartbeat",           // segnale heartbeat
        c_chat:      "c_chat",                // chat, intercettati SOLO dai client

        c_signUpRequest: "c_signUpRequest",  // aggiunge l'utente al db con nickname
        c_logInRequest:  "c_logInRequest",  // richiedi nickname utente con uid
        s_authResponse:  "s_authResponse",  // fornisci il nickname utente - o messaggio error

        c_userDeleteRequest:  "c_userDeleteRequest",   // richiedi l'eliminazione di un utente
        s_userDeleteResponse: "s_userDeleteResponse",  // conferma l'eliminazione di un utente

        c_rankingsRequest:  "c_rankingsRequest",  // richiedi le classifiche
        s_rankingsResponse: "s_rankingsResponse", // restituisci le classifiche
    };


    // rende disponibili i messageTypes all'esterno del modulo
    module.exports.messageTypes = messageTypes;


    // tenta la connessione al broker; in caso di connessione completata, sottoscrive
    // la queue server. Inizializza inoltre i callbacks
    module.exports.connect = function (callbacks) {
        if (callbacks !== undefined)
            onMessageCallbacks = callbacks;

        utils.printLog(`Initializing StompJs API at ${stompUrl}...`);
        client = stomp.overWS(stompUrl);
        client.connect(
            credentials.username,
            credentials.password,
            onConnect,
            onError,
            credentials.vHost
        );

        // thread di controllo per eventuale connection retry
        setInterval(function () {
            if (!connected) {
                utils.printLog("Connection to the broker not available. Retrying...");
                utils.printLog(`Initializing StompJs API at ${stompUrl}...`);
                client = stomp.overWS(stompUrl);
                client.connect(
                    credentials.username,
                    credentials.password,
                    onConnect,
                    onError,
                    credentials.vHost
                );
            }
        }, 10000);
    };


    // invia un messaggio alla queue di controllo diretta del client
    module.exports.sendInClientControlQueue = function(correlationId, message) {
        // aggiunge un id univoco al messaggio
        message.msgId = (Math.floor(Math.random() * 100000)).toString();

        // compressione gameData
        if (message.gameData !== undefined) {
            message.gameData = LZUTF8.compress(JSON.stringify(message.gameData),
                {outputEncoding: 'StorageBinaryString'});
        }

        client.send(endpoints.clientControlTopic + '.' + correlationId, {}, JSON.stringify(message));
        utils.printLog(`Sent ${message.msgType} in client queue`);
    };


    // invia un messaggio nel topic generale, topic al quale sono in ascolto tutti i client
    module.exports.sendInGeneralTopic = function(message) {
        message.msgId = (Math.floor(Math.random() * 100000)).toString();

        // compressione gameData
        if (message.gameData !== undefined) {
            message.gameData = LZUTF8.compress(JSON.stringify(message.gameData),
                {outputEncoding: 'StorageBinaryString'});
        }

        client.send(endpoints.generalTopic, {}, JSON.stringify(message));
        utils.printLog(`Sent ${message.msgType} in general topic`);
    };


    // invia messaggio nel topic di una specifica game room
    module.exports.sendInGameRoomTopic = function(message) {

        // compressione gameData
        if (message.gameData !== undefined) {
            message.gameData = LZUTF8.compress(JSON.stringify(message.gameData),
                {outputEncoding: 'StorageBinaryString'});
        }

        client.send(getGameRoomEndpoint(message.gameType, message.gameRoomId), {}, JSON.stringify(message));
        utils.printLog(
            `Sent ${message.msgType} in ${message.gameType} game room ${message.gameRoomId}`);
    };


    let getGameRoomEndpoint = function(gameType, gameRoomId) {
        switch (gameType) {
            case gameRoomsUtils.gameTypes.random: {
                return endpoints.randomGameRoomsTopic + '.' + gameRoomId;
            }
            case gameRoomsUtils.gameTypes.custom: {
                return endpoints.customGameRoomsTopic + '.' + gameRoomId;
            }
            case gameRoomsUtils.gameTypes.royale: {
                return endpoints.royaleGameRoomsTopic + '.' + gameRoomId;
            }
        }
    };


    // a connessione avvenuta, lo script si pone in ascolto di messaggi in arrivo dai client
    let onConnect = function () {
        utils.printLog('Connection to the broker ready');
        connected = true;

        client.subscribe(
            endpoints.serverControlQueue,
            handleIncomingMessages,
            { durable: false, exclusive: false }
        );

        client.subscribe(
            endpoints.randomGameRoomsTopic + '.*',
            handleIncomingMessages
        );

        client.subscribe(
            endpoints.customGameRoomsTopic + '.*',
            handleIncomingMessages
        );

        client.subscribe(
            endpoints.royaleGameRoomsTopic + '.*',
            handleIncomingMessages
        );

        utils.printWaiting();
    };


    let onError = function () {
        utils.printLog('Error connecting to the broker.');
        connected = false;
    };


    let handleIncomingMessages = function (rawMessage) {
        let message = JSON.parse(rawMessage.body);

        if (message.msgType === undefined || message.gameRoomId === -1) {
            // ping-pong dal broker o messaggio mal formato
            return;
        }

        if (lastMsgId === undefined || lastMsgId !== message.msgId) {
            lastMsgId = message.msgId;

        } else if (lastMsgId === message.msgId) {
            utils.printLog("Received duplicate message. Ignored.");
            return;
        }

        switch (message.msgType) {
            case messageTypes.c_connectedSignal:
                if (onMessageCallbacks.onConnectedSignal !== undefined)
                    onMessageCallbacks.onConnectedSignal(message);
                break;

            case messageTypes.c_gameRequest:
                if (onMessageCallbacks.onGameRequest !== undefined)
                    onMessageCallbacks.onGameRequest(message);
                break;

            case messageTypes.c_validation:
                if (onMessageCallbacks.onValidation !== undefined)
                    onMessageCallbacks.onValidation(message);
                break;

            case messageTypes.c_playerQuit:
                if (onMessageCallbacks.onPlayerQuit !== undefined)
                    onMessageCallbacks.onPlayerQuit(message);
                break;

            case messageTypes.c_heartbeat:
                if (onMessageCallbacks.onHeartbeat !== undefined)
                    onMessageCallbacks.onHeartbeat(message);
                break;

            case messageTypes.c_ready:
                if (onMessageCallbacks.onReady !== undefined)
                    onMessageCallbacks.onReady(message);
                break;

            case messageTypes.c_positioned:
                if (onMessageCallbacks.onPositioned !== undefined)
                    onMessageCallbacks.onPositioned(message);
                break;

            case messageTypes.c_endAnimation:
                if (onMessageCallbacks.onEndAnimation !== undefined)
                    onMessageCallbacks.onEndAnimation(message);
                break;

            case messageTypes.c_signUpRequest:
                if (onMessageCallbacks.onSignUpRequest !== undefined)
                    onMessageCallbacks.onSignUpRequest(message);
                break;

            case messageTypes.c_logInRequest:
                if (onMessageCallbacks.onLogInRequest !== undefined)
                    onMessageCallbacks.onLogInRequest(message);
                break;
            case messageTypes.c_userDeleteRequest:
                if (onMessageCallbacks.onUserDeleteRequest !== undefined)
                    onMessageCallbacks.onUserDeleteRequest(message);
                break;
            case messageTypes.c_rankingsRequest:
                if (onMessageCallbacks.onRankingRequest !== undefined)
                    onMessageCallbacks.onRankingRequest(message);
                break;
        }
    };
}());
