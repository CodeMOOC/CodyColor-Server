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
        // richiesta di nuova partita. Aggiunge un nuovo player nell'array gameRooms;
        // e comunica al client playerId e gameRoom assegnatigli; riferisce agli altri client
        // dell'arrivo del nuovo giocatore, se il messaggio comprende opzioni di validazione
        utilities.printLog(false, 'Received ' + message.gameType + ' gameRequest from client');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handleGameRequest(message);
        sendMessages(result.messages);

        if (result.success) {
            utilities.printLog(false, 'Client successfully added to ' + message.gameType + ' gameRooms ' +
                'array. User params: ' + result.gameRoomId + '[' + result.playerId + ']');
            gameRoomHandler.printGameRooms();
        } else {
            utilities.printLog(false, 'The request is not valid anymore.');
        }
        utilities.printLog(true, 'Waiting for messages...');

    }, onValidation: function(message) {
        // messaggio di validazione del player: fornisce tutti i dati che permettono di validare il giocatore (solo il
        // nickname, al momento) e comunica agli altri giocatori collegati dell'arrivo del nuovo giocatore.
        // che verranno quindi inoltrati agli altri client
        utilities.printLog(false, 'Received ' + message.gameType + ' validation request from client' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handleValidation(message);
        sendMessages(result.messages);

    }, onPlayerQuit: function (message) {
        // un giocatore avvisa di voler lasciare la partita. Rimuove il giocatore dall'array, e invia un
        // avviso nella game room. Se necessario, invia un comando per forzare l'abbandono del gioco da parte dei
        // giocatori rimasti
        utilities.printLog(false, 'Received playerQuit request from ' + message.gameType + ' client ' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handlePlayerQuit(message);
        sendMessages(result.messages);

        if (result.success) {
            utilities.printLog(false, 'User removed from ' + message.gameType + ' game rooms array');
            gameRoomHandler.printGameRooms();
        } else {
            utilities.printLog(false, 'WARNING: The user is not present in the game room ' +
                '[' + message.gameRoomId + ']');
        }
        utilities.printLog(true, 'Waiting for messages...');

    }, onHeartbeat: function (message) {
        // ricevuto un heartbeat dal client. Se il server non riceve heartbeat da un client per più
        // di 10 secondi, lo rimuove dal gioco e notifica la game room

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handleHeartbeat(message);
        // messaggio di force quit, in caso di heartbeat invalido
        sendMessages(result.messages);

        if (!result.success) {
            utilities.printLog(false, 'Received invalid heartbeat');
            utilities.printLog(true, 'Waiting for messages...');
        }

    }, onReady: function(message) {
        // il segnale di Ready è utilizzato in varie modalità per stabilire se è il momento di iniziare la partita.
        // eventualmente, viene inviato il messaggio di startMatch
        utilities.printLog(false, 'Received ready message from ' + message.gameType + ' client ' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handleReadyMessage(message);
        sendMessages(result.messages);

        if(result.success) {
            options.addTotalMatches();
            utilities.printLog(false, "Played matches from the beginning: " + options.getTotalMatches());
        }

        utilities.printLog(true, 'Waiting for messages...');

    }, onPositioned: function(message) {
        // il segnale di Positioned permette di stabilire se il giocatore ha posizionato il proprio roby. Se necessario,
        // invia il messaggio di startAnimation
        utilities.printLog(false, 'Received positioned message from ' + message.gameType + ' client ' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handlePositionedMessage(message);
        sendMessages(result.messages);

        utilities.printLog(true, 'Waiting for messages...');

    }, onEndAnimation: function(message) {
        // il segnale di EndAnimation segnala che il giocatore ha concluso l'animazione finale, o ha premuto il segnale
        // di skip. Una volta ricevuto da tutti, invia il segnale di endMatch
        utilities.printLog(false, 'Received endAnimation message from ' + message.gameType + ' client ' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handleEndAnimationMessage(message);
        sendMessages(result.messages);

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

    let result = royaleGameRooms.directStartMatch(gameRoomId);
    sendMessages(result.messages);

    options.addTotalMatches();
    utilities.printLog(false, "Played matches from the beginning: " + options.getTotalMatches());
    utilities.printLog(true, 'Waiting for messages...');
});


let sendMessages = function(messages) {
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].correlationId === undefined)
            rabbit.sendInGameRoomTopic(messages[i]);
        else
            rabbit.sendInClientControlQueue(messages[i].correlationId, messages[i]);
    }
};


let onHeartbeatExpired = function (gameRoomIdValue, playerIdValue, gameTypeValue) {
    utilities.printLog(false, 'Heartbeat timer of ' + gameRoomIdValue + '[' + playerIdValue + '] in '
        + gameTypeValue + ' game rooms expired');

    let gameRoomHandler = getGameRoomHandler(gameTypeValue);
    let result = gameRoomHandler.handlePlayerQuit({
        gameRoomId: gameRoomIdValue,
        playerId: playerIdValue,
        gameType: gameTypeValue
    });

    sendMessages(result.messages);

    if (result.success) {
        utilities.printLog(false, 'User removed from ' + gameTypeValue + ' game rooms array');
        gameRoomHandler.printGameRooms();
    } else {
        utilities.printLog(false, 'WARNING: The user is not present in the game room ' +
            '[' + gameRoomIdValue + ']');
    }
    utilities.printLog(true, 'Waiting for messages...');
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
        msgType: messageTypes.s_generalInfo,
        totalMatches: options.getTotalMatches(),
        connectedPlayers: options.getConnectedPlayers(),
        randomWaitingPlayers: options.getRandomWaitingPlayers(),
        requiredClientVersion: utilities.requiredClientVersion
    };

    if (correlationId === undefined) {
        rabbit.sendInGeneralTopic(message);
    } else {
        rabbit.sendInClientControlQueue(correlationId, message);
    }
};