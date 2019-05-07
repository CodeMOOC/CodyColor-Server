#!/usr/bin/env node

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
            randomGameRooms.printGameRooms(gameType);
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
        utilities.printLog(false, 'Received tiles request from ' + message.msgType +
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

    }, onInvalidMessage: function () {
        utilities.printLog(false, 'Received invalid message; ignored.');
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
    onHeartbeatExpired(gameRoomId, playerId, gameTypes.random)
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
