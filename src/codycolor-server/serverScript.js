#!/usr/bin/env node

/*
 * serverScript.js: script node.Js per la gestione lato server di CodyColor. Tiene traccia dei vari giocatori
 * collegati in multi player, sincronizza le partite e ne memorizza dati persistenti
 */

if (process.argv[2] !== '-l') {
    const mysql = require('mysql');
    const connection = mysql.createConnection({
        host: 'database',
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    /*connection.connect();
    connection.query("SELECT 2 + 2 AS solution", (err, results, fields) => {
        if (err)
            throw err;
        console.log('2 + 2 = ' + results[0].solution);
    });
    connection.query("INSERT INTO `Sample` (`ID`, `Value`) VALUES(DEFAULT, 'Prova')", (err, results, fields) => {
        if (err)
            throw err;
        console.log("Inserted");
    });
    connection.end();*/
}

// imports
let utilities = require('./utilities');
let options = require('./options');
let rabbit = require('./rabbitCommunicator');
let randomGameRooms = require('./randomGameRooms');
let customGameRooms = require('./customGameRooms');
let royaleGameRooms = require('./royaleGameRooms');

const gameTypes = utilities.gameTypes;
const messageTypes = utilities.messageTypes;

// inizializzazione
utilities.printProgramHeader();

rabbit.connect({
    onConnectedSignal: function (message) {
        // un client vuole connettersi al sistema (non a una partita). Restituisce al client informazioni
        // aggiornate sullo stato del sistema
        utilities.printLog(false, 'A new client connected to the broker');
        sendGeneralInfoMessage(message.correlationId);
        utilities.printLog(true, 'Waiting for messages...');

    }, onGameRequest: function (message) {
        // richiesta di nuova partita. Aggiunge un nuovo player nell'array gameRooms
        // e comunica al client playerId e gameRoom assegnatigli
        utilities.printLog(false, 'Received ' + message.gameType + ' gameRequest from client');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let playerData = gameRoomHandler.addUserToGameRoom({
            fromInvitation: message.code !== '0000',
            invitationCode: message.code,
            dateValue: message.date,
            timerSetting: message.timerSetting,
            maxPlayersSetting: message.maxPlayersSetting,
            gameName: message.gameName
        });
        let responseMessage;
        if (playerData !== undefined) {
            responseMessage = {
                msgType: messageTypes.gameResponse,
                gameRoomId: playerData.gameRoomId,
                playerId: playerData.playerId,
                code: playerData.code,
                gameType: message.gameType,
                maxPlayersSetting: playerData.maxPlayersSetting,
                gameName: playerData.gameName,
                timerSetting: playerData.timerSetting,
                date: playerData.date,
                state: playerData.state
            };

            // success
            utilities.printLog(false, 'Client successfully added to ' + message.gameType + ' gameRooms ' +
                'array. User params: ' + playerData.gameRoomId + '[' + playerData.playerId + ']');
            gameRoomHandler.printGameRooms();

        } else {
            // failed to add
            utilities.printLog(false, 'The request is not valid anymore.');
            responseMessage = {
                msgType: messageTypes.gameResponse,
                code: '0000',
                gameType: message.gameType
            };
        }
        rabbit.sendInClientControlQueue(message.correlationId, responseMessage);
        utilities.printLog(true, 'Waiting for messages...');

    }, onQuitGame: function (message) {
        utilities.printLog(false, 'Received quitGame request from ' + message.gameType + ' client ' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let forceRemove = false;
        if (gameRoomHandler.isPlayerDataValid(message.gameRoomId, message.playerId)) {
            forceRemove = gameRoomHandler.removeUserFromGameRoom(message.gameRoomId, message.playerId);
            utilities.printLog(false, 'User removed from ' + message.gameType + ' game rooms array');
            gameRoomHandler.printGameRooms();

        } else {
            utilities.printLog(false, 'The user is not present in the game room [' + message.playerId + ']');
        }

        if (forceRemove) {
            rabbit.sendInGameRoomTopic({
                msgType: messageTypes.quitGame,
                gameRoomId: message.gameRoomId,
                playerId: 'server',
                gameType: message.gameType
            });
        }

        utilities.printLog(true, 'Waiting for messages...');

    }, onHeartbeat: function (message) {
        // ricevuto un heartbeat dal client. Se il server non riceve heartBeat da un client per più
        // di 10 secondi, lo rimuove dal gioco e notifica la game room
        let gameRoomHandler = getGameRoomHandler(message.gameType);
        if (gameRoomHandler.isPlayerDataValid(message.gameRoomId, message.playerId)) {
            gameRoomHandler.updateHeartBeat(message.gameRoomId, message.playerId);

        } else {
            // heartbeat invalido: forza la disconnessione di tutti gli utenti della game room
            utilities.printLog(false, 'Received invalid heartbeat');
            let responseMessage = {
                msgType: messageTypes.quitGame,
                gameRoomId: message.gameRoomId,
                playerId: 'server',
                gameType: message.gameType
            };

            rabbit.sendInGameRoomTopic(responseMessage);
            utilities.printLog(true, 'Waiting for messages...');
        }

    }, onTilesRequest: function (message) {
        // un client ha richiesto una nuova disposizione di tiles per la propria gameRoom
        utilities.printLog(false, 'Received tiles request from ' + message.gameType +
            ' game room ' + message.gameRoomId);

        let responseMessage = {
            msgType: messageTypes.tilesResponse,
            gameRoomId: message.gameRoomId,
            gameType: message.gameType,
            playerId: 'server',
            tiles: generateTiles()
        };

        rabbit.sendInGameRoomTopic(responseMessage);
        options.addTotalMatches();

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        gameRoomHandler.startMatch(message.gameRoomId);

        utilities.printLog(false, "Played matches from the beginning: " + options.getTotalMatches());
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


royaleGameRooms.setCallbacks(function () {
    updateSessionOptions();

}, function (gameRoomId, playerId) {
    onHeartbeatExpired(gameRoomId, playerId, gameTypes.royale);

}, function (gameRoomId) {
    utilities.printLog(false, "Start timer of royale game room expired");

    rabbit.sendInGameRoomTopic({
        msgType: messageTypes.tilesResponse,
        gameRoomId: gameRoomId,
        gameType: gameTypes.royale,
        playerId: 'server',
        tiles: generateTiles()
    });
    royaleGameRooms.startMatch(gameRoomId);

    options.addTotalMatches();
    utilities.printLog(false, "Played matches from the beginning: " + options.getTotalMatches());
    utilities.printLog(true, 'Waiting for messages...');
});


let onHeartbeatExpired = function (gameRoomId, playerId, gameType) {
    utilities.printLog(false, 'Heartbeat timer of ' + gameRoomId + '[' + playerId + '] in '
        + gameType + ' game rooms expired');

    let gameRoomHandler = getGameRoomHandler(gameType);
    let forceRemove = gameRoomHandler.removeUserFromGameRoom(gameRoomId, playerId);
    utilities.printLog(false, 'User removed from ' + gameType + ' gameRooms array');

    // invia una notifica alla gameRoom, rendendo partecipi i giocatori
    // che un giocatore è stato disconnesso
    if (forceRemove) {
        rabbit.sendInGameRoomTopic({
            msgType: messageTypes.quitGame,
            gameRoomId: gameRoomId,
            playerId: 'server',
            gameType:gameType
        });
    } else {
        rabbit.sendInGameRoomTopic({
            msgType: messageTypes.quitGame,
            'gameRoomId': gameRoomId,
            'playerId': playerId,
            'gameType': gameType
        });
    }

    gameRoomHandler.printGameRooms();
    utilities.printLog(true, 'Waiting for messages...');
};


let generateTiles = function() {
    let tiles = '';
    for (let i = 0; i < 25; i++) {
        switch (Math.floor(Math.random() * 3)) {
            case 0:
                tiles += 'R';
                break;
            case 1:
                tiles += 'Y';
                break;
            case 2:
                tiles += 'G';
                break;
        }
    }
    return tiles;
};


let getGameRoomHandler = function(gameType) {
    switch (gameType) {
        case gameTypes.custom: {
            return customGameRooms;
        }
        case gameTypes.royale: {
            return royaleGameRooms;
        }
        default: {
            return randomGameRooms;
        }
    }
};


let updateSessionOptions = function () {
    let connectedPlayers = 0;
    connectedPlayers += randomGameRooms.getConnectedPlayers();
    connectedPlayers += customGameRooms.getConnectedPlayers();
    options.setConnectedPlayers(connectedPlayers);

    let randomWaitingPlayers = randomGameRooms.getWaitingPlayers();
    options.setRandomWaitingPlayers(randomWaitingPlayers);
    sendGeneralInfoMessage();
};


let sendGeneralInfoMessage = function (correlationId) {
    let message = {
        'msgType': messageTypes.generalInfo,
        'totalMatches': options.getTotalMatches(),
        'connectedPlayers': options.getConnectedPlayers(),
        'randomWaitingPlayers': options.getRandomWaitingPlayers(),
        'requiredClientVersion':utilities.requiredClientVersion
    };

    if (correlationId === undefined) {
        rabbit.sendInGeneralTopic(message);
    } else {
        rabbit.sendInClientControlQueue(correlationId, message);
    }
};