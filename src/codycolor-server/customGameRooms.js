/*
 * customGameRooms.js: file per la gestione dell'array gameRoom ad accoppiamento personalizzato dei giocatori. Espone metodi
 * per l'aggiunta e la rimozione dei giocatori, oltre a metodi per recuperare informazioni sullo stato delle game room.
 */
(function () {
    // imports
    let utilities = require("./utilities");

    // array game room
    let customGameRooms = [];

    // callbacks utilizzati dal modulo
    let callbacks = {};


    // inizializza i callbacks utilizzati dal modulo
    module.exports.setCallbacks = function(onGameRoomsUpdated, onHeartbeatExpired) {
      callbacks.onGameRoomsUpdated = onGameRoomsUpdated;
      callbacks.onHeartbeatExpired = onHeartbeatExpired;
    };


    // fornisce il conteggio complessivo dei giocatori attivi sulle game room ad accoppiamento casuale
    module.exports.getConnectedPlayers = function() {
        let connectedPlayers = 0;
        for (let i = 0; i < customGameRooms.length; i++) {
            if (customGameRooms[i][0].occupiedSlot)
                connectedPlayers++;
            if (customGameRooms[i][1].occupiedSlot)
                connectedPlayers++;
        }
        return connectedPlayers;
    };


    // stampa a console le gameRoom attive ad accoppiamento personalizzato
    module.exports.printGameRooms = function() {
        utilities.printLog(false, 'New custom game room configuration:');

        if (customGameRooms.length <= 0) {
            utilities.printLog(false, 'empty');

        } else {
            let gameRoomString = '';
            for (let i = 0; i < customGameRooms.length; i++) {
                let firstSlot = (customGameRooms[i][0].occupiedSlot ? 'x' : 'o');
                let secondSlot = (customGameRooms[i][1].occupiedSlot ? 'x' : 'o');
                gameRoomString += i.toString() + '[' + firstSlot + ',' + secondSlot + '] ';
                if (i % 4 === 0 && i !== 0) {
                    utilities.printLog(false, gameRoomString);
                    gameRoomString = '';
                }
            }
            if (gameRoomString !== '')
                utilities.printLog(false, gameRoomString);
        }
    };


    // verifica se i dati del giocatore sono validi
    module.exports.isPlayerDataValid = function(gameRoomId, playerId) {
        return gameRoomId !== -1
            && playerId !== -1
            && customGameRooms.length !== 0
            && gameRoomId <= customGameRooms.length
            && customGameRooms[gameRoomId] !== undefined
            && customGameRooms[gameRoomId][playerId] !== undefined;
    };


    // aggiunge un riferimento all'utente nel primo slot valido.
    // Ritorna un oggetto contenente gameRoom e playerId assegnati al richiedente.
    // L'eventuale callback passato viene eseguito non appena le gameRoom vengono aggiornate
    module.exports.addUserToGameRoom = function(fromInvitation, invitationCode) {
        let gameRoomsCount = customGameRooms.length;

        if (fromInvitation === undefined || !fromInvitation) {
            if (gameRoomsCount > 0) {
                // cerca la prima gameRoom libera
                for (let gRoomIndex = 0; gRoomIndex < customGameRooms.length; gRoomIndex++) {
                    if (!customGameRooms[gRoomIndex][0].occupiedSlot && !customGameRooms[gRoomIndex][1].occupiedSlot) {
                        // occupa il primo slot
                        customGameRooms[gRoomIndex][0] = generateOccupiedSlot(gRoomIndex, 0,
                                                                              customGameRooms[gRoomIndex][0].code);

                        callbacks.onGameRoomsUpdated();
                        return { gameRoomId: gRoomIndex, playerId: 0, code: customGameRooms[gRoomIndex][0].code };
                    }
                }

                // non c'è uno slot libero: crea una nuova gameRoom e piazza l'utente nel primo slot
                let uniqueCode = createUniqueCode();
                customGameRooms.push([generateOccupiedSlot(gameRoomsCount, 0, uniqueCode),
                    generateFreeSlot(uniqueCode)]);

                callbacks.onGameRoomsUpdated();
                return { gameRoomId: gameRoomsCount, playerId: 0, code: uniqueCode };

            } else {
                // deve essere creata la prima gameRoom: crea la gameRoom e piazza l'utente nel primo slot
                let uniqueCode = createUniqueCode();
                customGameRooms.push([generateOccupiedSlot(0, 0, uniqueCode),
                    generateFreeSlot(uniqueCode)]);

                callbacks.onGameRoomsUpdated();
                return { gameRoomId: 0, playerId: 0, code: uniqueCode };
            }

        } else {
            // si è stati invitati: cerca la gameRoom che ha proposto la partita
            for (let gRoomIndex = 0; gRoomIndex < customGameRooms.length; gRoomIndex++) {
                if (customGameRooms[gRoomIndex][1].code.toString() === invitationCode.toString()
                    && !customGameRooms[gRoomIndex][1].occupiedSlot
                    &&  customGameRooms[gRoomIndex][0].occupiedSlot) {
                    // occupa lo slot e restituisci i dati utente
                    customGameRooms[gRoomIndex][1] = generateOccupiedSlot(gRoomIndex, 1,
                                                                          invitationCode.toString());

                    callbacks.onGameRoomsUpdated();
                    return { gameRoomId: gRoomIndex, playerId: 1, code: invitationCode };
                }
            }

            // il codice non è più valido: ritorna un oggetto nullo
            callbacks.onGameRoomsUpdated();
            return undefined;
        }
    };


    // rimuove un utente dalla propria gameRoom
    module.exports.removeUserFromGameRoom = function(gameRoomId, playerId) {
        if (customGameRooms[gameRoomId][playerId] !== undefined) {
            // clear slot
            let code = customGameRooms[gameRoomId][playerId].code;
            clearTimeout(customGameRooms[gameRoomId][playerId].heartBeatTimer);
            customGameRooms[gameRoomId][playerId] = generateFreeSlot(code);

            // set new code
            if (!customGameRooms[gameRoomId][0].occupiedSlot
                && !customGameRooms[gameRoomId][1].occupiedSlot) {
                let newCode = createUniqueCode();
                customGameRooms[gameRoomId][0].code = newCode;
                customGameRooms[gameRoomId][1].code = newCode;
            }

            // rimuove le eventuali gameRoom vuote
            for (let gRoomIndex = customGameRooms.length - 1; gRoomIndex >= 0; gRoomIndex--) {
                if (!customGameRooms[gRoomIndex][0].occupiedSlot && !customGameRooms[gRoomIndex][1].occupiedSlot)
                    customGameRooms.splice(gRoomIndex, 1);
                else
                    break;
            }

            callbacks.onGameRoomsUpdated();
        }
    };


    // aggiorna il timer heartbeat di un giocatore. invocato all'arrivo di un messaggio di heartbeat
    module.exports.updateHeartBeat = function(gameRoomId, playerId) {
        if (customGameRooms[gameRoomId][playerId] !== undefined) {
            clearTimeout(customGameRooms[gameRoomId][playerId].heartBeatTimer);
            customGameRooms[gameRoomId][playerId] = generateOccupiedSlot(gameRoomId, playerId,
                customGameRooms[gameRoomId][playerId].code);
        }
    };


    // crea uno slot libero da porre su una gameRoom
    let generateFreeSlot = function(codeValue) {
        return { occupiedSlot: false, heartBeatTimer: null, code: codeValue.toString() };
    };


    // setta uno slot come occupato, aggiornando la variabile di occupazione e settando un
    // timer per gestire l'heartbeat
    let generateOccupiedSlot = function(gameRoomId, playerId, gRoomCode) {
        let timer = setTimeout(function() {callbacks.onHeartbeatExpired(gameRoomId, playerId)},
            10000);
        return { occupiedSlot: true, heartBeatTimer: timer, code: gRoomCode };
    };


    let createUniqueCode = function() {
        let newCode = '0000';
        let unique = true;
        do {
            newCode = (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString()
                + (Math.floor(Math.random() * 10)).toString();

            unique = true;
            for (let i = 0; i < customGameRooms.length; i++) {
                if (newCode === customGameRooms[i].code)
                    unique = false;
            }
        } while (!unique);

        return newCode;
    };
}());