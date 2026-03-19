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
let versions = require('./versions');

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

        if(message.wallUser) {
            let insertUser = "INSERT INTO WallUsers (Id, Name, Surname, Deleted) " +
            "VALUES (" + database.escape(message.userId) + ", "
            + database.escape(message.name) + ", "
            + database.escape(message.surname) + ", "
            + "0)";

            database.query(insertUser, function (results, error) {
                let response = {
                    msgType: broker.messageTypes.s_authResponse,
                    success: !error,
                    name: message.name,
                    surname: message.surname,
                    playerMatches: 0,
                    bestMatchBot: undefined,
                    bestMatchHuman: undefined,
                    correlationId: message.correlationId
                };

                broker.sendInClientControlQueue(message.correlationId, response);
                logs.printWaiting();
            });

        } else {
            let insertUser = "INSERT INTO Users (Id, Email, Nickname, Deleted) " +
                "VALUES (" + database.escape(message.userId) + ", "
                + database.escape(message.email) + ", "
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
        }



    }, onLogInRequest: function(message) {
        // un client vuole ottenere le informazioni del proprio account memorizzate nel db. Restituiscile
        // in caso l'userId corrisponda
        logs.printLog('A user is trying to log in');

        if (message.wallUser) {
            let searchUser =
                "SELECT Name as name, Surname as surname FROM WallUsers " +
                "WHERE Id = " + database.escape(message.userId) + "; ";

            let userTotalMatches =
                "SELECT COUNT(DISTINCT MatchId) as playerMatches " +
                "FROM MatchParticipants " +
                "WHERE UserId = " + database.escape(message.userId) + " AND IsWallUser = 1 ";

            let bestMatchBot =
                "SELECT Score AS points, PathLength AS pathLength, TimeMs as time " +
                "FROM MatchParticipants " +
                "WHERE UserId = " + database.escape(message.userId) + " AND IsWallUser = 1 " +
                "ORDER BY points DESC, pathLength DESC, time DESC " +
                "LIMIT 1; ";

            let bestMatchHuman =
                "SELECT MP1.Score AS points, MP1.PathLength AS pathLength, MP1.TimeMs as time " +
                "FROM MatchParticipants MP1 " +
                "WHERE MP1.MatchId IN (SELECT MatchId " +
                "                  FROM MatchParticipants MP2 " +
                "                  WHERE MP2.UserId = " + database.escape(message.userId) + " AND MP2.IsWallUser = 1) " +
                "AND MP1.IsWallUser = 0 " +
                "ORDER BY points DESC, pathLength DESC, time DESC " +
                "LIMIT 1; ";

            let queries = searchUser + userTotalMatches + bestMatchBot + bestMatchHuman;

            database.query(queries, function (results, error) {
                let response;
                if (error) {
                    response = {
                        msgType: broker.messageTypes.s_authResponse,
                        success: false,
                        correlationId: message.correlationId
                    };
                } else {
                    let nameValue = undefined;
                    if (results[0] !== undefined
                        && results[0][0] !== undefined
                        && results[0][0].name !== undefined) {
                        nameValue = results[0][0].name;
                    }

                    let surnameValue = undefined;
                    if (results[0] !== undefined
                        && results[0][0] !== undefined
                        && results[0][0].surname !== undefined) {
                        surnameValue = results[0][0].surname;
                    }

                    let playerMatchesValue = 0;
                    if (results[1] !== undefined
                        && results[1][0] !== undefined
                        && results[1][0].playerMatches !== undefined) {
                        playerMatchesValue = results[1][0].playerMatches;
                    }

                    let bestMatchBotValue = undefined;
                    if (results[2] !== undefined
                        && results[2][0] !== undefined) {
                        bestMatchBotValue = results[2][0];
                    }

                    let bestMatchHumanValue = undefined;
                    if (results[3] !== undefined
                        && results[3][0] !== undefined) {
                        bestMatchHumanValue = results[3][0];
                    }

                    response = {
                        msgType: broker.messageTypes.s_authResponse,
                        success: nameValue !== undefined,
                        name: nameValue,
                        surname: surnameValue,
                        playerMatches: playerMatchesValue,
                        bestMatchBot: bestMatchBotValue,
                        bestMatchHuman: bestMatchHumanValue,
                        correlationId: message.correlationId
                    };
                }

                broker.sendInClientControlQueue(message.correlationId, response);
                logs.printWaiting();
            });
        } else {
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

            let userTotalMatches =
                "SELECT COUNT(DISTINCT MatchId) as totalMatches " +
                "FROM MatchParticipants " +
                "WHERE UserId = " + database.escape(message.userId) + "; ";

            let queries = searchUser + userTotalPoints + userWins + userAvgPoints + bestMatch + userTotalMatches;

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
                        totalMatches: results[5] && results[5][0] !== undefined ? results[5][0].totalMatches : 0,
                        correlationId: message.correlationId
                    };
                }

                broker.sendInClientControlQueue(message.correlationId, response);
                logs.printWaiting();
            });
        }
    },
    // To implement in the future, if we want to separate login and stats
    toImplementOnLogInRequest: function (message) {
        logs.printLog('A user is trying to log in');
    
        let searchUser;
    
        if (message.wallUser) {
            searchUser =
                "SELECT Name AS name, Surname AS surname " +
                "FROM WallUsers " +
                "WHERE Id = " + database.escape(message.userId) + "; ";
        } else {
            searchUser =
                "SELECT Nickname AS nickname " +
                "FROM Users " +
                "WHERE Id = " + database.escape(message.userId) + "; ";
        }
    
        database.query(searchUser, function (results, error) {
            let response;
    
            if (error) {
                response = {
                    msgType: broker.messageTypes.s_authResponse,
                    success: false,
                    correlationId: message.correlationId
                };
            } else {
                if (message.wallUser) {
                    let row = results[0] && results[0][0];
    
                    response = {
                        msgType: broker.messageTypes.s_authResponse,
                        success: !!row,
                        name: row ? row.name : undefined,
                        surname: row ? row.surname : undefined,
                        correlationId: message.correlationId
                    };
                } else {
                    let row = results[0] && results[0][0];
    
                    response = {
                        msgType: broker.messageTypes.s_authResponse,
                        success: !!row,
                        nickname: row ? row.nickname : undefined,
                        correlationId: message.correlationId
                    };
                }
            }
    
            broker.sendInClientControlQueue(message.correlationId, response);
            logs.printWaiting();
        });
    },
    // To implement in the future, if we want to separate login and stats
    onGetUserStatsRequest: function (message) {
        logs.printLog('User requested statistics');
    
        let queries = "";
    
        if (message.wallUser) {
    
            let userTotalMatches =
                "SELECT COUNT(DISTINCT MatchId) AS playerMatches " +
                "FROM MatchParticipants " +
                "WHERE UserId = " + database.escape(message.userId) + " AND IsWallUser = 1; ";
    
            let bestMatchBot =
                "SELECT Score AS points, PathLength AS pathLength, TimeMs AS time " +
                "FROM MatchParticipants " +
                "WHERE UserId = " + database.escape(message.userId) + " AND IsWallUser = 1 " +
                "ORDER BY points DESC, pathLength DESC, time DESC " +
                "LIMIT 1; ";
    
            let bestMatchHuman =
                "SELECT MP1.Score AS points, MP1.PathLength AS pathLength, MP1.TimeMs AS time " +
                "FROM MatchParticipants MP1 " +
                "WHERE MP1.MatchId IN ( " +
                "   SELECT MatchId FROM MatchParticipants MP2 " +
                "   WHERE MP2.UserId = " + database.escape(message.userId) + " AND MP2.IsWallUser = 1 " +
                ") AND MP1.IsWallUser = 0 " +
                "ORDER BY points DESC, pathLength DESC, time DESC " +
                "LIMIT 1; ";
    
            queries = userTotalMatches + bestMatchBot + bestMatchHuman;
    
        } else {
    
            let userTotalMatches =
                "SELECT COUNT(DISTINCT MatchId) AS totalMatches " +
                "FROM MatchParticipants " +
                "WHERE UserId = " + database.escape(message.userId) + "; ";
    
            let userTotalPoints =
                "SELECT SUM(Score) AS totalPoints " +
                "FROM MatchParticipants " +
                "WHERE UserId = " + database.escape(message.userId) + "; ";
    
            let userWins =
                "SELECT SUM(Winner) AS wonMatches " +
                "FROM MatchParticipants " +
                "WHERE UserId = " + database.escape(message.userId) + "; ";
    
            let userAvgPoints =
                "SELECT AVG(Score) AS avgPoints " +
                "FROM MatchParticipants " +
                "WHERE UserId = " + database.escape(message.userId) + "; ";
    
            let bestMatch =
                "SELECT Score AS points, PathLength AS pathLength, TimeMs AS time " +
                "FROM MatchParticipants " +
                "WHERE UserId = " + database.escape(message.userId) + " " +
                "ORDER BY points DESC, pathLength DESC, time DESC " +
                "LIMIT 1; ";
    
            queries =
                userTotalMatches +
                userTotalPoints +
                userWins +
                userAvgPoints +
                bestMatch;
        }
    
        database.query(queries, function (results, error) {
            let response;
    
            if (error) {
                response = {
                    msgType: broker.messageTypes.s_getUserStatsResponse,
                    success: false,
                    correlationId: message.correlationId
                };
            } else {
                if (message.wallUser) {
                    var playerMatches = 0;
                    if (results[0] && results[0][0] && results[0][0].playerMatches) {
                        playerMatches = results[0][0].playerMatches;
                    }

                    var bestMatchBot = undefined;
                    if (results[1] && results[1][0]) {
                        bestMatchBot = results[1][0];
                    }

                    var bestMatchHuman = undefined;
                    if (results[2] && results[2][0]) {
                        bestMatchHuman = results[2][0];
                    }

                    response = {
                        msgType: broker.messageTypes.s_getUserStatsResponse,
                        success: true,
                        playerMatches: playerMatches,
                        bestMatchBot: bestMatchBot,
                        bestMatchHuman: bestMatchHuman,
                        correlationId: message.correlationId
                    };
                    
                } else {
                    var totalMatches = 0;
                    if (results[0] && results[0][0] && results[0][0].totalMatches) {
                        totalMatches = results[0][0].totalMatches;
                    }
                    
                    var totalPoints = 0;
                    if (results[1] && results[1][0] && results[1][0].totalPoints) {
                        totalPoints = results[1][0].totalPoints;
                    }
                    
                    var wonMatches = 0;
                    if (results[2] && results[2][0] && results[2][0].wonMatches) {
                        wonMatches = results[2][0].wonMatches;
                    }
                    
                    var avgPoints = 0;
                    if (results[3] && results[3][0] && results[3][0].avgPoints) {
                        avgPoints = results[3][0].avgPoints;
                    }
                    
                    var bestMatch = undefined;
                    if (results[4] && results[4][0]) {
                        bestMatch = results[4][0];
                    }
                    
                    response = {
                        msgType: broker.messageTypes.s_getUserStatsResponse,
                        success: true,
                        totalMatches: totalMatches,
                        totalPoints: totalPoints,
                        wonMatches: wonMatches,
                        avgPoints: avgPoints,
                        bestMatch: bestMatch,
                        correlationId: message.correlationId
                    };
                }
            }
    
            broker.sendInClientControlQueue(message.correlationId, response);
            logs.printWaiting();
        });
    },
    onEditNicknameRequest: function(message) {
        // message.userId: ID dell'utente
        // message.newNickname: nuovo nickname scelto
        logs.printLog('User ' + message.userId + ' is trying to edit nickname to ' + message.newNickname);
    
        const escapedNickname = database.escape(message.newNickname);
        const escapedUserId = database.escape(message.userId);
    
        const updateQuery = "UPDATE Users SET Nickname = " + escapedNickname + " WHERE Id = " + escapedUserId;
    
        database.query(updateQuery, function(results, error) {
            let response;
            if (error) {
                logs.printLog('Error updating nickname for user ' + message.userId + ': ' + error);
                response = {
                    msgType: broker.messageTypes.s_editNicknameResponse,
                    success: false,
                    correlationId: message.correlationId
                };
            } else {
                logs.printLog('Nickname updated successfully for user ' + message.userId);
                response = {
                    msgType: broker.messageTypes.s_editNicknameResponse,
                    success: true,
                    newNickname: message.newNickname,
                    correlationId: message.correlationId
                };
            }
            broker.sendInClientControlQueue(message.correlationId, response);
            logs.printWaiting();
        });
    },
    onUserDeleteRequest: function(message) {
        // un utente vuole rimuovere il proprio account. Elimina l'email collegata l'account e imposta
        // l'utente come eliminato
        logs.printLog('A user is trying to delete his account');

        if (message.wallUser) {
            let deleteUser = "UPDATE WallUsers SET Name = '', Surname = '', Deleted = 1 "
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

        } else {
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
        }

    }, onRankingRequest: function(message) {
        // un client ha richiesto dati relativi alle classifiche. Restituiscili.
        logs.printLog('Received ranking request');

        const minDate = "2020-01-01 00:00:00";

        // Check if a userId exists in the message
        let hasUser =
            message.userId !== undefined &&
            message.userId !== null &&
            message.userId !== "";
        // Escape or sanitize userId if it exists
        let escapedUserId = hasUser ? database.escape(message.userId) : null;

        // Restituisce la top 10 dei giocatori registrati di oggi, ordinata per: 
        // Punti totali accumulati oggi
        // Numero di partite vinte (come criterio di spareggio
        let top10PointsDaily =
            "SELECT U.Nickname AS nickname, SUM(MP.Score) AS points, SUM(MP.Winner) AS wonMatches " +
            "FROM Users U INNER JOIN MatchParticipants MP " +
            "ON U.Id = MP.UserId " +
            "WHERE MP.Registered = 1 AND DATE(MP.BeginTimestamp) = CURDATE() " +
            "GROUP BY U.Id " +
            "ORDER BY points DESC, wonMatches DESC " +
            "LIMIT 10; ";

        // Top 10 globale (da una data minima in poi) basata su
        // Punti totali accumulati
        // Partite vinte
        let top10PointsGlobal =
            "SELECT U.Nickname AS nickname, SUM(MP.Score) AS points, SUM(MP.Winner) AS wonMatches " +
            "FROM Users U INNER JOIN MatchParticipants MP " +
            "ON U.Id = MP.UserId " +
            "WHERE MP.Registered = 1 AND MP.BeginTimestamp >= '2019-12-19 00:00:00' " +
            "GROUP BY U.Id " +
            "ORDER BY points DESC, wonMatches DESC " +
            "LIMIT 10; ";
            
        // Top 10 migliori singole partite di oggi
        let top10MatchDaily =
                `SELECT
                CASE WHEN MP.Nickname IS NOT NULL AND MP.Nickname <> '' THEN MP.Nickname
                   ELSE CONCAT('Player_', MP.Ordinal)
                END AS nickname,
                MP.Score AS points,
                MP.PathLength AS pathLength,
                MP.TimeMs AS time
                FROM MatchParticipants MP
                LEFT JOIN Users U ON U.Id = MP.UserId
                WHERE DATE(MP.BeginTimestamp) = CURDATE()
                ORDER BY points DESC, pathLength DESC, time DESC
                LIMIT 10;`

        // Restituisce la top 10 delle migliori partite globali, includendo:
        // utenti registrati
        // utenti anonimi
        let top10MatchGlobal =
            `SELECT 
            CASE WHEN MP.Nickname IS NOT NULL AND MP.Nickname <> '' THEN MP.Nickname
               ELSE CONCAT('Player_', MP.Ordinal)
            END AS nickname,
            MP.Score AS points,
            MP.PathLength AS pathLength,
            MP.TimeMs AS time
            FROM MatchParticipants MP
            LEFT JOIN Users U ON U.Id = MP.UserId
            WHERE MP.BeginTimestamp >= '${minDate}'
            ORDER BY points DESC, pathLength DESC, time ASC
            LIMIT 10;`


       
  
        let myGlobalPointsStats = hasUser ? 
                `SELECT 
                COALESCE(SUM(Score), 0) AS points, 
                COALESCE(SUM(Winner), 0) AS wonMatches
                FROM MatchParticipants
                WHERE Registered = 1
                AND UserId = ${escapedUserId}
                AND BeginTimestamp >= '${minDate}';` 
                : "";

        let myGlobalPointsRank = hasUser 
                ? `SELECT 1 + COUNT(*) AS position
                FROM (
                 SELECT U.Id, COALESCE(SUM(Score), 0) AS points, COALESCE(SUM(Winner), 0) AS wonMatches
                 FROM Users U
                 JOIN MatchParticipants MP ON U.Id = MP.UserId
                 WHERE MP.Registered = 1 AND MP.BeginTimestamp >= '${minDate}'
                 GROUP BY U.Id
                ) ranked
                WHERE points > (SELECT COALESCE(SUM(Score), 0) 
                FROM MatchParticipants 
                WHERE Registered = 1 AND UserId = ${escapedUserId} AND BeginTimestamp >= '${minDate}')
                OR (points = (
                SELECT COALESCE(SUM(Score), 0)
                FROM MatchParticipants
                WHERE Registered = 1
                AND UserId = ${escapedUserId}
                AND BeginTimestamp >= '${minDate}'
                )
                AND wonMatches > (
                SELECT COALESCE(SUM(Winner), 0)
                FROM MatchParticipants
                WHERE Registered = 1
                AND UserId = ${escapedUserId}
                AND BeginTimestamp >= '${minDate}'
                )
            );`
            :  "";
                

        let myBestGlobalMatch = hasUser
                ? `SELECT MP.Score AS points,
                          MP.PathLength AS pathLength,
                          MP.TimeMs AS time
                   FROM MatchParticipants MP
                   WHERE MP.Registered = 1
                   AND MP.UserId = ${escapedUserId}
                   AND MP.BeginTimestamp >= '${minDate}'
                   ORDER BY MP.Score DESC, MP.PathLength DESC, MP.TimeMs DESC
                   LIMIT 1;`
                : "";

        let myGlobalMatchRank = hasUser
                ? `SELECT 1 + COUNT(*) AS position
                   FROM MatchParticipants MP
                   JOIN (
                        SELECT Score, PathLength, TimeMs
                        FROM MatchParticipants
                        WHERE Registered = 1
                        AND UserId = ${escapedUserId}
                        AND BeginTimestamp >= '${minDate}'
                        ORDER BY Score DESC, PathLength DESC, TimeMs DESC
                        LIMIT 1
                   ) AS myBest
                   WHERE MP.Registered = 1
                   AND MP.BeginTimestamp >= '${minDate}'
                   AND (
                        MP.Score > myBest.Score
                        OR (
                            MP.Score = myBest.Score
                            AND MP.PathLength > myBest.PathLength
                        )
                        OR (
                            MP.Score = myBest.Score
                            AND MP.PathLength = myBest.PathLength
                            AND MP.TimeMs > myBest.TimeMs
                        )
                   );`
                : "";

        let queries =
                    top10PointsDaily +
                    top10PointsGlobal +
                    top10MatchDaily +
                    top10MatchGlobal +
                    myGlobalPointsStats +
                    myGlobalPointsRank +
                    myBestGlobalMatch +
                    myGlobalMatchRank;

        database.query(queries, function (results, error) {
            let response = {};
            if (error) {
                response = {
                    msgType: broker.messageTypes.s_rankingsResponse,
                    success: false,
                    correlationId: message.correlationId,
                };

            } else {
                const myGlobalPointsStats =
                results[4] && results[4][0] !== undefined ? results[4][0] : null;
              
              const myGlobalPointsRankRaw =
                results[5] && results[5][0] !== undefined ? results[5][0] : null;
              
              const myBestGlobalMatch =
                results[6] && results[6][0] !== undefined ? results[6][0] : null;
              
              const myGlobalMatchRankRaw =
                results[7] && results[7][0] !== undefined ? results[7][0] : null;
              
                response = {
                    msgType: broker.messageTypes.s_rankingsResponse,
                    'top10PointsDaily': JSON.stringify(results[0]),
                    'top10PointsGlobal': JSON.stringify(results[1]),
                    'top10MatchDaily': JSON.stringify(results[2]),
                    'top10MatchGlobal': JSON.stringify(results[3]),
                    
                    myGlobalPointsRank: myGlobalPointsStats && myGlobalPointsRankRaw
                        ? {
                            position: myGlobalPointsRankRaw.position,
                            points: myGlobalPointsStats.points,
                            wonMatches: myGlobalPointsStats.wonMatches,
                            inTop10: results[1].some(
                                p => p.nickname === message.nickname
                            )
                        }
                        : null,
            
                    myGlobalMatchRank: myBestGlobalMatch && myGlobalMatchRankRaw
                        ? {
                            position: myGlobalMatchRankRaw.position,
                            points: myBestGlobalMatch.points,
                            pathLength: myBestGlobalMatch.pathLength,
                            time: myBestGlobalMatch.time,
                            inTop10: results[3].some(
                                m => m.nickname === message.nickname
                            )
                        }
                        : null,
            
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
        logs.printLog('Received ' + message.gameType + ' gameRequest from client');

        let gameRoomHandler = getGameRoomHandler(message.gameType);
        let result = gameRoomHandler.handleGameRequest(message);
        sendMessages(result.messages);

        if (result.success) {
            logs.printLog('Client successfully added to ' + message.gameType + ' gameRooms ' +
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
        let insertSession =  "INSERT INTO GameSessions (NumMatches, Type, MatchDurationMs, BeginTimestamp) "
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
                        let userId = gameRoomData.players[i].userId !== undefined ? database.escape(gameRoomData.players[i].userId) : null;

                        let ordinal = ++anonUsers;

                        let winner = gameRoomData.players[i].gameData.match.winner === true ? 1 : 0;
                        let registered = gameRoomData.players[i].userId !== undefined ? 1 : 0;
                        let isWallUser = (gameRoomData.players[i].gameData.organizer && gameRoomData.isWall) ? 1 : 0;

                        insertAllParticipants +=
                            "INSERT INTO MatchParticipants " +
                            "(SessionId, MatchId, UserId, Ordinal, Nickname, Registered, IsWallUser, BeginTimestamp, Score, PathLength, TimeMs, Winner) " +
                            "VALUES (" +
                            gameRoomData.sessionId + ", " +
                            results.insertId + ", " +
                            userId + ", " +
                            ordinal + ", " +
                            database.escape(gameRoomData.players[i].gameData.nickname) + ", " +
                            registered + ", " +
                            isWallUser + ", " +
                            database.escape(dateTimeNow) + ", " +
                            gameRoomData.players[i].gameData.match.points + ", " +
                            gameRoomData.players[i].gameData.match.pathLength + ", " +
                            gameRoomData.players[i].gameData.match.time + ", " +
                            winner +
                            ");";
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
                requiredClientVersion: versions.requiredClient,
                requiredWallVersion: versions.requiredWall
            };
        } else {
            message = {
                msgType: broker.messageTypes.s_generalInfo,
                totalMatches: results[0].totalMatches,
                connectedPlayers: connectedPlayers,
                correlationId: correlationId,
                randomWaitingPlayers: randomGameRooms.getWaitingPlayers(),
                requiredClientVersion: versions.requiredClient,
                requiredWallVersion: versions.requiredWall
            };
        }

        if (message.correlationId === undefined)
            broker.sendInGeneralTopic(message);
        else
            broker.sendInClientControlQueue(message.correlationId, message);

        logs.printWaiting();
    });
};