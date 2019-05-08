/*
 * randomGameRooms.js: file per la gestione dell'array gameRoom ad accoppiamento casuale dei giocatori. Espone metodi
 * per l'aggiunta e la rimozione dei giocatori, oltre a metodi per recuperare informazioni sullo stato delle game room.
 */
(function () {
    // imports
    let utilities = require("./utilities");


    // array game room
    let randomGameRooms = [];

    // callbacks utilizzati dal modulo
    let callbacks = {};

    // inizializza i callbacks utilizzati dal modulo
    module.exports.setCallbacks = function(onGameRoomsUpdated, onHeartbeatExpired) {
      callbacks.onGameRoomsUpdated = onGameRoomsUpdated;
      callbacks.onHeartbeatExpired = onHeartbeatExpired;
    };


    // fornisce il conteggio dei giocatori in attesa di un avversario
    module.exports.getWaitingPlayers = function() {
        let waitingPlayers = 0;
        for (let i = 0; i < randomGameRooms.length; i++) {
            if (randomGameRooms[i][0].occupiedSlot && !randomGameRooms[i][1].occupiedSlot)
                waitingPlayers++;
        }
        return waitingPlayers;
    };


    // fornisce il conteggio complessivo dei giocatori attivi sulle game room ad accoppiamento casuale
    module.exports.getConnectedPlayers = function() {
        let connectedPlayers = 0;
        for (let i = 0; i < randomGameRooms.length; i++) {
            if (randomGameRooms[i][0].occupiedSlot)
                connectedPlayers++;
            if (randomGameRooms[i][1].occupiedSlot)
                connectedPlayers++;
        }
        return connectedPlayers;
    };


    // stampa a console le gameRoom attive ad accoppiamento casuale
    module.exports.printGameRooms = function() {
        utilities.printLog(false, 'New random game room configuration:');

        if (randomGameRooms.length <= 0) {
            utilities.printLog(false, 'empty');

        } else {
            let gameRoomString = '';
            for (let i = 0; i < randomGameRooms.length; i++) {
                let firstSlot = (randomGameRooms[i][0].occupiedSlot ? 'x' : 'o');
                let secondSlot = (randomGameRooms[i][1].occupiedSlot ? 'x' : 'o');
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
            && randomGameRooms.length !== 0
            && gameRoomId <= randomGameRooms.length
            && randomGameRooms[gameRoomId] !== undefined
            && randomGameRooms[gameRoomId][playerId] !== undefined;
    };


    // aggiunge un riferimento all'utente nel primo slot valido.
    // Ritorna un oggetto contenente gameRoom e playerId assegnati al richiedente.
    // L'eventuale callback passato viene eseguito non appena le gameRoom vengono aggiornate
    module.exports.addUserToGameRoom = function() {
        let gameRoomsCount = randomGameRooms.length;

        if (gameRoomsCount > 0) {
            // dà la precedenza alle gameRoom con giocatori in attesa di avversari
            for (let gRoomIndex = 0; gRoomIndex < randomGameRooms.length; gRoomIndex++) {
                if (randomGameRooms[gRoomIndex][0].occupiedSlot && !randomGameRooms[gRoomIndex][1].occupiedSlot) {
                    randomGameRooms[gRoomIndex][1] = generateOccupiedSlot(gRoomIndex, 1);

                    callbacks.onGameRoomsUpdated();
                    return { gameRoomId: gRoomIndex, playerId: 1 };
                }
            }

            // cerca il primo slot libero tra le gameRoom
            for (let gRoomIndex = 0; gRoomIndex < randomGameRooms.length; gRoomIndex++) {
                for (let slotIndex = 0; slotIndex < randomGameRooms[gRoomIndex].length; slotIndex++) {
                    // si è trovato uno slot libero: piazza l'utente lì
                    if (!randomGameRooms[gRoomIndex][slotIndex].occupiedSlot) {
                        randomGameRooms[gRoomIndex][slotIndex] = generateOccupiedSlot(gRoomIndex, slotIndex);

                        callbacks.onGameRoomsUpdated();
                        return {gameRoomId: gRoomIndex, playerId: slotIndex};
                    }
                }
            }

            // non c'è uno slot libero: crea una nuova gameRoom e piazza l'utente nel primo slot
            randomGameRooms.push([ generateOccupiedSlot(gameRoomsCount, 0),
                                   generateFreeSlot() ]);

            callbacks.onGameRoomsUpdated();
            return { gameRoomId: gameRoomsCount, playerId: 0 };

        } else {
            // deve essere creata la prima gameRoom: crea la gameRoom e piazza l'utente nel primo slot
            randomGameRooms.push([ generateOccupiedSlot(0, 0),
                                   generateFreeSlot()]);

            callbacks.onGameRoomsUpdated();
            return {gameRoomId: 0, playerId: 0};
        }
    };


    // rimuove un utente dalla propria gameRoom
    module.exports.removeUserFromGameRoom = function(gameRoomId, playerId) {
        // clear slot
        if (randomGameRooms[gameRoomId] !== undefined && randomGameRooms[gameRoomId][playerId] !== undefined) {
            clearTimeout(randomGameRooms[gameRoomId][playerId].heartBeatTimer);
            randomGameRooms[gameRoomId][playerId] = generateFreeSlot();
        }

        // rimuove le eventuali gameRoom vuote
        for (let gRoomIndex = randomGameRooms.length - 1; gRoomIndex >= 0; gRoomIndex--) {
            if (!randomGameRooms[gRoomIndex][0].occupiedSlot && !randomGameRooms[gRoomIndex][1].occupiedSlot)
                randomGameRooms.splice(gRoomIndex, 1);
            else
                break;
        }

        callbacks.onGameRoomsUpdated();
    };


    // aggiorna il timer heartbeat di un giocatore. invocato all'arrivo di un messaggio di heartbeat
    module.exports.updateHeartBeat = function(gameRoomId, playerId) {
        if (randomGameRooms[gameRoomId] !== undefined && randomGameRooms[gameRoomId][playerId] !== undefined) {
            clearTimeout(randomGameRooms[gameRoomId][playerId].heartBeatTimer);
            randomGameRooms[gameRoomId][playerId] = generateOccupiedSlot(gameRoomId, playerId);
        }
    };


    // crea uno slot libero da porre su una gameRoom
    let generateFreeSlot = function() {
        return { occupiedSlot: false, heartBeatTimer: null };
    };


    // setta uno slot come occupato, aggiornando la variabile di occupazione e settando un
    // timer per gestire l'heartbeat
    let generateOccupiedSlot = function(gameRoomId, playerId) {
        let timer = setTimeout(function() { callbacks.onHeartbeatExpired(gameRoomId, playerId) }, 10000);
        return { occupiedSlot: true, heartBeatTimer: timer };
    };
}());