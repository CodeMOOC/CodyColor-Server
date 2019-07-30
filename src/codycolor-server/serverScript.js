#!/usr/bin/env node

/*
 * serverScript.js: script node.Js per la gestione lato server di CodyColor. Tiene traccia dei vari giocatori
 * collegati in multi player, sincronizza le partite e ne memorizza dati persistenti
 */

if (process.argv[2] !== '-l') {

}

// imports
let utilities = require('./utilities');
let options = require('./options');
let rabbit = require('./rabbitCommunicator');
let randomGameRooms = require('./randomGameRooms');
let customGameRooms = require('./customGameRooms');
let royaleGameRooms = require('./royaleGameRooms');
let database = require('./databaseCommunicator');

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

    }, onSignUpRequest: function(message) {
        utilities.printLog(false, 'A new user is trying to sign in');
        let insertUser = "INSERT INTO Users (Id, Email, Nickname, Deleted) " +
                         "VALUES (" + database.sanitize(message.userId) + ", "
                                    + database.sanitize(message.email)  + ", "
                                    + database.sanitize(message.nickname) + ", "
                                    + "0)";

        database.query(insertUser, function (results, error) {
            let response = {
                msgType: utilities.messageTypes.s_authResponse,
                success: !error,
                nickname: message.nickname,
                totalPoints: 0,
                wonMatches: 0,
                avgPoints: 0,
                bestMatch: undefined,
                correlationId: message.correlationId
            };

            rabbit.sendInClientControlQueue(message.correlationId, response);
        });

    }, onLogInRequest: function(message) {
        utilities.printLog(false, 'A user is trying to log in');
        let searchUser = "SELECT Nickname as nickname FROM Users " +
                         "WHERE Id = " + database.sanitize(message.userId) + "; ";

        let userTotalPoints =
            "SELECT SUM(Score) as totalPoints " +
            "FROM MatchParticipants " +
            "WHERE UserId = " + database.sanitize(message.userId) + " " +
            "GROUP BY UserId; ";

        let userWins =
            "SELECT SUM(Winner) as wonMatches " +
            "FROM MatchParticipants " +
            "WHERE UserId = " + database.sanitize(message.userId) + " " +
            "GROUP BY UserId; ";

        let userAvgPoints =
            "SELECT AVG(Score) as avgPoints " +
            "FROM MatchParticipants " +
            "WHERE UserId = " + database.sanitize(message.userId) + " " +
            "GROUP BY UserId; ";


        let bestMatch =
            "SELECT Score AS points, PathLength AS pathLength, TimeMs as time " +
            "FROM MatchParticipants " +
            "WHERE UserId = " + database.sanitize(message.userId) + " " +
            "ORDER BY points DESC, pathLength DESC, time DESC " +
            "LIMIT 1; ";

        let queries = searchUser + userTotalPoints + userWins + userAvgPoints + bestMatch;

        database.query(queries, function (results, error) {
            let response;
            if (error) {
                utilities.printLog(false, "This query generated an error: " + queries);
                response = {
                    msgType: utilities.messageTypes.s_authResponse,
                    success: false,
                    correlationId: message.correlationId
                };
            } else {
                let nicknameValue = undefined;
                if (results[0] !== undefined
                    && results[0][0] !== undefined
                    && results[0][0].nickname !== undefined) {
                    nicknameValue = results[0][0].nickname;
                }

                let totalPointsValue = 0;
                if (results[1] !== undefined
                    && results[1][0] !== undefined
                    && results[1][0].totalPoints !== undefined) {
                    totalPointsValue = results[1][0].totalPoints;
                }

                let wonMatchesValue = 0;
                if (results[2] !== undefined
                    && results[2][0] !== undefined
                    && results[2][0].wonMatches !== undefined) {
                    wonMatchesValue = results[2][0].wonMatches;
                }

                let avgPointsValue = 0;
                if (results[3] !== undefined
                    && results[3][0] !== undefined
                    && results[3][0].avgPoints !== undefined) {
                    avgPointsValue = results[3][0].avgPoints;
                }

                let bestMatchValue = undefined;
                if (results[4] !== undefined
                    && results[4][0] !== undefined) {
                    bestMatchValue = results[4][0];
                }

                response = {
                    msgType: utilities.messageTypes.s_authResponse,
                    success: nicknameValue !== undefined,
                    nickname: nicknameValue,
                    totalPoints: totalPointsValue,
                    wonMatches: wonMatchesValue,
                    avgPoints: avgPointsValue,
                    bestMatch: bestMatchValue,
                    correlationId: message.correlationId
                };
            }

            rabbit.sendInClientControlQueue(message.correlationId, response);
    });



    }, onUserDeleteRequest: function(message) {
        utilities.printLog(false, 'A user is trying to delete his account');
        let deleteUser = "UPDATE Users SET Email = '', Deleted = 1 "
                       + "WHERE Id = " + database.sanitize(message.userId);

        database.query(deleteUser, function (results, error) {
            let response = {
                msgType: utilities.messageTypes.s_userDeleteResponse,
                success: error !== undefined,
                correlationId: message.correlationId,
            };
            rabbit.sendInClientControlQueue(message.correlationId, response);
        });

    }, onRankingRequest: function(message) {
        utilities.printLog(false, 'Received ranking request');
        let top10PointsDaily =
            "SELECT U.Nickname AS nickname, SUM(MP.Score) AS points, SUM(MP.Winner) AS wonMatches " +
            "FROM Users U INNER JOIN MatchParticipants MP " +
            "ON U.Id = MP.UserId " +
            "WHERE MP.Registered = 1 AND DATE(MP.BeginTimestamp) = CURDATE() " +
            "GROUP BY U.Id " +
            "ORDER BY points DESC, wonMatches DESC " +
            "LIMIT 10; ";

        let top10PointsGlobal =
            "SELECT U.Nickname AS nickname, SUM(MP.Score) AS points, SUM(MP.Winner) AS wonMatches " +
            "FROM Users U INNER JOIN MatchParticipants MP " +
            "ON U.Id = MP.UserId " +
            "WHERE MP.Registered = 1 " +
            "GROUP BY U.Id " +
            "ORDER BY points DESC, wonMatches DESC " +
            "LIMIT 10; ";

        let top10MatchDaily =
            "SELECT * " +
            "FROM (" +
            "      (" +
            "       SELECT U.Nickname AS nickname, MP.Score AS points, MP.PathLength AS pathLength, " +
            "       MP.TimeMs as time " +
            "       FROM Users U INNER JOIN MatchParticipants MP " +
            "       ON U.Id = MP.UserId " +
            "       WHERE MP.Registered = 1 AND DATE(MP.BeginTimestamp) = CURDATE()" +
            "       ORDER BY points DESC, pathLength DESC, time DESC " +
            "       LIMIT 10" +
            "      ) " +
            "      UNION " +
            "      (" +
            "       SELECT 'Anonymous' AS nickname, MP.Score AS points, MP.PathLength AS pathLength, " +
            "       MP.TimeMs as time " +
            "       FROM MatchParticipants MP " +
            "       WHERE MP.Registered = 0 AND DATE(MP.BeginTimestamp) = CURDATE()" +
            "       ORDER BY points DESC, pathLength DESC, time DESC  " +
            "       LIMIT 10 " +
            "      ) " +
            "     ) top10MatchDaily " +
            "ORDER BY points DESC " +
            "LIMIT 10; ";

        let top10MatchGlobal =
            "SELECT * " +
            "FROM (" +
            "      (" +
            "       SELECT U.Nickname AS nickname, MP.Score AS points, MP.PathLength AS pathLength, " +
            "       MP.TimeMs as time " +
            "       FROM Users U INNER JOIN MatchParticipants MP " +
            "       ON U.Id = MP.UserId " +
            "       WHERE MP.Registered = 1 " +
            "       ORDER BY points DESC, pathLength DESC, time DESC  " +
            "       LIMIT 10" +
            "      ) " +
            "      UNION " +
            "      (" +
            "       SELECT 'Anonymous' AS nickname, MP.Score AS points, MP.PathLength AS pathLength, " +
            "       MP.TimeMs as time " +
            "       FROM MatchParticipants MP " +
            "       WHERE MP.Registered = 0 " +
            "       ORDER BY points DESC, pathLength DESC, time DESC  " +
            "       LIMIT 10 " +
            "      ) " +
            "     ) top10MatchGlobal " +
            "ORDER BY points DESC " +
            "LIMIT 10;";

        let queries = top10PointsDaily + top10PointsGlobal + top10MatchDaily + top10MatchGlobal;
        database.query(queries, function (results, error) {
            let response = {};
            if (error) {
                utilities.printLog(false, "This query generated an error: " + queries);
                response = {
                    msgType: utilities.messageTypes.s_rankingsResponse,
                    success: false,
                    correlationId: message.correlationId,
                };

            } else {
                response = {
                    msgType: utilities.messageTypes.s_rankingsResponse,
                    'top10PointsDaily': JSON.stringify(results[0]),
                    'top10PointsGlobal': JSON.stringify(results[1]),
                    'top10MatchDaily': JSON.stringify(results[2]),
                    'top10MatchGlobal': JSON.stringify(results[3]),
                    success: true,
                    correlationId: message.correlationId,
                };
            }


            rabbit.sendInClientControlQueue(message.correlationId, response);
        });

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
}, function (gameRoomData) {
    createDbGameSession(gameRoomData);
}, function (gameRoomData) {
    createDbGameMatch(gameRoomData);
});


customGameRooms.setCallbacks(function () {
    updateSessionOptions();
}, function (gameRoomId, playerId) {
    onHeartbeatExpired(gameRoomId, playerId, gameTypes.custom)
}, function (gameRoomData) {
    createDbGameSession(gameRoomData);
}, function (gameRoomData) {
    createDbGameMatch(gameRoomData);
});


royaleGameRooms.setCallbacks(function () {
    updateSessionOptions();

}, function (gameRoomId, playerId) {
    onHeartbeatExpired(gameRoomId, playerId, gameTypes.royale);

}, function (gameRoomId) {
    utilities.printLog(false, "Start timer of royale game room expired");

    let result = royaleGameRooms.directStartMatch(gameRoomId);
    sendMessages(result.messages);

    // options.addTotalMatches();
    // utilities.printLog(false, "Played matches from the beginning: " + options.getTotalMatches());
    utilities.printLog(true, 'Waiting for messages...');
}, function (gameRoomData) {
    createDbGameSession(gameRoomData);
}, function (gameRoomData) {
    createDbGameMatch(gameRoomData);
});


let sendMessages = function(messages) {
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].correlationId === undefined)
            rabbit.sendInGameRoomTopic(messages[i]);
        else
            rabbit.sendInClientControlQueue(messages[i].correlationId, messages[i]);
    }
};


let createDbGameSession = function(gameRoomData) {
    let insertSession = "INSERT INTO GameSessions (NumMatches, Type, MatchDurationMs, BeginTimestamp) "
                      + "VALUES (0, "
                              + database.sanitize(gameRoomData.gameData.gameType) + ", "
                              + gameRoomData.gameData.timerSetting + ", "
                              + database.sanitize(new Date()) + ")";

    database.query(insertSession, function (results, error) {
        if (error) {
            utilities.printLog(false, "This query generated an error: " + insertSession);
        } else {
            gameRoomData.sessionId = results.insertId;
        }
    });
};

let createDbGameMatch = function(gameRoomData) {
    let dateTimeNow = new Date();
    let numPlayers = 0;
    let anonUsers = 0;

    for (let i = 0; i < gameRoomData.players.length; i++) {
        if(gameRoomData.players[i].occupiedSlot) {
            numPlayers++;
        }
    }

    let insertMatch = "INSERT INTO GameMatches (SessionId, BeginTimestamp, NumUsers) "
                    + "VALUES ("
                              + gameRoomData.sessionId + ", "
                              + database.sanitize(dateTimeNow) + ", "
                              + numPlayers + ")";
    database.query(insertMatch, function (results, error) {
        if (error) {
            utilities.printLog(false, "This query generated an error: " + insertMatch);
        } else {
            // update match participans w. new matchId
            for (let i = 0; i < gameRoomData.players.length; i++) {
                if (gameRoomData.players[i].occupiedSlot) {
                    let userId = gameRoomData.players[i].userId !== undefined ? gameRoomData.players[i].userId : ++anonUsers;
                    let winner = gameRoomData.players[i].gameData.match.winner === true ? 1 : 0;
                    let registered = gameRoomData.players[i].userId !== undefined ? 1 : 0;
                    let insertParticipant = "INSERT INTO MatchParticipants (SessionId, MatchId, UserId, Registered, " +
                        "BeginTimestamp, Score, PathLength, TimeMs, Winner) VALUES ("
                        + gameRoomData.sessionId + ", "
                        + results.insertId + ", "
                        + database.sanitize(userId) + ", "
                        + registered + ", "
                        + database.sanitize(dateTimeNow) + ", "
                        + gameRoomData.players[i].gameData.match.points + ", "
                        + gameRoomData.players[i].gameData.match.pathLength + ", "
                        + gameRoomData.players[i].gameData.match.time + ", "
                        + winner + ")";
                    database.query(insertParticipant, function (results, error) {
                        if (error) {
                            utilities.printLog(false, "This query generated an error: " + insertParticipant);
                        }
                    });
                }
            }
        }
    });

    let updateSession = "UPDATE GameSessions SET NumMatches = " + gameRoomData.gameData.matchCount + " "
                      + "WHERE Id = " + gameRoomData.sessionId;
    database.query(updateSession, function (results, error) {
        if (error) {
            utilities.printLog(false, "This query generated an error: " + updateSession);
        }
    });
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
    let totalMatches = "SELECT COUNT(*) + 24000 AS totalMatches FROM GameMatches";
    database.query(totalMatches, function (results, error) {
        let message = {};

        if (error) {
            message = {
                msgType: messageTypes.s_generalInfo,
                totalMatches: 0,
                connectedPlayers: options.getConnectedPlayers(),
                randomWaitingPlayers: options.getRandomWaitingPlayers(),
                requiredClientVersion: utilities.requiredClientVersion
            };
        } else {
            utilities.printLog(false, JSON.stringify(results));
            message = {
                msgType: messageTypes.s_generalInfo,
                totalMatches: results[0].totalMatches,
                connectedPlayers: options.getConnectedPlayers(),
                randomWaitingPlayers: options.getRandomWaitingPlayers(),
                requiredClientVersion: utilities.requiredClientVersion
            };
        }

        if (correlationId === undefined) {
            rabbit.sendInGeneralTopic(message);
        } else {
            rabbit.sendInClientControlQueue(correlationId, message);
        }
    });
};