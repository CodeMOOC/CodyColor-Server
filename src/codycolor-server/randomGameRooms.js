/*
 * randomGameRooms.js: file per la gestione dell'array gameRoom ad accoppiamento casuale dei giocatori. Espone metodi
 * per l'aggiunta e la rimozione dei giocatori, oltre a metodi per recuperare informazioni sullo stato delle game room.
 */
(function () {
    let utilities = require("./utilities");
    let randomGameRooms = [];
    let callbacks = {};
    const gameRoomStates = utilities.gameRoomStates;


    // inizializza i callbacks utilizzati dal modulo
    module.exports.setCallbacks = function (onGameRoomsUpdated, onHeartbeatExpired) {
        callbacks.onGameRoomsUpdated = onGameRoomsUpdated;
        callbacks.onHeartbeatExpired = onHeartbeatExpired;
    };


    // fornisce il conteggio complessivo dei giocatori attivi sulle game room ad accoppiamento casuale
    module.exports.getConnectedPlayers = function () {
        let connectedPlayers = 0;
        for (let i = 0; i < randomGameRooms.length; i++) {
            for (let j = 0; j < randomGameRooms[i].players.length; j++)
                if (randomGameRooms[i].players[j].occupiedSlot)
                    connectedPlayers++;
        }
        return connectedPlayers;
    };


    // fornisce il conteggio dei giocatori in attesa di un avversario
    module.exports.getWaitingPlayers = function() {
        let waitingPlayers = 0;
        for (let i = 0; i < randomGameRooms.length; i++) {
            if (randomGameRooms[i].players[0].occupiedSlot && !randomGameRooms[i].players[1].occupiedSlot)
                waitingPlayers++;
        }
        return waitingPlayers;
    };


    // stampa a console le gameRoom attive ad accoppiamento personalizzato
    module.exports.printGameRooms = function () {
        utilities.printLog(false, 'New random game room configuration:');

        if (randomGameRooms.length <= 0) {
            utilities.printLog(false, 'empty');

        } else {
            let gameRoomString = '';
            for (let i = 0; i < randomGameRooms.length; i++) {
                let firstSlot = (randomGameRooms[i].players[0].occupiedSlot ? 'x' : 'o');
                let secondSlot = (randomGameRooms[i].players[1].occupiedSlot ? 'x' : 'o');
                gameRoomString += i.toString() + '[' + firstSlot + '' + secondSlot + '] ';
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
    module.exports.isPlayerDataValid = function (gameRoomId, playerId) {
        return gameRoomId !== -1
            && playerId !== -1
            && randomGameRooms.length !== 0
            && gameRoomId <= randomGameRooms.length
            && randomGameRooms[gameRoomId] !== undefined
            && randomGameRooms[gameRoomId].players[playerId] !== undefined;
    };


    // aggiunge un riferimento all'utente nel primo slot valido.
    // Ritorna un oggetto contenente gameRoom e playerId assegnati al richiedente.
    // L'eventuale callback passato viene eseguito non appena le gameRoom vengono aggiornate
    module.exports.addUserToGameRoom = function () {
        let newPlayerData = undefined;

        // dà la precedenza alle gameRoom con giocatori in attesa di avversari
        for (let gRoomIndex = 0; gRoomIndex < randomGameRooms.length; gRoomIndex++) {
            if (randomGameRooms[gRoomIndex].players[0].occupiedSlot &&
               !randomGameRooms[gRoomIndex].players[1].occupiedSlot) {
                newPlayerData = {
                    gameRoomId: gRoomIndex,
                    playerId: 1
                };
            }
        }

        if (newPlayerData === undefined) {
            // cerca il primo slot libero tra le gameRoom
            for (let gRoomIndex = 0; gRoomIndex < randomGameRooms.length; gRoomIndex++) {
                for (let playerIndex = 0; playerIndex < 2; playerIndex++) {
                    // si è trovato uno slot libero: piazza l'utente lì
                    if (!randomGameRooms[gRoomIndex].players[playerIndex].occupiedSlot) {
                        newPlayerData = {
                            gameRoomId: gRoomIndex,
                            playerId: playerIndex
                        };
                    }
                }
            }
        }

        // non c'è uno slot libero: crea una nuova game room
        if (newPlayerData === undefined) {
            randomGameRooms.push(generateFreeGameRoom());
            randomGameRooms[randomGameRooms.length - 1].state = gameRoomStates.mmaking;
            newPlayerData = {
                gameRoomId: randomGameRooms.length - 1,
                playerId: 0
            };
        }

        // inserisci il giocatore nella game room
        randomGameRooms[newPlayerData.gameRoomId].players[newPlayerData.playerId]
            = generateOccupiedSlot(newPlayerData.gameRoomId, newPlayerData.playerId);

        callbacks.onGameRoomsUpdated();
        return {
            gameRoomId: newPlayerData.gameRoomId,
            playerId:   newPlayerData.playerId,
            state:      gameRoomStates.mmaking
        };
    };


    module.exports.removeUserFromGameRoom = function (gameRoomId, playerId) {
        if (slotExists(gameRoomId, playerId)) {
            // pulisci lo slot giocatore
            clearTimeout(randomGameRooms[gameRoomId].players[playerId].heartBeatTimer);
            randomGameRooms[gameRoomId].players[playerId] = generateFreeSlot();

            // pulisci la game room se necessario
            if (randomGameRooms[gameRoomId].state === gameRoomStates.playing) {
                let noPlayers = true;
                for (let playerIndex = 0; playerIndex < randomGameRooms[gameRoomId].players.length; playerIndex++) {
                    if (randomGameRooms[gameRoomId].players[playerIndex].occupiedSlot)
                        noPlayers = false;
                }

                if (noPlayers)
                    randomGameRooms[gameRoomId] = generateFreeGameRoom();
            }

            // rimuovi se presenti le gameRoom vuote consecutive in fondo all'array
            for (let gRoomIndex = randomGameRooms.length - 1; gRoomIndex >= 0; gRoomIndex--) {
                if (randomGameRooms[gRoomIndex].state === gameRoomStates.free)
                    randomGameRooms.splice(gRoomIndex, 1);
                else
                    break;
            }

            callbacks.onGameRoomsUpdated();
        }
    };


    // aggiorna il timer heartbeat di un giocatore. invocato all'arrivo di un messaggio di heartbeat
    module.exports.updateHeartBeat = function (gameRoomId, playerId) {
        if (slotExists(gameRoomId, playerId)) {
            clearTimeout(randomGameRooms[gameRoomId].players[playerId].heartBeatTimer);
            randomGameRooms[gameRoomId].players[playerId].heartBeatTimer
                = generateHeartbeatTimer(gameRoomId, playerId);
        }
    };


    module.exports.startMatch = function (gameRoomId) {
        randomGameRooms[gameRoomId].state = gameRoomStates.playing;
    };


    let slotExists = function(gameRoomId, playerId) {
        return randomGameRooms[gameRoomId] !== undefined
            && randomGameRooms[gameRoomId].players[playerId] !== undefined
    };


    let generateFreeGameRoom = function () {
        return {
            players: [ generateFreeSlot(), generateFreeSlot() ],
            state: gameRoomStates.free
        };
    };


    let generateFreeSlot = function () {
        return {
            occupiedSlot: false,
            heartBeatTimer: undefined
        };
    };


    let generateOccupiedSlot = function (gameRoomId, playerId) {
        return {
            occupiedSlot: true,
            heartBeatTimer: generateHeartbeatTimer(gameRoomId, playerId)
        };
    };


    let generateHeartbeatTimer = function (gameRoomId, playerId) {
        return setTimeout(function () {
                    callbacks.onHeartbeatExpired(gameRoomId, playerId)
        }, 10000);
    };
}());