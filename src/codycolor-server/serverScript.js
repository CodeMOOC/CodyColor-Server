#!/usr/bin/env node

/*
 * serverScript.js: script node.Js per la gestione lato server di CodyColor. Tiene traccia dei vari giocatori
 * collegati in multiplayer, li sincrinizza e ne memorizza dati persistenti
 */

printLog(false, 'CodyColor gameServer');
printLog(false, 'Project by Riccardo Maldini');
printLog(false, '');

// variabile dalla quale verranno gestiti gameRoom e client collegati
let gameRooms = [];

// conteggio dei match dall'ultimo riavvio
let matchCount = 0;
let startDate = (new Date()).toUTCString();

// queue e topic utilizzati nelle comunicazioni con il broker
const serverControlQueue  = '/queue/serverControl';
const clientsControlTopic = '/topic/clientsControl';
const gameRoomsTopic      = '/topic/gameRooms';

// istanza per il collegamento al broker tramite protocollo STOMP WebSocket
// utilizza la libreria esterna npm 'stompjs'
const HOST = process.env.HOST || 'rabbit';
const PORT = process.env.PORT || 15674;
const stompUrl = `ws://${HOST}:${PORT}/ws`;
// const stompUrl = 'ws://127.0.0.1:15674/ws';

let Stomp = require('stompjs');
printLog(false, `Initializing StompJs API at ${stompUrl}...`);
let client = Stomp.overWS(stompUrl);

// avvia la connessione con il server, con le credenziali corrette
printLog(false, 'Trying to connect to the broker...');
client.connect('guest', 'guest',         // username e password
               onConnect, onError, '/'); // callbacks e vHost

// cosa fare n caso di errore nella connessione o nel processare dei messaggi
function onError() {
    printLog(true, 'Error connecting to the broker, or processing messages');
}

// cosa fare a connessione avvenuta
function onConnect() {
    printLog(true, 'Connection to the broker ready');

    // si pone in ascolto di messaggi dai client nella queue server
    client.subscribe(serverControlQueue, function(receivedMessage) {
        let messageBody = JSON.parse(receivedMessage.body);

        if (messageBody.gameRoomId === -1 || messageBody.msgType === undefined) {
            printLog(false, 'Received invalid message; ignored.');
            printLog(true, 'Waiting for messages...');
            return;
        }

        switch (messageBody.msgType) {
            case 'gameRequest':
                // richiesta di nuova partita. Aggiunge un nuovo player nell'array gameRooms
                // e comunica al client playerId e gameRoom assegnatigli
                printLog(false, 'Received game request from new client');
                let playerData = addUserToGameRoom();
                printLog(false, 'Client added to gameRoom array. User params: '
                    + playerData.gameRoomId + '[' + playerData.playerId + ']');

                printGameRooms();

                let responseMessage = { msgType:   'gameResponse',
                                        gameRoomId: playerData.gameRoomId,
                                        playerId:   playerData.playerId };

                client.send(clientsControlTopic + '.' + messageBody['correlationId'],
                    {}, JSON.stringify(responseMessage));

                printLog(false, 'Sent gameResponse response to the client');
                printLog(true, 'Waiting for messages...');
                break;

            case 'quitGame':
                // richiesta diretta di terminazione partita. Si rimuove il client dall'array gameRoom
                printLog(false, 'Received quit game request from client ' +
                     + messageBody.gameRoomId + '[' + messageBody.playerId + ']');

                if (gameRooms.length !== 0 && messageBody.gameRoomId <= gameRooms.length
                    && gameRooms[messageBody.gameRoomId][messageBody.playerId] !== undefined) {
                    removeUserFromGameRoom(messageBody.gameRoomId, messageBody.playerId);
                    printLog(false, 'User removed from gameRooms array');
                    printGameRooms();
                } else {
                    printLog(false, 'User not present yet');
                }
                printLog(true, 'Waiting for messages...');
                break;

            case 'heartbeat':
                // ricevuto un heartbeat dal client. Se il server non riceve heartBeat da un client per più
                // di 10 secondi, lo rimuove dal gioco e notifica la game room
                if (gameRooms.length !== 0 && messageBody.gameRoomId <= gameRooms.length
                    && gameRooms[messageBody.gameRoomId][messageBody.playerId] !== undefined) {
                    //printLog(false, 'Received heartbeat from client ' + messageBody.gameRoomId + '[' + messageBody.playerId + ']');
                    updateHeartBeat(messageBody.gameRoomId, messageBody.playerId);
                } else {
                    printLog(false, 'Received invalid heartbeat');
                    let msgResponse = { msgType:    'quitGame',
                                    'gameRoomId': messageBody.gameRoomId,
                                    'playerId':   'server' };
                    client.send(gameRoomsTopic + '.' + messageBody.gameRoomId, {}, JSON.stringify(msgResponse));
                    printLog(false, 'Sent disconnection notification to gameRoom [' + messageBody.gameRoomId + '], for invalid heartbeat');
                    printLog(true, 'Waiting for messages...');
                }
                break;

            case 'tilesRequest':
                // un client ha richiesto una nuova disposizione di tiles per la propria gameRoom
                printLog(false, 'Received tiles request from gameRoom ['+ messageBody.gameRoomId +']');

                // genera tiles casuali, rappresentandole tramite una stringa, in cui ogni carattere
                // rappresenta una casella
                let tilesValue = '';
                for (let i = 0; i < 25; i++) {
                    switch (Math.floor(Math.random() * 3)) {
                        case 0:
                            tilesValue += 'R';
                            break;
                        case 1:
                            tilesValue += 'Y';
                            break;
                        case 2:
                            tilesValue += 'G';
                            break;
                    }
                }

                let tilesResponse = { msgType:   'tilesResponse',
                                      gameRoomId: messageBody.gameRoomId,
                                      playerId:  'server',
                                      tiles:      tilesValue };

                // invia una notifica alla gameRoom
                client.send(gameRoomsTopic + '.' + messageBody.gameRoomId, {}, JSON.stringify(tilesResponse));

                printLog(false, 'Sent tiles response to gameRoom ['+ messageBody.gameRoomId+']: ' + tilesValue);

                matchCount++;
                printLog(false, "Matches done from last server reboot (" + startDate + "): " + matchCount);
                printLog(true, 'Waiting for messages...');
                break;

            default:
                // messaggio senza tipologia: utilizzato per i test
                printLog(false, 'Received unknown message: ' + messageBody.toString());
                printLog(true, 'Waiting for messages...');
                break;
        }

    }, { durable: false, exclusive: false });
    printLog(true, 'Waiting for messages...');
}

// stampa a console le gameRoom attive
function printGameRooms() {
    printLog(false, 'New game room configuration:');
    if (gameRooms.length <= 0) {
        printLog(false, 'empty');
    } else {
        let gameRoomString = '';
        for (let i = 0; i < gameRooms.length; i++) {
            let firstSlot = (gameRooms[i][0].occupiedSlot ? 'x' : 'o');
            let secondSlot = (gameRooms[i][1].occupiedSlot ? 'x' : 'o');
           gameRoomString += i.toString() + '[' + firstSlot + ',' + secondSlot + '] ';
           if (i % 4 === 0 && i !== 0) {
               printLog(false, gameRoomString);
               gameRoomString = '';
           }
        }
        if (gameRoomString !== '')
            printLog(false, gameRoomString);
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
        // dà la precedenza alle gameRoom con giocatori in attesa di avversari
        for (let gRoomIndex = 0; gRoomIndex < gameRooms.length; gRoomIndex++) {
            if (gameRooms[gRoomIndex][0].occupiedSlot && !gameRooms[gRoomIndex][1].occupiedSlot) {
                gameRooms[gRoomIndex][1] = occupySlot(gRoomIndex, 1);
                return { gameRoomId : gRoomIndex, playerId : 1 };
            }
        }

        // cerca il primo slot libero tra le gameRoom
        for (let gRoomIndex = 0; gRoomIndex < gameRooms.length; gRoomIndex++) {
            for (let slotIndex = 0; slotIndex < gameRooms[gRoomIndex].length; slotIndex++) {
                // si è trovato uno slot libero: piazza l'utente lì
                if (!gameRooms[gRoomIndex][slotIndex].occupiedSlot) {
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
        if (!gameRooms[gRoomIndex][0].occupiedSlot && !gameRooms[gRoomIndex][1].occupiedSlot)
            gameRooms.splice(gRoomIndex, 1);
        else
            break;
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
            printLog(false, 'HeartBeat timer of ' + gameRoomId + '[' + playerId + '] expired');

            removeUserFromGameRoom(gameRoomId, playerId);
            printLog(false, 'User removed from gameRooms array');

            let response = { msgType:    'quitGame',
                            'gameRoomId': gameRoomId,
                            'playerId':   playerId };

            // invia una notifica alla gameRoom, rendendo partecipi i giocatori
            // che un giocatore è stato disconnesso
            client.send(gameRoomsTopic + '.' + gameRoomId, {}, JSON.stringify(response));

            printLog(false, 'Sent quit notification to gameRoom [' + gameRoomId + ']');
            printGameRooms();
            printLog(true, 'Waiting for messages...');
        }, 10000);

    return { occupiedSlot: true, heartBeatTimer: timer };
}


// pulisce uno slot in precedenza occupato, rimuovendo il timer e togliendo il riferimento
function clearSlot(gameRoomId, playerId) {
    if (gameRooms[gameRoomId][playerId] !== undefined) {
        clearTimeout(gameRooms[gameRoomId][playerId].heartBeatTimer);
        gameRooms[gameRoomId][playerId] = createFreeSlot();
    }
}


// aggiorna il timer heartbeat di un giocatore. invocato all'arrivo di un messaggio di heartbeat
function updateHeartBeat(gameRoomId, playerId) {
    if (gameRooms[gameRoomId][playerId] !== undefined) {
        clearTimeout(gameRooms[gameRoomId][playerId].heartBeatTimer);
        gameRooms[gameRoomId][playerId] = occupySlot(gameRoomId, playerId);
    }
}

// crea un log formattato in maniera corretta
function printLog(isFinal, message) {
    let final = (isFinal ? 'x' : '.');
    let utcDate = (new Date()).toUTCString();
    console.log(' [%s] [%s] %s', final, utcDate, message);
}