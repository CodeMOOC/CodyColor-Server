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
        client.send(endpoints.clientControlTopic + '.' + correlationId, {}, JSON.stringify(message));
        utilities.printLog(false, `Sent ${message.msgType} in client queue`);
    };


    module.exports.sendInGeneralTopic = function(message) {
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

        switch (message.msgType) {
            case messageTypes.connectedSignal:
                if (onMessageCallbacks.onConnectedSignal !== undefined)
                    onMessageCallbacks.onConnectedSignal(message);
                break;

            case messageTypes.gameRequest:
                if (onMessageCallbacks.onGameRequest !== undefined)
                    onMessageCallbacks.onGameRequest(message);
                break;

            case messageTypes.quitGame:
                if (onMessageCallbacks.onQuitGame !== undefined)
                    onMessageCallbacks.onQuitGame(message);
                break;

            case messageTypes.heartbeat:
                if (onMessageCallbacks.onHeartbeat !== undefined)
                    onMessageCallbacks.onHeartbeat(message);
                break;

            case messageTypes.tilesRequest:
                if (onMessageCallbacks.onTilesRequest !== undefined)
                    onMessageCallbacks.onTilesRequest(message);
                break;

            default:
                if (onMessageCallbacks.onInvalidMessage !== undefined)
                    onMessageCallbacks.onInvalidMessage(message);
                break;
        }
    };
}());
