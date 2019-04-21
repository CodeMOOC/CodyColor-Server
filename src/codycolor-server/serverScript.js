#!/usr/bin/env node

/*
 * serverScript.js: script node.Js per la gestione lato server di CodyColor. Tiene traccia dei vari giocatori
 * collegati in multiplayer, li sincrinizza e ne memorizza dati persistenti
 */

console.log(' [x] CodyColor gameServer');
console.log(' [x] Project by Riccardo Maldini');
console.log('');

// variabile dalla quale verranno gestiti gameRoom e client collegati
let gameRooms = [];

// queue e topic utilizzati nelle comunicazioni con il broker
const serverControlQueue = "/queue/serverControl";
const clientsControlTopic = '/topic/clientsControl';
const gameRoomsTopic = '/topic/gameRooms';

// istanza per il collegamento al broker tramite protocollo STOMP WebSocket
// utilizza la libreria esterna npm 'stompjs'
const HOST = process.env.HOST || 'rabbit';
const PORT = process.env.PORT || 15674;
const stompUrl = 'ws://' + HOST + ':' + PORT + '/ws';
console.log(" [.] Initializing StompJs API at " + stompUrl + "...");

let Stomp = require('stompjs');
let client = Stomp.overWS(stompUrl);

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
        let recMsgBody = JSON.parse(receivedMessage.body);
        switch(recMsgBody.msgType) {
            case "gameRequest":
                // richiesta di nuova partita. Aggiunge un nuovo player nell'array gameRooms
                // e comunica al client playerId e gameRoom assegnatigli
                console.log(" [.] Received game request from new client");
                let playerData = addUserToGameRoom();
                console.log(" [.] Client added to gameRoom array. User params: [%d][%d]",
                    playerData.gameRoomId, playerData.playerId);

                console.log(" [.] New game room configuration:");
                printGameRooms();

                let gameResponse = { msgType:  "gameResponse",
                                 gameRoomId: playerData.gameRoomId,
                                 playerId:   playerData.playerId };

                client.send(clientsControlTopic + '.' + recMsgBody['correlationId'],
                    {}, JSON.stringify(gameResponse));
                console.log(" [.] Sent gameResponse response to the client");
                console.log(" [x] Waiting for messages...");
                break;

            case "quitGame":
                // richiesta diretta di terminazione partita. Si rimuove il client dall'array gameRoom
                console.log(" [.] Received quit game request from client [%d][%d]",
                    recMsgBody.gameRoomId, recMsgBody.playerId);

                removeUserFromGameRoom(recMsgBody.gameRoomId, recMsgBody.playerId);
                console.log(" [.] User removed from gameRooms array");
                console.log(' [.] New gameRoom configuration:');
                printGameRooms();
                console.log(" [x] Waiting for messages...");
                break;

            case "heartbeat":
                // ricevuto un heartbeat dal client. Se il server non riceve heartBeat da un client per più
                // di 10 secondi, lo rimuove dal gioco e notifica la game room
                console.log(" [.] Received heartbeat from client [%d][%d]", recMsgBody.gameRoomId, recMsgBody.playerId);
                updateHeartBeat(recMsgBody.gameRoomId, recMsgBody.playerId);
                console.log(" [x] Waiting for messages...");
                break;

            case "tilesRequest":
                // un client ha richiesto una nuova disposizione di tiles per la propria gameRoom
                console.log(" [.] Received tiles request from gameRoom [%d]", recMsgBody.gameRoomId);

                // genera tiles casuali, rappresentandole tramite una stringa, in cui ogni carattere
                // rappresenta una casella
                let tilesValue = "";
                for (let i = 0; i < 25; i++) {
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

                let tilesResponse = { msgType:   "tilesResponse",
                                 gameRoomId: recMsgBody.gameRoomId,
                                 playerId:  "server",
                                 tiles:      tilesValue };

                // invia una notifica alla gameRoom
                client.send(gameRoomsTopic + '.' + recMsgBody.gameRoomId,
                    {}, JSON.stringify(tilesResponse));

                console.log(" [.] Sent tiles response to gameRoom [%d]: '%s'", recMsgBody.gameRoomId, tilesValue);
                console.log(" [x] Waiting for messages...");
                break;

            default:
                // messaggio senza tipologia: utilizzato per i test
                console.log(" [.] Received unknown message: " + recMsgBody.toString());
                console.log(" [x] Waiting for messages...");
                break;
        }

    }, { durable: false, exclusive: false });
    console.log(" [x] Waiting for messages...");
}

// stampa a console le gameRoom attive
function printGameRooms() {
    if (gameRooms.length <= 0) {
        console.log(" [.] empty");
    } else {
        for (let i = 0; i < gameRooms.length; i++) {
            console.log(" [.] %d [%d][%d]", i, gameRooms[i][0].occupiedSlot, gameRooms[i][1].occupiedSlot);
        }
    }
}


/*
 * Funzioni per la manipolazione dell'array gameRooms
 */

// aggiunge un riferimento all'utente nel primo slot libero gameRoom
// ritorna un oggetto contenente gameRoom e playerId assegnati al richiedente
function addUserToGameRoom() {
    let gameRoomsCount = gameRooms.length;

    if (gameRoomsCount > 0) {
        // cerca il primo slot libero tra le gameRoom
        for (let gRoomIndex = 0; gRoomIndex < gameRooms.length; gRoomIndex++) {
            for (let slotIndex = 0; slotIndex < gameRooms[gRoomIndex].length; slotIndex++) {
                // si è trovato uno slot libero: piazza l'utente lì
                if(!gameRooms[gRoomIndex][slotIndex].occupiedSlot) {
                    gameRooms[gRoomIndex][slotIndex] = occupySlot(gRoomIndex, slotIndex);
                    return { gameRoomId : gRoomIndex, playerId : slotIndex };
                }
            }
        }

        // non c'è uno slot libero: crea una nuova gameRoom e piazza l'utente nel primo slot
        gameRooms.push( [occupySlot(gameRoomsCount, 0), createFreeSlot()] );
        return { gameRoomId : gameRoomsCount, playerId : 0 };

    } else {
        // deve essere creata la prima gameRoom: crea la gameRoom e piazza l'utente nel primo slot
        gameRooms.push([occupySlot(0, 0), createFreeSlot()]);
        return {gameRoomId: 0, playerId: 0};
    }
}


// rimuove un utente dalla propria gameRoom
function removeUserFromGameRoom(gameRoomId, playerId) {
    clearSlot(gameRoomId, playerId);

    // rimuove le eventuali gameRoom vuote
    for (let gRoomIndex = gameRooms.length - 1; gRoomIndex >= 0; gRoomIndex--) {
        let gameRoomToDelete = true;
        for(let slotIndex = 0; slotIndex < gameRooms[gRoomIndex].length; slotIndex++) {
            if(gameRooms[gRoomIndex][slotIndex])
                gameRoomToDelete = false;
        }

        if(gameRoomToDelete)
            gameRooms.splice(gRoomIndex, 1);
    }
}


// crea uno slot libero da porre su una gameRoom
function createFreeSlot() {
    return { occupiedSlot: false, heartBeatTimer: null };
}


// setta uno slot come occupato, aggiornando la variabile di occupazione e settando un
// timer per gestire l'heartbeat
function occupySlot(gameRoomId, playerId) {
    let timer = setTimeout(
        function() {
            console.log(' [.] HeartBeat timer of [%d][%d] expired', gameRoomId, playerId);

            removeUserFromGameRoom(gameRoomId, playerId);
            console.log(" [.] User removed from gameRooms array");

            let response = { msgType:    "quitGame",
                        'gameRoomId': gameRoomId,
                        'playerId':   playerId };

            // invia una notifica alla gameRoom, rendendo partecipi i giocatori
            // che un giocatore è stato disconnesso
            client.send(gameRoomsTopic + '.' + gameRoomId + '.' + playerId, {}, JSON.stringify(response));

            console.log(" [.] Sent disconnection notification to gameRoom for user [%d][%d]", gameRoomId, playerId);
            console.log(' [.] New gameRoom configuration:');
            printGameRooms();
            console.log(" [x] Waiting for messages...");
        }, 10000);

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