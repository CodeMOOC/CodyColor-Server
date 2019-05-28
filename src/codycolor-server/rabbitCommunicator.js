/*
 * rabbitCommunicator.js: file utilizzato per gestire la comunicazione con il broker, tramite il modulo stompJs.
 * Espone dei metodi che rappresentano le operazioni base di interazione server-broker dell'applicazione.
 */
(function () {

    let stomp     = require('stompjs');
    let utilities = require("./utilities");

    // topic endpoints
    const serverControlQueue  = '/queue/serverControl';
    const clientsControlTopic = '/topic/clientsControl';
    const randGameRoomsTopic  = '/topic/gameRooms';
    const custGameRoomsTopic  = '/topic/custGameRooms';
    const generalTopic        = "/topic/general";

    // credenziali connessione al broker. Il parametro -l esegue lo script in locale;
    // in qualunque altro caso, viene eseguito in modalità standard su docker
    let stompUrl;
    if (process.argv[2] === '-l') {
        stompUrl = 'ws://127.0.0.1:15674/ws';
    } else {
        const HOST = process.env.HOST || 'rabbit';
        const PORT = process.env.PORT || 15674;
        stompUrl = `ws://${HOST}:${PORT}/ws`;
    }
    const username    = 'guest';
    const password    = 'guest';
    const vHost       = '/';
    let client;
    let connected = false;

    // costante di controllo
    const gameTypes = utilities.gameTypes;

    // memorizza le funzioni invocate all'arrivo di nuovi messaggi
    let callbacks = {};

    // tenta la connessione al broker; in caso di connessione completata, sottoscrive la queue server. Inizializza
    // inoltre i callbacks
    module.exports.connect = function (callbacksArg) {
        if (callbacksArg !== undefined)
            callbacks = callbacksArg;

        utilities.printLog(false, `Initializing StompJs API at ${stompUrl}...`);
        client = stomp.overWS(stompUrl);
        client.connect(username, password, onConnect, onError, vHost);

        // thread di controllo e retry
        setInterval(function () {
            if (!connected) {
                utilities.printLog(true, "Connection to the broker not available. Retrying...");
                utilities.printLog(false, `Initializing StompJs API at ${stompUrl}...`);
                client = stomp.overWS(stompUrl);
                client.connect(username, password, onConnect, onError, vHost);
            }
        }, 10000);
    };

    // invia un messaggio alla queue di controllo diretta del client
    module.exports.sendToClientControlQueue = function(correlationId, message) {
        client.send(clientsControlTopic + '.' + correlationId, {}, JSON.stringify(message));
        utilities.printLog(false, `Sent ${message.msgType} in client queue`);
    };

    // invia un messaggio nel topic general
    module.exports.sendToGeneralTopic = function(message) {
        client.send(generalTopic, {}, JSON.stringify(message));
        utilities.printLog(false, `Sent ${message.msgType} in general topic`);
    };

    // invia un messaggio in una game room
    module.exports.sendToGameRoomTopic = function(message) {
        let gameRoomsTopic = (message.gameType === gameTypes.custom ? custGameRoomsTopic : randGameRoomsTopic);

        client.send(gameRoomsTopic + '.' + message.gameRoomId, {}, JSON.stringify(message));
        utilities.printLog(false,
            `Sent ${message.msgType} in ${message.gameType} game room ${message.gameRoomId}`);
    };


    // a connessione avvenuta, lo script si pone in ascolto di messaggi in arrivo dai client,
    // nella queue riservata al server. Invoca il callback corrispondente per ogni tipo di messaggio
    let onConnect = function () {
        utilities.printLog(true, 'Connection to the broker ready');
        connected = true;

        client.subscribe(serverControlQueue, function (receivedMessage) {
            let messageBody = JSON.parse(receivedMessage.body);

            if (messageBody.msgType === undefined || messageBody.gameRoomId === -1) {
                // probabilmente, ping-pong dal broker; ignora
                return;
            }

            switch (messageBody.msgType) {
                case 'connectedSignal':
                    safeCall('onConnectedSignal', messageBody);
                    break;

                case 'gameRequest':
                    safeCall('onGameRequest', messageBody);
                    break;

                case 'quitGame':
                    safeCall('onQuitGame', messageBody);
                    break;

                case 'heartbeat':
                    safeCall('onHeartbeat', messageBody);
                    break;

                case 'tilesRequest':
                    safeCall('onTilesRequest', messageBody);
                    break;

                default:
                    safeCall('onInvalidMessage', messageBody);
                    break;
            }
        }, { durable: false, exclusive: false });
        utilities.printLog(true, 'Waiting for messages...');
    };


    // in caso di errore, il programma ritenta la connessione dopo 10 secondi
    let onError = function () {
        utilities.printLog(true, 'Error connecting to the broker.');
        connected = false;
    };


    // invoca un callback in modo 'sicuro', facendo in modo che non vanga invocato nel caso in cui non fosse definito
    let safeCall = function (callbackName, messageBody) {
        if (callbacks[callbackName] !== undefined)
            callbacks[callbackName](messageBody);
    };
}());
