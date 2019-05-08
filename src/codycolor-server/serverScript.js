#!/usr/bin/env node

/*
 * serverScript.js: script node.Js per la gestione lato server di CodyColor. Tiene traccia dei vari giocatori
 * collegati in multiplayer, li sincrinizza e ne memorizza dati persistenti
 */

/*
 * serverScript.js: script node.Js per la gestione lato server di CodyColor. Tiene traccia dei vari giocatori
 * collegati in multi player, sincronizza le partite e ne memorizza dati persistenti
 */


// imports
let utilities       = require('./utilities');
let options         = require('./options');
let rabbit          = require('./rabbitCommunicator');
let randomGameRooms = require('./randomGameRooms');
let customGameRooms = require('./customGameRooms');

// costante di controllo
const gameTypes = { custom: 'custom', random: 'random' };

// inizializzazione
utilities.printProgramHeader();

rabbit.connect({ onConnectedSignal: function (message) {
        utilities.printLog(false, 'A new client connected to the broker');
        sendGeneralInfoMessage(message.correlationId);
        utilities.printLog(true, 'Waiting for messages...');

    }, onGameRequest: function (message) {
        // richiesta di nuova partita. Aggiunge un nuovo player nell'array gameRooms
        // e comunica al client playerId e gameRoom assegnatigli
        let gameType        = message.gameType;
        let responseMessage = undefined;
        let playerData      = undefined;
        let gameRoomHandler = (message.gameType === gameTypes.custom ? customGameRooms : randomGameRooms);

        utilities.printLog(false, 'Received ' + gameType + ' gameRequest from client');
        if (gameType === gameTypes.random) {
            // 1. random game request
            playerData = randomGameRooms.addUserToGameRoom();
            responseMessage = {
                msgType:   'gameResponse',
                gameRoomId: playerData.gameRoomId,
                playerId:   playerData.playerId,
                gameType:   gameType.random
            };

        } else if (gameType === gameTypes.custom && message.code === '0000') {
            // 2. custom new game request
            playerData = customGameRooms.addUserToGameRoom(false);
            responseMessage = {
                msgType: 'gameResponse',
                gameRoomId: playerData.gameRoomId,
                playerId: playerData.playerId,
                code: playerData.code,
                gameType:   gameType.custom
            };
        } else {
            // 3. custom on invitation game request
            playerData = customGameRooms.addUserToGameRoom(true, message.code);
            if (playerData !== undefined) {
                responseMessage = {
                    msgType: 'gameResponse',
                    gameRoomId: playerData.gameRoomId,
                    playerId: playerData.playerId,
                    code: playerData.code,
                    gameType: gameType.custom
                };
            }
        }

        if (responseMessage !== undefined && playerData !== undefined) {
            // success
            utilities.printLog(false, 'Client successfully added to ' + message.gameType + ' gameRooms ' +
                'array. User params: ' + playerData.gameRoomId + '[' + playerData.playerId + ']');
            gameRoomHandler.printGameRooms();

        } else {
            // failed to add
            utilities.printLog(false, 'The request is not valid anymore.');
            responseMessage = {
                msgType: 'gameResponse',
                code: '0000',
                gameType: message.gameType
            };
        }
        rabbit.sendToClientControlQueue(message.correlationId, responseMessage);
        utilities.printLog(true, 'Waiting for messages...');

    }, onQuitGame: function (message) {
        utilities.printLog(false, 'Received quitGame request from ' + message.gameType + ' client ' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = (message.gameType === gameTypes.custom ? customGameRooms : randomGameRooms);

        if (gameRoomHandler.isPlayerDataValid(message.gameRoomId, message.playerId)) {
            gameRoomHandler.removeUserFromGameRoom(message.gameRoomId, message.playerId);
            utilities.printLog(false, 'User removed from ' + message.gameType + ' game rooms array');
            gameRoomHandler.printGameRooms();

        } else {
            utilities.printLog(false, 'The user is not present in the game room [' + message.playerId + ']');
        }
        utilities.printLog(true, 'Waiting for messages...');

    }, onHeartbeat: function (message) {
        // ricevuto un heartbeat dal client. Se il server non riceve heartBeat da un client per più
        // di 10 secondi, lo rimuove dal gioco e notifica la game room
        let gameRoomHandler = (message.gameType === gameTypes.custom ? customGameRooms : randomGameRooms);
        if (gameRoomHandler.isPlayerDataValid(message.gameRoomId, message.playerId)) {
            gameRoomHandler.updateHeartBeat(message.gameRoomId, message.playerId);

        } else {
            utilities.printLog(false, 'Received invalid heartbeat');
            let responseMessage = {
                'msgType': 'quitGame',
                'gameRoomId': message.gameRoomId,
                'playerId': 'server',
                'gameType': message.gameType
            };

            rabbit.sendToGameRoomTopic(responseMessage);
            utilities.printLog(true, 'Waiting for messages...');
        }

    }, onTilesRequest: function (message) {
        // un client ha richiesto una nuova disposizione di tiles per la propria gameRoom
        utilities.printLog(false, 'Received tiles request from ' + message.gameType +
            ' game room ' + message.gameRoomId);

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

        let responseMessage = {
            msgType: 'tilesResponse',
            gameRoomId: message.gameRoomId,
            gameType: message.gameType,
            playerId: 'server',
            tiles: tilesValue
        };

        rabbit.sendToGameRoomTopic(responseMessage);
        options.addTotalMatches();

        utilities.printLog(false,"Played matches from the beginning: " + options.getTotalMatches());
        utilities.printLog(true, 'Waiting for messages...');

    }, onInvalidMessage: function (message) {
        utilities.printLog(false, 'Received invalid message; ignored. ' + message);
        utilities.printLog(true, 'Waiting for messages...');
    }
});


randomGameRooms.setCallbacks(function () {
    updateSessionOptions();
}, function (gameRoomId, playerId) {
    onHeartbeatExpired(gameRoomId, playerId, gameTypes.random)
});


customGameRooms.setCallbacks(function () {
    updateSessionOptions();
}, function (gameRoomId, playerId) {
    onHeartbeatExpired(gameRoomId, playerId, gameTypes.custom)
});


let onHeartbeatExpired = function(gameRoomId, playerId, gameType) {
    utilities.printLog(false, 'Heartbeat timer of ' + gameRoomId + '[' + playerId + '] in ' + gameType + ' game rooms expired');

    let gameRoomHandler = (gameType === gameTypes.custom ? customGameRooms : randomGameRooms);
    gameRoomHandler.removeUserFromGameRoom(gameRoomId, playerId);
    utilities.printLog(false, 'User removed from ' + gameType + ' gameRooms array');

    let responseMessage = {
        msgType: 'quitGame',
        'gameRoomId': gameRoomId,
        'playerId': playerId,
        'gameType': gameType
    };
    // invia una notifica alla gameRoom, rendendo partecipi i giocatori
    // che un giocatore è stato disconnesso
    rabbit.sendToGameRoomTopic(responseMessage);
    gameRoomHandler.printGameRooms();
    utilities.printLog(true, 'Waiting for messages...');
};


let updateSessionOptions = function() {
    let connectedPlayers = 0;
    connectedPlayers += randomGameRooms.getConnectedPlayers();
    connectedPlayers += customGameRooms.getConnectedPlayers();
    options.setConnectedPlayers(connectedPlayers);

    let randomWaitingPlayers = randomGameRooms.getWaitingPlayers();
    options.setRandomWaitingPlayers(randomWaitingPlayers);
    sendGeneralInfoMessage();
};


let sendGeneralInfoMessage = function(correlationId) {
    let message = {
        'msgType':             'generalInfo',
        'totalMatches':         options.getTotalMatches(),
        'connectedPlayers':     options.getConnectedPlayers(),
        'randomWaitingPlayers': options.getRandomWaitingPlayers()
    };

    if (correlationId === undefined) {
        rabbit.sendToGeneralTopic(message);
    } else {
        rabbit.sendToClientControlQueue(correlationId, message);
    }
};


/* // old vers.
printLog(false, 'CodyColor gameServer');
printLog(false, 'Project by Riccardo Maldini');
printLog(false, '');

// variabile dalla quale verranno gestiti gameRoom e client collegati
let randGameRooms = [];
let custGameRooms = [];

// queue e topic utilizzati nelle comunicazioni con il broker
const serverControlQueue  = '/queue/serverControl';
const clientsControlTopic = '/topic/clientsControl';
const randGameRoomsTopic  = '/topic/gameRooms';
const custGameRoomsTopic  = '/topic/custGameRooms';
const generalTopic        = "/topic/general";
const random = 'random';
const custom = 'custom';

// crea o leggi, se disponibile, il file opzioni
// conteggio dei match dall'ultimo riavvio
let connectedPlayers = 0;
let options = { totalMatches: 5000 };
let fs = require('fs');
fs.readFile('/data/options.json', 'utf8', function readFileCallback(err, data){
    if (err){
        printLog(false, err);
        printLog(false, 'First writing options file');
        fs.writeFile('/data/options.json', JSON.stringify(options), 'utf8', function (err) {
            if (err)
                printLog(false, 'Error saving options file: ' + err);
            else
                printLog(false, 'Options saved.')
        });
    } else {
        printLog(false, 'Options file found. Reading...');
        options = JSON.parse(data);
        printLog(false, 'Ready: ' +  JSON.stringify(options));
    }
});

// istanza per il collegamento al broker tramite protocollo STOMP WebSocket
// utilizza la libreria esterna npm 'stompjs'
const HOST = process.env.HOST || 'rabbit';
const PORT = process.env.PORT || 15674;
const stompUrl = `ws://${HOST}:${PORT}/ws`;
//const stompUrl = 'ws://127.0.0.1:15674/ws';

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

        if (messageBody.msgType === undefined) {
            printLog(false, 'Received invalid message; ignored.');
            printLog(true, 'Waiting for messages...');
            return;
        }

        // richiesta diretta di terminazione partita. Si rimuove il client dall'array gameRoom
        let gameType = random;
        if (messageBody.gameType !== undefined && messageBody.gameType === custom) {
            gameType = custom;
        }
        let gameRoomsTopic = (gameType === random ? randGameRoomsTopic : custGameRoomsTopic);

        switch (messageBody.msgType) {
            case 'connectedSignal':
                // nuovo client connesso, ancora non coinvolto in partite
                printLog(false, 'A new client connected to the broker');
                sendGeneralInfoMessage(messageBody['correlationId']);
                printLog(true, 'Waiting for messages...');
                break;

            case 'gameRequest':
                // richiesta di nuova partita. Aggiunge un nuovo player nell'array gameRooms
                // e comunica al client playerId e gameRoom assegnatigli
                printLog(false, 'Received ' + gameType + ' game request from client');
                if (gameType === random) {
                    // random match
                    let playerData = addUserToRandomGameRoom();
                    printLog(false, 'Client added to random gameRooms array. User params: '
                        + playerData.gameRoomId + '[' + playerData.playerId + ']');
                    printGameRooms();

                    let responseMessage = { msgType:   'gameResponse',
                        gameRoomId: playerData.gameRoomId,
                        playerId:   playerData.playerId,
                        'gameType':  random };

                    client.send(clientsControlTopic + '.' + messageBody['correlationId'],
                        {}, JSON.stringify(responseMessage));
                    printLog(false, 'Sent gameResponse to the client');

                    connectedPlayers++;
                    sendGeneralInfoMessage();

                    printLog(true, 'Waiting for messages...');

                } else {
                    // custom match
                    if (messageBody.code === '0000') {
                        // il codice 0000 indica che si sta creando una nuova partita. Nella risposta verrà inviato
                        // il codice della game room
                        let newPlayerData = addUserToCustomGameRoom(false);
                        printLog(false, 'Client added to custom GameRooms array. User params: '
                            + newPlayerData.gameRoomId + '[' + newPlayerData.playerId + ']');
                        printGameRooms(custom);

                        let responseMessage = { msgType:   'gameResponse',
                            gameRoomId: newPlayerData.gameRoomId,
                            playerId:   newPlayerData.playerId,
                            code:       newPlayerData.code,
                            'gameType':  custom };

                        client.send(clientsControlTopic + '.' + messageBody['correlationId'],
                            {}, JSON.stringify(responseMessage));

                        printLog(false, 'Sent gameResponse response to the client');
                        connectedPlayers++;
                        sendGeneralInfoMessage();

                    } else {
                        printLog(false, 'The client has an invitation');
                        let newPlayerData = addUserToCustomGameRoom(true, messageBody.code);

                        if (newPlayerData !== undefined) {
                            printLog(false, 'Client added to custGameRoom array. User params: '
                                + newPlayerData.gameRoomId + '[' + newPlayerData.playerId + ']');
                            printGameRooms(custom);

                            let responseMessage = { msgType:   'gameResponse',
                                gameRoomId: newPlayerData.gameRoomId,
                                playerId:   newPlayerData.playerId,
                                code:       newPlayerData.code };

                            client.send(clientsControlTopic + '.' + messageBody['correlationId'],
                                {}, JSON.stringify(responseMessage));
                            printLog(false, 'Sent custom gameResponse response to the client');

                            connectedPlayers++;
                            sendGeneralInfoMessage();

                        } else {
                            printLog(false, 'The code is not valid anymore.');
                            let responseMessage = { msgType: 'gameResponse',
                                code:    '0000'};

                            client.send(clientsControlTopic + '.' + messageBody['correlationId'],
                                {}, JSON.stringify(responseMessage));
                            printLog(false, 'Notified to the client');
                        }
                    }
                    printLog(true, 'Waiting for messages...');
                }

                break;

            case 'quitGame':
                printLog(false, 'Received quit game request from ' + gameType +' client ' +
                    + messageBody.gameRoomId + '[' + messageBody.playerId + ']');

                if (isPlayerDataValid(messageBody.gameRoomId, messageBody.playerId, gameType)) {
                    removeUserFromGameRoom(messageBody.gameRoomId, messageBody.playerId, gameType);
                    printLog(false, 'User removed from ' + gameType + ' gameRooms array');
                    printGameRooms(gameType);

                    connectedPlayers--;
                    if (connectedPlayers < 0)
                        connectedPlayers = 0;
                    sendGeneralInfoMessage();

                } else {
                    printLog(false, 'User not present yet');
                }
                printLog(true, 'Waiting for messages...');
                break;

            case 'heartbeat':
                // ricevuto un heartbeat dal client. Se il server non riceve heartBeat da un client per più
                // di 10 secondi, lo rimuove dal gioco e notifica la game room
                if (isPlayerDataValid(messageBody.gameRoomId, messageBody.playerId, gameType)) {
                    updateHeartBeat(messageBody.gameRoomId, messageBody.playerId, gameType);
                } else {
                    printLog(false, 'Received invalid heartbeat');
                    if (messageBody.gameRoomId !== -1) {
                        let msgResponse = { 'msgType':   'quitGame',
                            'gameRoomId': messageBody.gameRoomId,
                            'playerId':  'server',
                            'gameType':  gameType
                        };
                        client.send(gameRoomsTopic + '.' + messageBody.gameRoomId,
                            {}, JSON.stringify(msgResponse));
                        printLog(false, 'Sent disconnection notification to ' + gameType + ' gameRoom ' +
                            '[' + messageBody.gameRoomId + ']');
                    }
                    printLog(true, 'Waiting for messages...');
                }
                break;

            case 'tilesRequest':
                // un client ha richiesto una nuova disposizione di tiles per la propria gameRoom
                printLog(false, 'Received tiles request from ' + gameType +
                    ' gameRoom ['+ messageBody.gameRoomId +']');
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
                    'gameType': gameType,
                    playerId:  'server',
                    tiles:      tilesValue };

                // invia una notifica alla gameRoom
                client.send(gameRoomsTopic + '.' + messageBody.gameRoomId,
                    {}, JSON.stringify(tilesResponse));

                printLog(false, 'Sent tiles response to ' + gameType +' gameRoom ' +
                    '[' + messageBody.gameRoomId+']: ' + tilesValue);

                options.totalMatches++;
                fs.writeFile('/data/options.json', JSON.stringify(options), 'utf8', function (err) {
                    if (err)
                        printLog(false, 'Error saving options file: ' + err);
                    else
                        printLog(false, 'Options saved.')
                });
                sendGeneralInfoMessage();

                printLog(false, "Played matches from the beginning: " + options.totalMatches);
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


function isPlayerDataValid(gameRoomId, playerId, gameType) {
    let gameRooms = (gameType === undefined || gameType === random ? randGameRooms : custGameRooms);

    return gameRoomId !== -1
        && playerId !== -1
        && gameRooms.length !== 0
        && gameRoomId <= gameRooms.length
        && gameRooms[gameRoomId] !== undefined
        && gameRooms[gameRoomId][playerId] !== undefined;
}


function sendGeneralInfoMessage(correlationId) {
    let infoMessage = { msgType:          'generalInfo',
        'totalMatches':     options.totalMatches,
        'connectedPlayers': connectedPlayers };

    if (correlationId === undefined) {
        client.send(generalTopic, {}, JSON.stringify(infoMessage));
        printLog(false, 'Sent info update in general topic');

    } else {
        client.send(clientsControlTopic + '.' + correlationId,
            {}, JSON.stringify(infoMessage));
        printLog(false, 'Sent info update in client queue');
    }
}


// stampa a console le gameRoom attive
function printGameRooms(gameType) {
    let gameRooms = (gameType === undefined || gameType === random ? randGameRooms : custGameRooms);
    printLog(false, 'New ' + gameType + ' game room configuration:');

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
/*
// aggiunge un riferimento all'utente nel primo slot libero gameRoom
// ritorna un oggetto contenente gameRoom e playerId assegnati al richiedente
function addUserToRandomGameRoom() {
    let gameRoomsCount = randGameRooms.length;

    if (gameRoomsCount > 0) {
        // dà la precedenza alle gameRoom con giocatori in attesa di avversari
        for (let gRoomIndex = 0; gRoomIndex < randGameRooms.length; gRoomIndex++) {
            if (randGameRooms[gRoomIndex][0].occupiedSlot && !randGameRooms[gRoomIndex][1].occupiedSlot) {
                randGameRooms[gRoomIndex][1] = generateOccupiedSlot(gRoomIndex, 1, random);
                return { gameRoomId : gRoomIndex, playerId : 1 };
            }
        }

        // cerca il primo slot libero tra le gameRoom
        for (let gRoomIndex = 0; gRoomIndex < randGameRooms.length; gRoomIndex++) {
            for (let slotIndex = 0; slotIndex < randGameRooms[gRoomIndex].length; slotIndex++) {
                // si è trovato uno slot libero: piazza l'utente lì
                if (!randGameRooms[gRoomIndex][slotIndex].occupiedSlot) {
                    randGameRooms[gRoomIndex][slotIndex] = generateOccupiedSlot(gRoomIndex, slotIndex, random);
                    return { gameRoomId : gRoomIndex, playerId : slotIndex };
                }
            }
        }

        // non c'è uno slot libero: crea una nuova gameRoom e piazza l'utente nel primo slot
        randGameRooms.push([ generateOccupiedSlot(gameRoomsCount, 0, random), generateFreeSlot(random) ]);
        return { gameRoomId : gameRoomsCount, playerId : 0 };

    } else {
        // deve essere creata la prima gameRoom: crea la gameRoom e piazza l'utente nel primo slot
        randGameRooms.push([generateOccupiedSlot(0, 0, random), generateFreeSlot(random)]);
        return {gameRoomId: 0, playerId: 0};
    }
}


// aggiunge un riferimento all'utente nel primo slot libero gameRoom
// ritorna un oggetto contenente gameRoom e playerId assegnati al richiedente
function addUserToCustomGameRoom(fromInvitation, invitationCode) {
    let gameRoomsCount = custGameRooms.length;

    if (fromInvitation === undefined || !fromInvitation) {
        if (gameRoomsCount > 0) {
            // cerca la prima gameRoom libera
            for (let gRoomIndex = 0; gRoomIndex < custGameRooms.length; gRoomIndex++) {
                if (!custGameRooms[gRoomIndex][0].occupiedSlot && !custGameRooms[gRoomIndex][1].occupiedSlot) {
                    // occupa il primo slot
                    custGameRooms[gRoomIndex][0] = generateOccupiedSlot(gRoomIndex, 0, custom, custGameRooms[gRoomIndex][0].code);
                    return { gameRoomId: gRoomIndex, playerId: 0, code: custGameRooms[gRoomIndex][0].code };
                }
            }

            // non c'è uno slot libero: crea una nuova gameRoom e piazza l'utente nel primo slot
            let uniqueCode = createUniqueCode();
            custGameRooms.push([ generateOccupiedSlot(gameRoomsCount, 0, custom, uniqueCode),
                generateFreeSlot(custom, uniqueCode) ]);
            return { gameRoomId: gameRoomsCount, playerId: 0, code: uniqueCode };

        } else {
            // deve essere creata la prima gameRoom: crea la gameRoom e piazza l'utente nel primo slot
            let uniqueCode = createUniqueCode();
            custGameRooms.push([ generateOccupiedSlot(0, 0, custom, uniqueCode),
                generateFreeSlot(custom, uniqueCode) ]);

            return { gameRoomId: 0, playerId: 0, code: uniqueCode };
        }

    } else {
        // si è stati invitati: cerca la gameRoom che ha proposto la partita
        for (let gRoomIndex = 0; gRoomIndex < custGameRooms.length; gRoomIndex++) {
            if (custGameRooms[gRoomIndex][1].code.toString() === invitationCode.toString()
                && !custGameRooms[gRoomIndex][1].occupiedSlot
                && custGameRooms[gRoomIndex][0].occupiedSlot) {
                // occupa lo slot e restituisci i dati utente
                custGameRooms[gRoomIndex][1] = generateOccupiedSlot(gRoomIndex, 1, custom, invitationCode.toString());
                return { gameRoomId: gRoomIndex, playerId: 1, code: invitationCode};
            }
        }
        // il codice non è più valido: ritorna un oggetto nullo
        return undefined;
    }
}


// rimuove un utente dalla propria gameRoom
function removeUserFromGameRoom(gameRoomId, playerId, gameType) {
    if (gameType === undefined || gameType === random) {
        clearSlot(gameRoomId, playerId, gameType);

        // rimuove le eventuali gameRoom vuote
        for (let gRoomIndex = randGameRooms.length - 1; gRoomIndex >= 0; gRoomIndex--) {
            if (!randGameRooms[gRoomIndex][0].occupiedSlot && !randGameRooms[gRoomIndex][1].occupiedSlot)
                randGameRooms.splice(gRoomIndex, 1);
            else
                break;
        }
    } else {
        clearSlot(gameRoomId, playerId, gameType);
        if (custGameRooms[gameRoomId] !== undefined
            && !custGameRooms[gameRoomId][0].occupiedSlot
            && !custGameRooms[gameRoomId][1].occupiedSlot) {
            updateCustGameRoomCode(gameRoomId);
        }

        // rimuove le eventuali gameRoom vuote
        for (let gRoomIndex = custGameRooms.length - 1; gRoomIndex >= 0; gRoomIndex--) {
            if (!custGameRooms[gRoomIndex][0].occupiedSlot && !custGameRooms[gRoomIndex][1].occupiedSlot)
                custGameRooms.splice(gRoomIndex, 1);
            else
                break;
        }
    }
}


function updateCustGameRoomCode(gameRoomId) {
    if (custGameRooms[gameRoomId] !== undefined) {
        let newCode = createUniqueCode();
        custGameRooms[gameRoomId][0].code = newCode;
        custGameRooms[gameRoomId][1].code = newCode;
    }
}


function createUniqueCode() {
    let newCode = '0000';
    let unique = true;
    do {
        newCode = (Math.floor(Math.random() * 10)).toString()
            + (Math.floor(Math.random() * 10)).toString()
            + (Math.floor(Math.random() * 10)).toString()
            + (Math.floor(Math.random() * 10)).toString();

        unique = true;
        for (let i = 0; i < custGameRooms.length; i++) {
            if (newCode === custGameRooms[i].code)
                unique = false;
        }
    } while(!unique);

    return newCode;
}



// crea uno slot libero da porre su una gameRoom
function generateFreeSlot(gameType, codeValue) {
    if (gameType === undefined || gameType === random) {
        return { occupiedSlot: false, heartBeatTimer: null };

    } else {
        return { occupiedSlot: false, heartBeatTimer: null, code: codeValue.toString() };
    }
}

// setta uno slot come occupato, aggiornando la variabile di occupazione e settando un
// timer per gestire l'heartbeat
function generateOccupiedSlot(gameRoomId, playerId, gameType, gRoomCode) {
    let timer = setTimeout(
        function () {
            printLog(false, 'Heartbeat timer of ' + gameRoomId + '[' + playerId + '] in ' + gameType + ' expired');

            removeUserFromGameRoom(gameRoomId, playerId, gameType);
            printLog(false, 'User removed from ' + gameType + ' gameRooms array');

            let response = {
                msgType: 'quitGame',
                'gameRoomId': gameRoomId,
                'playerId': playerId,
                'gameType': gameType
            };

            // invia una notifica alla gameRoom, rendendo partecipi i giocatori
            // che un giocatore è stato disconnesso
            let gameRoomsTopic = (gameType === undefined || gameType === random ? randGameRoomsTopic
                : custGameRoomsTopic);
            client.send(gameRoomsTopic + '.' + gameRoomId, {}, JSON.stringify(response));

            printLog(false, 'Sent quit notification to ' + gameType + ' gameRoom [' + gameRoomId + ']');
            printGameRooms(gameType);

            connectedPlayers--;
            if (connectedPlayers < 0)
                connectedPlayers = 0;

            sendGeneralInfoMessage();

            printLog(true, 'Waiting for messages...');
        }, 10000);
    if (gameType === undefined || gameType === random)
        return { occupiedSlot: true, heartBeatTimer: timer };
    else
        return { occupiedSlot: true, heartBeatTimer: timer, code: gRoomCode };
}


// pulisce uno slot in precedenza occupato, rimuovendo il timer e togliendo il riferimento
function clearSlot(gameRoomId, playerId, gameType) {
    if (gameType === undefined || gameType === random) {
        if (randGameRooms[gameRoomId][playerId] !== undefined) {
            clearTimeout(randGameRooms[gameRoomId][playerId].heartBeatTimer);
            randGameRooms[gameRoomId][playerId] = generateFreeSlot(random);
        }
    } else {
        if (custGameRooms[gameRoomId][playerId] !== undefined) {
            let code = custGameRooms[gameRoomId][playerId].code;
            clearTimeout(custGameRooms[gameRoomId][playerId].heartBeatTimer);
            custGameRooms[gameRoomId][playerId] = generateFreeSlot(custom, code);
        }
    }
}


// aggiorna il timer heartbeat di un giocatore. invocato all'arrivo di un messaggio di heartbeat
function updateHeartBeat(gameRoomId, playerId, gameType) {
    if (gameType === undefined || gameType === random) {
        if (randGameRooms[gameRoomId][playerId] !== undefined) {
            clearTimeout(randGameRooms[gameRoomId][playerId].heartBeatTimer);
            randGameRooms[gameRoomId][playerId] = generateOccupiedSlot(gameRoomId, playerId, random);
        }

    } else {
        if (custGameRooms[gameRoomId][playerId] !== undefined) {
            clearTimeout(custGameRooms[gameRoomId][playerId].heartBeatTimer);
            custGameRooms[gameRoomId][playerId] = generateOccupiedSlot(gameRoomId, playerId, custom,
                custGameRooms[gameRoomId][playerId].code);
        }
    }
}

// crea un log formattato in maniera corretta
function printLog(isFinal, text) {
    let final = (isFinal ? 'x' : '.');
    let utcDate = (new Date()).toUTCString();
    console.log(' [%s] [%s] %s', final, utcDate, text);
}
*/