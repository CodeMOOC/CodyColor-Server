/*
 * rabbitCommunicator.js: file utilizzato per gestire la comunicazione con il broker, tramite il modulo stompJs.
 * Espone dei metodi che rappresentano le operazioni base di interazione server-broker dell'applicazione.
 */
(function () {

    let utilities = require("./utilities");
    const messageTypes = utilities.messageTypes;
    const gameTypes = utilities.gameTypes;

    let stomp = require('stompjs');
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

    // Il parametro -l esegue lo script in locale
    const host = process.env.HOST || 'rabbit';
    const port = process.env.PORT || 15674;
    const stompUrl = (process.argv[2] === '-l') ?
        "ws://127.0.0.1:15674/ws" : `ws://${host}:${port}/ws`;


    // tenta la connessione al broker; in caso di connessione completata, sottoscrive
    // la queue server. Inizializza inoltre i callbacks
    module.exports.connect = function (callbacks) {
        if (callbacks !== undefined)
            onMessageCallbacks = callbacks;

        utilities.printLog(false, `Initializing StompJs API at ${stompUrl}...`);
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
                utilities.printLog(true, "Connection to the broker not available. Retrying...");
                utilities.printLog(false, `Initializing StompJs API at ${stompUrl}...`);
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
        client.send(endpoints.clientControlTopic + '.' + correlationId, {}, JSON.stringify(message));
        utilities.printLog(false, `Sent ${message.msgType} in client queue`);
    };


    module.exports.sendInGeneralTopic = function(message) {
        message.msgId = (Math.floor(Math.random() * 100000)).toString();
        client.send(endpoints.generalTopic, {}, JSON.stringify(message));
        utilities.printLog(false, `Sent ${message.msgType} in general topic`);
    };


    module.exports.sendInGameRoomTopic = function(message) {
        client.send(getGameRoomEndpoint(message.gameType, message.gameRoomId), {}, JSON.stringify(message));
        utilities.printLog(false,
            `Sent ${message.msgType} in ${message.gameType} game room ${message.gameRoomId}`);
    };


    let getGameRoomEndpoint = function(gameType, gameRoomId) {
        switch (gameType) {
            case gameTypes.random: {
                return endpoints.randomGameRoomsTopic + '.' + gameRoomId;
            }
            case gameTypes.custom: {
                return endpoints.customGameRoomsTopic + '.' + gameRoomId;
            }
            case gameTypes.royale: {
                return endpoints.royaleGameRoomsTopic + '.' + gameRoomId;
            }
        }
    };


    // a connessione avvenuta, lo script si pone in ascolto di messaggi in arrivo dai client
    let onConnect = function () {
        utilities.printLog(true, 'Connection to the broker ready');
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

        utilities.printLog(true, 'Waiting for messages...');
    };


    let onError = function () {
        utilities.printLog(true, 'Error connecting to the broker.');
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
            console.log("Received duplicate message. Ignored.");
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
