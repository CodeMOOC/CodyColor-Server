#!/usr/bin/env node

/*
 * serverScript.js: script node.Js che gestisce il server di CodyColor:
 */

const HOST = process.env.HOST || 'rabbit';
const PORT = process.env.PORT || 15674;

console.log(' [x] CodyColor gameServer');
console.log(' [x] Project by Riccardo Maldini');
console.log('');

// variabile dalla quale verranno gestiti gameRooms e client collegati
var gameRooms = [];

// queue utilizzata dai client per comunicare con il broker
var serverControlQueue = "/queue/serverControl";

// topic utilizzato dallo script per comunicare con i client
var clientsControlTopic = '/topic/clientsControl';

// topic utilizzato dai client e dal server per comunicare con i
// client collegati alla gameRoom
var gameRoomsTopic = '/topic/gameRooms';

// istanza per il collegamento al broker tramite protocollo STOMP w. WebSocket
// utilizza la libreria esterna npm 'stompjs'
const stompUrl = 'ws://' + HOST + ':' + PORT + '/ws';
console.log(" [.] Initializing StompJs API at " + stompUrl + "...");
var Stomp = require('stompjs');
client = Stomp.overWS(stompUrl);

// avvia la connessione con il sever, con le credenziali corrette
console.log(" [.] Trying to connect to the broker...");
client.connect('guest', 'guest',         // username e password
               onConnect, onError, '/'); // callbacks e vHost

// cosa fare n caso di errore nella connessione o nel processare dei messaggi
function onError() {
    console.log(" [x] Error connecting to the broker or processing messages");
}

// cosa fare a connessione avvenuta
function onConnect() {
    console.log(" [x] Connection to the broker ready");

    // si pone in ascolto di messaggi dai client nella queue server
    client.subscribe(serverControlQueue, function(receivedMessage) {
        var recMsgBody = JSON.parse(receivedMessage.body);
        switch(recMsgBody.msgType) {
            // richiesta di connessione. Aggiunge un nuovo player nell'array gameRooms
            // e comunica al client playerId e gameRoom assegnatigli
            case "gameRequest":
                console.log(" [.] Received game request from new client");
                var playerData = addUserToGameRoom();
                console.log(" [.] Client added to gameRoom array. User params: [%d][%d]",
                    playerData.gameRoomId, playerData.playerId);

                console.log(" [.] New game room configuration:");
                printGameRooms();

                var response = { msgType:  "gameResponse",
                    gameRoomId: playerData.gameRoomId,
                    playerId:   playerData.playerId
                };

                client.send(clientsControlTopic + '.' + recMsgBody.correlationId,
                    {}, JSON.stringify(response));
                console.log(" [.] Sent matchRequest response to the client");
                console.log(" [x] Waiting for messages...");
                break;

            // richiesta diretta di disconnessione. Si rimuove il client dall'array gameRooms e 
            // si notifica a tutti i client in ascolto sul topic della gameRoom della disconnessione
            // del client
            case "disconnect":
                console.log(" [.] Received disconnection request from client [%d][%d]",
                    recMsgBody.gameRoomId, recMsgBody.playerId);
                disconnectUser(recMsgBody.gameRoomId, recMsgBody.playerId);
                break;

            // ricevuto un heartBeat dal client. Se il server non riceve heartBeat dal client per più
            // di 10 secondi, disconnette quest'ultimo, in quanto si ipotizza che abbia chiuso la finestra del browser
            case "heartbeat":
                console.log(" [.] Received heartbeat from client [%d][%d]", recMsgBody.gameRoomId, recMsgBody.playerId);
                updateHeartBeat(recMsgBody.gameRoomId, recMsgBody.playerId);
                console.log(" [x] Waiting for messages...");
                break;

            // un client ha richiesto una nuova disposizione di tiles per la propria gameRoom
            case "tilesRequest":
                console.log(" [.] Received tiles request from gameRoom [%d]", recMsgBody.gameRoomId);

                // genera tiles casuali, rappresentandole tramite una stringa, in cui carattere
                // rappresenta una casella
                var tilesValue = "";
                for (var i = 0; i < 25; i++) {
                    switch (Math.floor(Math.random() * 3)) {
                        case 0:
                            tilesValue += "R";
                            break;

                        case 1:
                            tilesValue += "Y";
                            break;
                        case 2:
                            tilesValue += "G";
                            break;
                    }
                }

                var response = { msgType:   "tilesResponse",
                    gameRoomId: recMsgBody.gameRoomId,
                    playerId:  "server",
                    tiles:      tilesValue
                };

                // invia una notifica alla gameRoom
                client.send(gameRoomsTopic + '.' + recMsgBody.gameRoomId,
                    {}, JSON.stringify(response));


                console.log(" [.] Sent tiles response to gameRoom [%d]: '%s'", recMsgBody.gameRoomId, tilesValue);
                console.log(" [x] Waiting for messages...");
                break;

            // messaggio senza tipologia: utilizzato per i test
            default:
                console.log(" [.] Received unknown message: " + msg.body.toString());
                console.log(" [x] Waiting for messages...");
                break;
        }

    }, {durable: false, exclusive: false});

    console.log(" [x] Waiting for messages...");
}


// rimuove un utente dall'array gameRoom e invia una notifica di 
// disconnessione alla gameRoom
function disconnectUser(gameRoomId, playerId) {

    removeUserFromGameRoom(gameRoomId, playerId);

    console.log(" [.] User removed from gameRooms array");

    var response = {
        msgType:    "disconnect",
        'gameRoomId': gameRoomId,
        'playerId':   playerId
    };

    // invia una notifica alla gameRoom, rendendo partecipi i giocatori
    // che un giocatore è stato disconnesso
    client.send(gameRoomsTopic + '.' + gameRoomId + '.' + playerId,
        {}, JSON.stringify(response));

    console.log(" [.] Sent disconnection notification to gameRoom for user [%d][%d]", gameRoomId, playerId);
    console.log(' [.] New gameRoom configuration:');
    printGameRooms();
    console.log(" [x] Waiting for messages...");
}


// stampa a console le gameRoom attive
function printGameRooms() {
    if (gameRooms.length <= 0) {
        console.log(" [.] empty");
    } else {
        for(var i = 0; i < gameRooms.length; i++) {
            console.log(" [.] %d [%d][%d]",i, gameRooms[i][0].occupiedSlot,
                gameRooms[i][1].occupiedSlot);
        }
    }
}


/*
 * Funzioni per la manipolazione dell'array gameRooms
 */

// aggiunge un riferimento all'utente nel primo slot libero d gameRooms
// ritorna un oggetto contenente gameRoom e playerId assegnati al richiedente
function addUserToGameRoom() {
    var gameRoomsCount = gameRooms.length;

    if (gameRoomsCount > 0) {

        // cerca il primo slot libero tra le gameRoom
        for (var i = 0; i < gameRooms.length; i++) {
            for (var j = 0; j < gameRooms[i].length; j++) {

                // si è trovato uno slot libero: piazza l'utente lì
                if(!gameRooms[i][j].occupiedSlot) {
                    gameRooms[i][j] = occupySlot(i, j);
                    return { gameRoomId : i, playerId : j };
                }
            }
        }

        // non c'è uno slot libero: crea una nuova gameRoom e piazza l'utente nel primo slot
        gameRooms.push( [occupySlot(gameRoomsCount, 0), createFreeSlot()] );
        return { gameRoomId : gameRoomsCount, playerId : 0 };
    }

    // deve essere creata la prima gameRoom: crea la gameRoom e piazza l'utente nel primo slot
    gameRooms.push( [occupySlot(0, 0), createFreeSlot()] );
    return { gameRoomId : 0, playerId : 0 };
}


// rimuove il riferimento dell'utente passato in ingresso dall'array gameRooms
function removeUserFromGameRoom(gameRoomId, playerId) {
    clearSlot(gameRoomId, playerId);

    // rimuove le gameRoom  vuote, scorrendole da quella con l'indice maggiore a quella con il minore
    for (var i = gameRooms.length - 1; i >= 0; i--) {
        var gameRoomToDelete = true;
        for(var j = 0; j < gameRooms[i].length; j++) {
            if(gameRooms[i][j])
                gameRoomToDelete = false;
        }

        if(gameRoomToDelete)
            gameRooms.splice(i, 1);
    }
}


// crea uno slot libero da porre su una gameRoom
function createFreeSlot() {
    return { occupiedSlot: false, heartBeatTimer: null };
}


// setta uno slot come occupato, aggiornando la variabile di occupazione e settando un
// timer per gestire l'heartbeat
function occupySlot(gameRoomId, playerId) {
    var timer = setTimeout(function()
        {
            console.log(' [.] HeartBeat timer of [%d][%d] expired', gameRoomId, playerId);
            disconnectUser(gameRoomId, playerId);
        },
        10000);

    return {occupiedSlot: true, heartBeatTimer: timer };
}


// pulisce uno slot in precedenza occupato, rimuovendo il timer e togliendo il riferimento
function clearSlot(gameRoomId, playerId) {
    clearTimeout(gameRooms[gameRoomId][playerId].heartBeatTimer);
    gameRooms[gameRoomId][playerId] = createFreeSlot();
}


// pulisce uno slot in precedenza occupato, rimuovendo il timer e togliendo il riferimento
function updateHeartBeat(gameRoomId, playerId) {
    clearTimeout(gameRooms[gameRoomId][playerId].heartBeatTimer);
    gameRooms[gameRoomId][playerId] = occupySlot(gameRoomId, playerId);
}