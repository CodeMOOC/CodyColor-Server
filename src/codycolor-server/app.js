#!/usr/bin/env node

/*
 * app.js: punto di accesso dello script.
 * Tiene traccia dei vari giocatori collegati in multi player, sincronizza le partite e ne memorizza dati persistenti.
 */

let logs = require('./communication/logs');
let broker = require('./communication/broker');
let database = require('./communication/database');
let gameRoomsUtils = require('./gameRooms/gameRoomsUtils');
let randomGameRooms = require('./gameRooms/random');
let customGameRooms = require('./gameRooms/custom');
let royaleGameRooms = require('./gameRooms/royale');
let pjson = require('./package.json');
const requiredClientVersion  = pjson.version.toString();

logs.printProgramHeader();

broker.connect({
    onConnectedSignal: function (message) {
        // un client vuole connettersi al sistema (non a una partita). Restituisce 
        // a questo informazioni aggiornate sullo stato del sistema
        logs.printLog('A new client connected to the broker');
        sendGeneralInfoMessage(message.correlationId);

    }, onSignUpRequest: function(message) {
        // un client, dopo aver ottenuto l'uid da FirebaseAuth e aver scelto un nickname, vuole registrarsi a
        // CodyColor. Crea un record utente nel db e restituisci alcune statistiche utente.
        logs.printLog('A new user is trying to sign in');
        let insertUser =
            "INSERT INTO Users (Id, Email, Nickname, Deleted) " +
            "VALUES (" + database.escape(message.userId)   + ", "
                       + database.escape(message.email)    + ", "
                       + database.escape(message.nickname) + ", "
                       + "0)";

        database.query(insertUser, function (results, error) {
            let response = {
                msgType: broker.messageTypes.s_authResponse,
                success: !error,
                nickname: message.nickname,
                totalPoints: 0,
                wonMatches: 0,
                avgPoints: 0,
                bestMatch: undefined,
                correlationId: message.correlationId
            };

            broker.sendInClientControlQueue(message.correlationId, response);
            logs.printWaiting();
        });

    }, onLogInRequest: function(message) {
        // un client vuole ottenere le informazioni del proprio account memorizzate nel db. Restituiscile
        // in caso l'userId corrisponda
        logs.printLog('A user is trying to log in');
        let searchUser =
            "SELECT Nickname as nickname FROM Users " +
            "WHERE Id = " + database.escape(message.userId) + "; ";

        let userTotalPoints =
            "SELECT SUM(Score) as totalPoints " +
            "FROM MatchParticipants " +
            "WHERE UserId = " + database.escape(message.userId) + " " +
            "GROUP BY UserId; ";

        let userWins =
            "SELECT SUM(Winner) as wonMatches " +
            "FROM MatchParticipants " +
            "WHERE UserId = " + database.escape(message.userId) + " " +
            "GROUP BY UserId; ";

        let userAvgPoints =
            "SELECT AVG(Score) as avgPoints " +
            "FROM MatchParticipants " +
            "WHERE UserId = " + database.escape(message.userId) + " " +
            "GROUP BY UserId; ";


        let bestMatch =
            "SELECT Score AS points, PathLength AS pathLength, TimeMs as time " +
            "FROM MatchParticipants " +
            "WHERE UserId = " + database.escape(message.userId) + " " +
            "ORDER BY points DESC, pathLength DESC, time DESC " +
            "LIMIT 1; ";

        let queries = searchUser + userTotalPoints + userWins + userAvgPoints + bestMatch;

        database.query(queries, function (results, error) {
            let response;
            if (error) {
                response = {
                    msgType: broker.messageTypes.s_authResponse,
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
                    msgType: broker.messageTypes.s_authResponse,
                    success: nicknameValue !== undefined,
                    nickname: nicknameValue,
                    totalPoints: totalPointsValue,
                    wonMatches: wonMatchesValue,
                    avgPoints: avgPointsValue,
                    bestMatch: bestMatchValue,
                    correlationId: message.correlationId
                };
            }

            broker.sendInClientControlQueue(message.correlationId, response);
            logs.printWaiting();
    });



    }, onUserDeleteRequest: function(message) {
        // un utente vuole rimuovere il proprio account. Elimina l'email collegata l'account e imposta
        // l'utente come eliminato
        logs.printLog('A user is trying to delete his account');
        let deleteUser = "UPDATE Users SET Email = '', Deleted = 1 "
                       + "WHERE Id = " + database.escape(message.userId);

        database.query(deleteUser, function (results, error) {
            let response = {
                msgType: broker.messageTypes.s_userDeleteResponse,
                success: error !== undefined,
                correlationId: message.correlationId,
            };
            broker.sendInClientControlQueue(message.correlationId, response);
            logs.printWaiting();
        });

    }, onRankingRequest: function(message) {
        // un client ha richiesto dati relativi alle classifiche. Restituiscili.
        logs.printLog('Received ranking request');
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
                response = {
                    msgType: broker.messageTypes.s_rankingsResponse,
                    success: false,
                    correlationId: message.correlationId,
                };

            } else {
                response = {
                    msgType: broker.messageTypes.s_rankingsResponse,
                    'top10PointsDaily': JSON.stringify(results[0]),
                    'top10PointsGlobal': JSON.stringify(results[1]),
                    'top10MatchDaily': JSON.stringify(results[2]),
                    'top10MatchGlobal': JSON.stringify(results[3]),
                    success: true,
                    correlationId: message.correlationId,
                };
            }

            broker.sendInClientControlQueue(message.correlationId, response);
            logs.printWaiting();
        });

    }, onGameRequest: function (message) {
        // richiesta di nuova partita. Aggiunge un nuovo player nell'array gameRooms;
        // comunica al client playerId e gameRoom assegnatigli; riferisce agli altri client
        // dell'arrivo del nuovo giocatore, se il messaggio comprende opzioni di validazione
        logs.printLog('Received ' + message.general.gameType + ' gameRequest from client');

        let gameRoomHandler = getGameRoomHandler(message.general.gameType);
        let result = gameRoomHandler.handleGameRequest(message);
        sendMessages(result.messages);

        if (result.success) {
            logs.printLog('Client successfully added to ' + message.general.gameType + ' gameRooms ' +
                'array. User params: ' + result.gameRoomId + '[' + result.playerId + ']');
            gameRoomHandler.printGameRooms();
        } else {
            logs.printLog('The request is not valid anymore.');
        }
        logs.printWaiting();

    }, onValidation: function(message) {
        // messaggio di validazione del player: fornisce tutti i dati che permettono di validare il giocatore (solo il
        // nickname, al momento) e comunica agli altri giocatori collegati dell'arrivo del nuovo giocatore.
        // che verranno quindi inoltrati agli altri client
        logs.printLog('Received ' + message.gameType + ' validation request from client' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handleValidation(message);
        sendMessages(result.messages);
        logs.printWaiting();

    }, onPlayerQuit: function (message) {
        // un giocatore avvisa di voler lasciare la partita. Rimuove il giocatore dall'array, e invia un
        // avviso nella game room. Se necessario, invia un comando per forzare l'abbandono del gioco da parte dei
        // giocatori rimasti
        logs.printLog('Received playerQuit request from ' + message.gameType + ' client ' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handlePlayerQuit(message);
        sendMessages(result.messages);

        if (result.success) {
            logs.printLog('User removed from ' + message.gameType + ' game rooms array');
            gameRoomHandler.printGameRooms();
        } else {
            logs.printLog('WARNING: The user is not present in the game room ' +
                '[' + message.gameRoomId + ']');
        }
        logs.printWaiting();

    }, onHeartbeat: function (message) {
        // ricevuto un heartbeat dal client. Se il server non riceve heartbeat da un client per più
        // di 10 secondi, lo rimuove dal gioco e notifica la game room
        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handleHeartbeat(message);

        // messaggio di force quit, in caso di heartbeat invalido
        sendMessages(result.messages);

        if (!result.success) {
            logs.printLog('Received invalid heartbeat. Trying to disconnect the user');
            logs.printWaiting();
        }

    }, onReady: function(message) {
        // il segnale di Ready è utilizzato in varie modalità per stabilire se è il momento di iniziare la partita.
        // eventualmente, viene inviato il messaggio di startMatch
        logs.printLog('Received ready message from ' + message.gameType + ' client ' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handleReadyMessage(message);
        sendMessages(result.messages);

        logs.printWaiting();

    }, onPositioned: function(message) {
        // il segnale di Positioned permette di stabilire se il giocatore ha posizionato il proprio roby. Se necessario,
        // invia il messaggio di startAnimation
        logs.printLog('Received positioned message from ' + message.gameType + ' client ' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handlePositionedMessage(message);
        sendMessages(result.messages);

        logs.printWaiting();

    }, onEndAnimation: function(message) {
        // il segnale di EndAnimation segnala che il giocatore ha concluso l'animazione finale, o ha premuto il segnale
        // di skip. Una volta ricevuto da tutti, invia il segnale di endMatch
        logs.printLog('Received endAnimation message from ' + message.gameType + ' client ' +
            + message.gameRoomId + '[' + message.playerId + ']');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handleEndAnimationMessage(message);
        sendMessages(result.messages);

        logs.printWaiting();
    }
});

// limitatore dei messaggi su general topic in uscita
let gInfoLimiter = false;
let gInfoQueued = false;

// imposta callback utilizzati dalle game rooms
gameRoomCallbacks = {
    onGameRoomsUpdated: function () {
        // callback invocato ogniqualvolta viene aggiunto o rimosso un giocatore a una gameRoom.
        // Invia un messaggio generalInfo al topic general, cosi' da aggiornare in particolare i client sul
        // numero di giocatori collegati al momento
        if (gInfoLimiter) {
            gInfoQueued = true;

        } else {
            gInfoLimiter = true;
            sendGeneralInfoMessage();
            setTimeout(function () {
                if (gInfoQueued)
                    sendGeneralInfoMessage();
                gInfoLimiter = false;
                gInfoQueued = false;
            }, 1000);
        }

    }, onHeartbeatExpired: function (gameRoomId, playerId, gameType) {
        // allo scadere del timer di heartbeat, elimina il giocatore dalla game room
        logs.printLog('Heartbeat timer of ' + gameRoomId + '[' + playerId + '] in ' + gameType
            + ' game rooms expired');

        let gameRoomHandler = getGameRoomHandler(gameType);
        let result = gameRoomHandler.handlePlayerQuit({
            gameRoomId: gameRoomId,
            playerId: playerId
        });

        sendMessages(result.messages);

        if (result.success) {
            logs.printLog('User removed from ' + gameType + ' game rooms array');
            gameRoomHandler.printGameRooms();
        } else {
            logs.printLog('WARNING: The user is not present in the game room ' +
                '[' + gameType + ']');
        }
        logs.printWaiting();
        
    }, createDbGameSession: function (gameRoomData) {
        // crea una gameSession nel db. Invocato nel momento in cui viene concluso il matchmaking di una gameRoom
        let insertSession = "INSERT INTO GameSessions (NumMatches, Type, MatchDurationMs, BeginTimestamp) "
            + "VALUES (0, "
            + database.escape(gameRoomData.gameData.gameType) + ", "
            + gameRoomData.gameData.timerSetting + ", "
            + database.escape(new Date()) + ")";

        database.query(insertSession, function (results, error) {
            if (!error) {
                gameRoomData.sessionId = results.insertId;
            }
            logs.printWaiting();
        });
        
    }, createDbGameMatch: function (gameRoomData) {
        // crea un match nel db. Invocato nel momento in cui viene avviato un match
        let dateTimeNow = new Date();
        let numPlayers = 0;
        let anonUsers = 0;

        let updateSession = "UPDATE GameSessions SET NumMatches = " + gameRoomData.gameData.matchCount + " "
            + "WHERE Id = " + gameRoomData.sessionId;
        database.query(updateSession);

        for (let i = 0; i < gameRoomData.players.length; i++) {
            if(gameRoomData.players[i].occupiedSlot) {
                numPlayers++;
            }
        }

        let insertMatch = "INSERT INTO GameMatches (SessionId, BeginTimestamp, NumUsers) "
            + "VALUES ("
            + gameRoomData.sessionId + ", "
            + database.escape(dateTimeNow) + ", "
            + numPlayers + ")";

        database.query(insertMatch, function (results, error) {
            if (!error) {
                // update match participants w. new matchId
                let insertAllParticipants = '';
                for (let i = 0; i < gameRoomData.players.length; i++) {
                    if (gameRoomData.players[i].occupiedSlot) {
                        let userId = gameRoomData.players[i].userId !== undefined ? gameRoomData.players[i].userId : ++anonUsers;
                        let winner = gameRoomData.players[i].gameData.match.winner === true ? 1 : 0;
                        let registered = gameRoomData.players[i].userId !== undefined ? 1 : 0;
                        insertAllParticipants += "INSERT INTO MatchParticipants (SessionId, MatchId, UserId, Registered, " +
                            "BeginTimestamp, Score, PathLength, TimeMs, Winner) VALUES ("
                            + gameRoomData.sessionId + ", "
                            + results.insertId + ", "
                            + database.escape(userId) + ", "
                            + registered + ", "
                            + database.escape(dateTimeNow) + ", "
                            + gameRoomData.players[i].gameData.match.points + ", "
                            + gameRoomData.players[i].gameData.match.pathLength + ", "
                            + gameRoomData.players[i].gameData.match.time + ", "
                            + winner + "); ";
                    }
                }
                if (insertAllParticipants !== '') {
                    database.query(insertAllParticipants, function () {
                        logs.printWaiting();
                    });
                }
            }
        });
    }, onStartTimerExpired: function (gameRoomId) {
        logs.printLog("Start timer of royale game room expired");
        let result = royaleGameRooms.directStartMatch(gameRoomId);
        sendMessages(result.messages);
        logs.printWaiting();
    }
};

randomGameRooms.setCallbacks(gameRoomCallbacks);
customGameRooms.setCallbacks(gameRoomCallbacks);
royaleGameRooms.setCallbacks(gameRoomCallbacks);


let getGameRoomHandler = function(gameType) {
    switch (gameType) {
        case gameRoomsUtils.gameTypes.custom: {
            return customGameRooms;
        }
        case gameRoomsUtils.gameTypes.royale: {
            return royaleGameRooms;
        }
        default: {
            return randomGameRooms;
        }
    }
};


let sendMessages = function(messages) {
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].correlationId === undefined)
            broker.sendInGameRoomTopic(messages[i]);
        else
            broker.sendInClientControlQueue(messages[i].correlationId, messages[i]);
    }
};


let sendGeneralInfoMessage = function (correlationId) {
    // il conteggio inizia da 24000 partite, valore del contatore match prima dell'implementazione della nuova
    // versione del server
    let totalMatches = "SELECT COUNT(*) + 24000 AS totalMatches FROM GameMatches";
    database.query(totalMatches, function (results, error) {
        let message = {};

        let connectedPlayers = randomGameRooms.getConnectedPlayers() + customGameRooms.getConnectedPlayers()
            + royaleGameRooms.getConnectedPlayers();

        if (error) {
            message = {
                msgType: broker.messageTypes.s_generalInfo,
                totalMatches: 0,
                connectedPlayers: connectedPlayers,
                correlationId: correlationId,
                randomWaitingPlayers: randomGameRooms.getWaitingPlayers(),
                requiredClientVersion: requiredClientVersion
            };
        } else {
            message = {
                msgType: broker.messageTypes.s_generalInfo,
                totalMatches: results[0].totalMatches,
                connectedPlayers: connectedPlayers,
                correlationId: correlationId,
                randomWaitingPlayers: randomGameRooms.getWaitingPlayers(),
                requiredClientVersion: requiredClientVersion
            };
        }

        if (message.correlationId === undefined)
            broker.sendInGeneralTopic(message);
        else
            broker.sendInClientControlQueue(message.correlationId, message);

        logs.printWaiting();
    });
};